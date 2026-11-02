import { debounce, ItemView, Keymap, Menu, TFile, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import { parseDate, toIndex } from "../calendar";
import type StoryPlugin from "../main";
import { collectScenes, countWords, initials, linkBasename, resolveFirstLink, Scene, SCENE_STATUS_COLORS, SCENE_STATUSES, SceneStatus } from "../model";
import { SceneModal } from "../modals/SceneModal";
import { button, pill, renderLinkish } from "../ui/components";

export const VIEW_MANUSCRIPT = "story-manuscript";

type StatusFilter = "all" | SceneStatus;

interface ManuscriptState {
	status?: StatusFilter;
	pov?: string;
	focus?: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (n: number) => n.toLocaleString();

/** A corkboard of scene cards, one column per chapter. Drag cards to reorder or move them between chapters. */
export class ManuscriptView extends ItemView {
	private scenes: Scene[] = [];
	private words = new Map<string, number>();
	private status: StatusFilter = "all";
	private pov = "";
	private pendingFocus: string | null = null;
	/** Path of the card being dragged. */
	private dragging: string | null = null;
	/** True while a drop is writing frontmatter, so the board doesn't redraw halfway. */
	private writing = false;
	private loadToken = 0;
	private boardEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: StoryPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_MANUSCRIPT;
	}
	getDisplayText(): string {
		return "Manuscript";
	}
	getIcon(): string {
		return "book-open-text";
	}

	getState(): Record<string, unknown> {
		return { status: this.status, pov: this.pov };
	}

	async setState(state: ManuscriptState, result: ViewStateResult): Promise<void> {
		if (state.status === "all" || SCENE_STATUSES.includes(state.status as SceneStatus)) this.status = state.status!;
		if (typeof state.pov === "string") this.pov = state.pov;
		if (state.focus) this.pendingFocus = state.focus;
		if (this.boardEl) this.render();
		return super.setState(state, result);
	}

	focusScene(path: string): void {
		this.pendingFocus = path;
		this.status = "all";
		this.pov = "";
		this.render();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("ct-view", "ct-manuscript");
		const refresh = debounce(() => {
			if (!this.dragging && !this.writing) this.reload();
		}, 300, true);
		this.registerEvent(this.app.metadataCache.on("changed", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
		await this.reload();
	}

	/** Re-reads scenes and their word counts, then redraws. */
	async reload(): Promise<void> {
		const token = ++this.loadToken;
		const scenes = collectScenes(this.app);
		const words = new Map<string, number>();
		await Promise.all(
			scenes.map(async (s) => {
				const f = this.app.vault.getAbstractFileByPath(s.path);
				if (f instanceof TFile) words.set(s.path, countWords(await this.app.vault.cachedRead(f)));
			})
		);
		if (token !== this.loadToken) return;
		this.scenes = scenes;
		this.words = words;
		this.render();
	}

	private visible(s: Scene): boolean {
		if (this.status !== "all" && s.status !== this.status) return false;
		if (this.pov && linkBasename(s.pov) !== this.pov) return false;
		return true;
	}

	private wordsOf(list: Scene[]): number {
		return list.reduce((n, s) => n + (this.words.get(s.path) ?? 0), 0);
	}

	/** Chapter columns in order; scenes without a chapter go in a trailing "Unplaced" column. */
	private columns(): { chapter: number | null; scenes: Scene[] }[] {
		const map = new Map<number | null, Scene[]>();
		for (const s of this.scenes) {
			if (!map.has(s.chapter)) map.set(s.chapter, []);
			map.get(s.chapter)!.push(s);
		}
		const keys = [...map.keys()].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
		return keys.map((chapter) => ({ chapter, scenes: map.get(chapter)! }));
	}

	render(): void {
		const root = this.contentEl;
		const sl = this.boardEl?.scrollLeft ?? 0;
		root.empty();
		this.renderToolbar(root);
		if (!this.scenes.length) {
			this.boardEl = null;
			const box = root.createDiv({ cls: "ct-empty" });
			setIcon(box.createDiv({ cls: "ct-empty-icon" }), "book-open-text");
			box.createDiv({ cls: "ct-empty-title", text: "No scenes yet" });
			box.createDiv({ cls: "ct-empty-text", text: "Scene notes have type: scene, plus chapter, pov, location, event and status in their frontmatter." });
			button(box, "Create first scene", () => this.newScene(1), "ct-btn mod-cta");
			return;
		}
		this.boardEl = root.createDiv({ cls: "ct-ms-board" });
		const cols = this.columns();
		for (const col of cols) this.renderColumn(this.boardEl, col.chapter, col.scenes);
		const next = Math.max(0, ...cols.map((c) => c.chapter ?? 0)) + 1;
		const add = this.boardEl.createDiv({ cls: "ct-ms-col is-ghost" });
		const b = button(add, `+ Chapter ${next}`, () => this.newScene(next), "ct-btn is-small");
		b.setAttr("aria-label", `New scene in chapter ${next}`);
		this.boardEl.scrollLeft = sl;
		if (this.pendingFocus) this.applyFocus();
	}

	private applyFocus(): void {
		const path = this.pendingFocus!;
		this.pendingFocus = null;
		const card = this.boardEl?.querySelector(`[data-path="${CSS.escape(path)}"]`) as HTMLElement | null;
		if (!card) return;
		card.scrollIntoView({ block: "center", inline: "center" });
		card.addClass("is-focused");
		window.setTimeout(() => card.removeClass("is-focused"), 1600);
	}

	private renderToolbar(root: HTMLElement): void {
		const bar = root.createDiv({ cls: "ct-tl-toolbar" });
		bar.createSpan({ cls: "ct-tl-name", text: "Manuscript" });
		const total = this.wordsOf(this.scenes);
		bar.createSpan({ cls: "ct-mono ct-faint ct-12", text: `${this.scenes.length} scene${this.scenes.length === 1 ? "" : "s"} · ${fmt(total)} words` });

		// Share of words at each status.
		if (total) {
			const meter = bar.createDiv({ cls: "ct-ms-meter" });
			const parts: string[] = [];
			for (const st of SCENE_STATUSES) {
				const w = this.wordsOf(this.scenes.filter((s) => s.status === st));
				if (!w) continue;
				const seg = meter.createDiv({ cls: "ct-ms-meter-seg" });
				seg.style.width = `${(w / total) * 100}%`;
				seg.style.background = `var(--color-${SCENE_STATUS_COLORS[st]})`;
				parts.push(`${cap(st)} ${Math.round((w / total) * 100)}%`);
			}
			meter.setAttr("aria-label", parts.join(" · "));
		}

		const seg = bar.createDiv({ cls: "ct-seg" });
		for (const st of ["all", ...SCENE_STATUSES] as StatusFilter[]) {
			const n = st === "all" ? this.scenes.length : this.scenes.filter((s) => s.status === st).length;
			const item = seg.createDiv({ cls: `ct-seg-item ${this.status === st ? "is-active" : ""}`, text: `${cap(st)} ${n}` });
			item.addEventListener("click", () => {
				this.status = st;
				this.app.workspace.requestSaveLayout();
				this.render();
			});
		}

		const povs = [...new Set(this.scenes.map((s) => linkBasename(s.pov)).filter(Boolean))].sort();
		if (povs.length) {
			const sel = bar.createEl("select", { cls: "dropdown ct-ms-pov" });
			sel.createEl("option", { text: "All POVs", value: "" });
			for (const p of povs) sel.createEl("option", { text: p, value: p });
			sel.value = povs.includes(this.pov) ? this.pov : "";
			sel.addEventListener("change", () => {
				this.pov = sel.value;
				this.app.workspace.requestSaveLayout();
				this.render();
			});
		}

		bar.createDiv({ cls: "ct-spacer" });
		const legend = bar.createDiv({ cls: "ct-legend" });
		for (const st of SCENE_STATUSES) {
			const item = legend.createSpan({ cls: "ct-legend-item" });
			item.createSpan({ cls: "ct-dot" }).style.background = `var(--color-${SCENE_STATUS_COLORS[st]})`;
			item.appendText(cap(st));
		}
		button(bar, "+ Scene", () => this.newScene(), "ct-btn mod-cta is-small").setAttr("aria-label", "New scene");
	}

	private newScene(chapter?: number | null): void {
		new SceneModal(this.app, this.plugin, chapter === undefined ? {} : { chapter }, (f) => {
			this.pendingFocus = f.path;
		}).open();
	}

	private renderColumn(board: HTMLElement, chapter: number | null, scenes: Scene[]): void {
		const col = board.createDiv({ cls: "ct-ms-col" });
		const head = col.createDiv({ cls: "ct-ms-col-head" });
		const titles = head.createDiv({ cls: "ct-stack-2" });
		titles.createSpan({ cls: "ct-ms-col-title", text: chapter == null ? "Unplaced" : `Chapter ${chapter}` });
		titles.createSpan({ cls: "ct-mono ct-faint ct-11", text: `${scenes.length} scene${scenes.length === 1 ? "" : "s"} · ${fmt(this.wordsOf(scenes))} words` });
		const add = head.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": chapter == null ? "New unplaced scene" : `New scene in chapter ${chapter}` } });
		setIcon(add, "plus");
		add.addEventListener("click", () => this.newScene(chapter));

		const list = col.createDiv({ cls: "ct-ms-list" });
		scenes.forEach((s, i) => {
			if (this.visible(s)) this.renderCard(list, s, chapter == null ? `${i + 1}` : `${chapter}.${i + 1}`);
		});
		if (!list.childElementCount) list.createDiv({ cls: "ct-faint ct-12 ct-ms-none", text: scenes.length ? "No scenes match the filter." : "Drop scenes here." });
		this.makeDropZone(list, chapter, scenes);
	}

	private renderCard(list: HTMLElement, s: Scene, index: string): void {
		const card = list.createDiv({ cls: "ct-ms-card", attr: { draggable: "true", "data-path": s.path } });
		card.style.setProperty("--ct-c", `var(--color-${SCENE_STATUS_COLORS[s.status]})`);

		const top = card.createDiv({ cls: "ct-ms-card-top" });
		top.createSpan({ cls: "ct-mono ct-faint ct-11", text: index });
		const st = pill(top, cap(s.status), SCENE_STATUS_COLORS[s.status], "ct-pill is-small ct-ms-status");
		st.setAttr("aria-label", "Click to advance status");
		st.addEventListener("click", (e) => {
			e.stopPropagation();
			const next = SCENE_STATUSES[(SCENE_STATUSES.indexOf(s.status) + 1) % SCENE_STATUSES.length];
			this.setFm(s.path, (fm) => (fm.status = next));
		});
		top.createDiv({ cls: "ct-spacer" });
		top.createSpan({ cls: "ct-mono ct-faint ct-11", text: `${fmt(this.words.get(s.path) ?? 0)} w` });

		card.createDiv({ cls: "ct-ms-card-title", text: s.title });
		if (s.summary) card.createDiv({ cls: "ct-ms-card-summary", text: s.summary });

		const meta = card.createDiv({ cls: "ct-ms-card-meta" });
		if (s.pov) {
			const row = meta.createDiv({ cls: "ct-row-6" });
			row.createSpan({ cls: "ct-avatar is-tiny", text: initials(linkBasename(s.pov)) });
			renderLinkish(this.app, row, s.pov, s.path, "ct-12");
		}
		if (s.location) this.metaRow(meta, "map-pin", s.location, s.path);
		if (s.event) {
			const row = this.metaRow(meta, "git-commit-horizontal", s.event, s.path);
			const date = this.eventDate(s.event, s.path);
			if (date) row.createSpan({ cls: "ct-mono ct-faint ct-11 ct-ms-date", text: date });
		}

		card.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).closest("a")) return;
			this.app.workspace.openLinkText(s.path, "", Keymap.isModEvent(e));
		});
		card.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((i) => i.setTitle("Edit scene details").setIcon("wand-sparkles").onClick(() => this.editScene(s.path)));
			menu.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").onClick(() => this.app.workspace.openLinkText(s.path, "", "tab")));
			menu.addSeparator();
			for (const status of SCENE_STATUSES) {
				menu.addItem((i) =>
					i.setTitle(`Mark ${status}`).setChecked(s.status === status).onClick(() => this.setFm(s.path, (fm) => (fm.status = status)))
				);
			}
			menu.showAtMouseEvent(e);
		});
		card.addEventListener("dragstart", (e) => {
			this.dragging = s.path;
			e.dataTransfer?.setData("text/plain", s.path);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			window.setTimeout(() => card.addClass("is-dragging"), 0);
		});
		card.addEventListener("dragend", () => {
			this.dragging = null;
			card.removeClass("is-dragging");
			this.boardEl?.querySelectorAll(".ct-ms-drop").forEach((d) => d.remove());
		});
	}

	private metaRow(meta: HTMLElement, icon: string, raw: string, sourcePath: string): HTMLElement {
		const row = meta.createDiv({ cls: "ct-row-6" });
		setIcon(row.createSpan({ cls: "ct-ms-icon" }), icon);
		renderLinkish(this.app, row, raw, sourcePath, "ct-12");
		return row;
	}

	/** In-world date of the linked timeline event, if it has one. */
	private eventDate(raw: string, sourcePath: string): string | null {
		const f = resolveFirstLink(this.app, raw, sourcePath);
		const d = f ? parseDate(this.app.metadataCache.getFileCache(f)?.frontmatter?.["tl-start"]) : null;
		return d ? this.plugin.calendar.format(toIndex(d)) : null;
	}

	private editScene(path: string): void {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) new SceneModal(this.app, this.plugin, {}, undefined, f).open();
	}

	private async setFm(path: string, fn: (fm: Record<string, unknown>) => void): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) await this.app.fileManager.processFrontMatter(f, fn);
	}

	// ---------- drag & drop ----------

	/** Index among the visible cards that the pointer is above. */
	private dropIndex(list: HTMLElement, y: number): number {
		const cards = Array.from(list.querySelectorAll<HTMLElement>(".ct-ms-card:not(.is-dragging)"));
		const i = cards.findIndex((c) => {
			const r = c.getBoundingClientRect();
			return y < r.top + r.height / 2;
		});
		return i < 0 ? cards.length : i;
	}

	private makeDropZone(list: HTMLElement, chapter: number | null, scenes: Scene[]): void {
		list.addEventListener("dragover", (e) => {
			if (!this.dragging) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			const cards = Array.from(list.querySelectorAll<HTMLElement>(".ct-ms-card:not(.is-dragging)"));
			const at = this.dropIndex(list, e.clientY);
			let marker = list.querySelector<HTMLElement>(".ct-ms-drop");
			this.boardEl?.querySelectorAll(".ct-ms-drop").forEach((d) => d !== marker && d.remove());
			if (!marker) marker = createDiv({ cls: "ct-ms-drop" });
			const before = cards[at] ?? null;
			if (marker.nextElementSibling !== before || marker.parentElement !== list) list.insertBefore(marker, before);
		});
		list.addEventListener("dragleave", (e) => {
			if (!list.contains(e.relatedTarget as Node)) list.querySelector(".ct-ms-drop")?.remove();
		});
		list.addEventListener("drop", async (e) => {
			const path = this.dragging;
			if (!path) return;
			e.preventDefault();
			// Map the position among visible cards back onto the full (possibly filtered) column.
			const visible = scenes.filter((s) => s.path !== path && this.visible(s));
			const at = this.dropIndex(list, e.clientY);
			const others = scenes.filter((s) => s.path !== path);
			const anchor = visible[at];
			const insertAt = anchor ? others.indexOf(anchor) : others.length;
			const moved = this.scenes.find((s) => s.path === path);
			if (!moved) return;
			const ordered = [...others.slice(0, insertAt), moved, ...others.slice(insertAt)];
			this.dragging = null;
			await this.applyOrder(moved, chapter, ordered);
		});
	}

	/** Writes `chapter` to the moved scene and renumbers `order` 1…n in its new (and old) column. */
	private async applyOrder(moved: Scene, chapter: number | null, ordered: Scene[]): Promise<void> {
		const from = moved.chapter;
		const writes: { path: string; chapter: number | null; order: number }[] = ordered.map((s, i) => ({ path: s.path, chapter, order: i + 1 }));
		if (from !== chapter) {
			this.scenes.filter((s) => s.chapter === from && s.path !== moved.path).forEach((s, i) => writes.push({ path: s.path, chapter: from, order: i + 1 }));
		}
		const changed = writes.filter((w) => {
			const s = this.scenes.find((x) => x.path === w.path)!;
			return s.chapter !== w.chapter || s.order !== w.order;
		});
		if (!changed.length) return this.render();
		this.writing = true;
		try {
			for (const w of changed) {
				await this.setFm(w.path, (fm) => {
					if (w.chapter == null) delete fm.chapter;
					else fm.chapter = w.chapter;
					fm.order = w.order;
				});
			}
		} finally {
			this.writing = false;
		}
		await this.reload();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}
