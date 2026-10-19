import { Notice, TFile, ViewStateResult, setIcon } from "obsidian";
import { Character, initials, linkBasename, parseCharacter, parseLink, STAT_KEYS } from "../model";
import { DescGroupKey, GROUP_TITLES, SheetLayout } from "../settings";
import { NoteSheetView, NoteSheetState } from "./NoteSheetView";
import { button, ImagePickerModal, pill, renderLinkish, renderRadar, resolveImage, sectionLabel } from "../ui/components";

export const VIEW_CHARACTER = "character-sheet";

const VITAL_COLORS = ["red", "green", "blue", "purple"];
const GROUPS: DescGroupKey[] = ["appearance", "personality", "narration"];
type Tab = "overview" | "desc" | "rel" | "inv" | "lore";
const TABS: [Tab, string][] = [["overview", "Overview"], ["desc", "Description"], ["rel", "Relationships"], ["inv", "Inventory"], ["lore", "Lore"]];

interface SheetState extends NoteSheetState {
	tab?: Tab;
	layout?: SheetLayout;
}

export class CharacterView extends NoteSheetView {
	protected readonly noteType = "character";
	protected readonly fallbackTitle = "Character sheet";
	private tab: Tab = "overview";
	private layoutOverride: SheetLayout | null = null;

	getViewType(): string {
		return VIEW_CHARACTER;
	}
	getIcon(): string {
		return "user-round";
	}

	get layout(): SheetLayout {
		return this.layoutOverride ?? this.plugin.settings.defaultLayout;
	}

	protected addViewActions(): void {
		this.addAction("layout-panel-left", "Switch sheet layout", () => {
			this.layoutOverride = this.layout === "full" ? "dossier" : "full";
			this.app.workspace.requestSaveLayout();
			this.render();
		});
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), tab: this.tab, layout: this.layoutOverride ?? undefined };
	}

	async setState(state: SheetState, result: ViewStateResult): Promise<void> {
		if (state.tab) this.tab = state.tab;
		if (state.layout) this.layoutOverride = state.layout;
		return super.setState(state, result);
	}

	protected renderSheet(root: HTMLElement, file: TFile, fm: Record<string, unknown>, body: string): void {
		const c = parseCharacter(fm, file.basename);
		if (this.layout === "dossier") this.renderDossier(root, file, c, body);
		else this.renderFull(root, file, c, body);
	}

	protected renderEmpty(root: HTMLElement): void {
		const box = root.createDiv({ cls: "ct-empty" });
		setIcon(box.createDiv({ cls: "ct-empty-icon" }), "user-round");
		box.createDiv({ cls: "ct-empty-title", text: this.file ? "This note isn't a character" : "No character selected" });
		box.createDiv({ cls: "ct-empty-text", text: "Character notes have type: character in their frontmatter." });
		button(box, "Create new character", () => this.plugin.openWizard(), "ct-btn mod-cta");
	}

	// ---------- shared pieces ----------

	private renderPortrait(parent: HTMLElement, c: Character, file: TFile, cls: string): void {
		const src = resolveImage(this.app, c.portrait, file.path);
		const box = parent.createDiv({ cls: `${cls} ${src ? "" : "is-empty"}`, attr: { "aria-label": "Choose portrait" } });
		if (src) box.createEl("img", { attr: { src, alt: c.name } });
		else box.setText("portrait");
		box.addEventListener("click", () =>
			new ImagePickerModal(this.app, (img) => this.update((fm) => (fm.portrait = `[[${img.name}]]`))).open()
		);
	}

	private renderVital(parent: HTMLElement, v: { name: string; cur: number; max: number }, i: number, thin = false): void {
		const row = parent.createDiv({ cls: "ct-vital" });
		const head = row.createDiv({ cls: "ct-vital-head" });
		head.createSpan({ text: v.name.charAt(0).toUpperCase() + v.name.slice(1) });
		const val = head.createSpan({ cls: "ct-mono ct-editable", text: `${v.cur} / ${v.max}`, attr: { "aria-label": "Click to edit" } });
		const track = row.createDiv({ cls: `ct-bar ${thin ? "is-thin" : ""}` });
		const fill = track.createDiv({ cls: "ct-bar-fill" });
		fill.style.width = `${v.max > 0 ? Math.max(0, Math.min(100, (v.cur / v.max) * 100)) : 0}%`;
		fill.style.background = `var(--color-${VITAL_COLORS[i % VITAL_COLORS.length]})`;

		val.addEventListener("click", () => {
			const input = createEl("input", { type: "text", cls: "ct-inline-input", value: `${v.cur} / ${v.max}` });
			val.replaceWith(input);
			input.focus();
			input.select();
			let done = false;
			const commit = async (save: boolean) => {
				if (done) return;
				done = true;
				const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:\/\s*(-?\d+(?:\.\d+)?))?\s*$/.exec(input.value);
				if (save && m) {
					const cur = Number(m[1]);
					const max = m[2] != null ? Number(m[2]) : v.max;
					await this.update((fm) => {
						fm.vitals = fm.vitals ?? {};
						fm.vitals[v.name] = [cur, max];
					});
				} else this.render();
			};
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") commit(true);
				if (e.key === "Escape") commit(false);
			});
			input.addEventListener("blur", () => commit(true));
		});
	}

	private renderTraitPills(parent: HTMLElement, c: Character): void {
		const wrap = parent.createDiv({ cls: "ct-pills" });
		c.traits.forEach((t) => pill(wrap, t, "green"));
		c.values.forEach((t) => pill(wrap, `Values: ${t.toLowerCase()}`, "blue"));
		c.weaknesses.forEach((t) => pill(wrap, t, "red"));
		if (!wrap.childElementCount) wrap.createSpan({ cls: "ct-faint", text: "—" });
	}

	private bornText(c: Character): string {
		if (!c.born) return "";
		const cal = this.plugin.calendar;
		const abbr = this.plugin.settings.eraAbbr;
		return `${cal.format(c.born)}${abbr ? " " + abbr : ""} · age ${cal.age(c.born)}`;
	}

	private toggleGoal(i: number): Promise<void> {
		return this.update((fm) => {
			const g = fm.goals?.[i];
			if (g == null) return;
			if (typeof g === "object") g.done = !g.done;
			else fm.goals[i] = { text: String(g), done: true };
		});
	}

	private renderGoal(parent: HTMLElement, g: { text: string; done: boolean }, i: number): void {
		const row = parent.createDiv({ cls: `ct-goal ${g.done ? "is-done" : ""}` });
		const box = row.createSpan({ cls: "ct-check", attr: { role: "checkbox", "aria-checked": String(g.done), tabindex: "0" } });
		if (g.done) setIcon(box, "check");
		row.createSpan({ text: g.text });
		box.addEventListener("click", () => this.toggleGoal(i));
		box.addEventListener("keydown", (e) => {
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault();
				this.toggleGoal(i);
			}
		});
	}

	private scoreEl(parent: HTMLElement, score: number): void {
		const txt = score > 0 ? `+${score}` : score < 0 ? `−${Math.abs(score)}` : "0";
		parent.createSpan({ cls: `ct-score ct-mono ${score > 0 ? "is-pos" : score < 0 ? "is-neg" : ""}`, text: txt });
	}

	private renderRelation(parent: HTMLElement, r: { who: string; kind: string; score: number }, file: TFile, card = false): void {
		const row = parent.createDiv({ cls: card ? "ct-rel-card" : "ct-rel" });
		const name = parseLink(r.who).display;
		row.createSpan({ cls: "ct-avatar", text: initials(name) });
		const mid = row.createDiv({ cls: "ct-rel-mid" });
		renderLinkish(this.app, mid, r.who, file.path, "ct-rel-name");
		if (r.kind) mid.createSpan({ cls: "ct-rel-kind", text: r.kind });
		this.scoreEl(row, r.score);
	}

	private backlinks(file: TFile): TFile[] {
		const out: TFile[] = [];
		const resolved = this.app.metadataCache.resolvedLinks;
		for (const src in resolved) {
			if (src !== file.path && resolved[src][file.path]) {
				const f = this.app.vault.getAbstractFileByPath(src);
				if (f instanceof TFile) out.push(f);
			}
		}
		return out.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	/** Chapters in the manuscript folder, and how many have `pov` linking to this character. */
	private povCount(file: TFile): { pov: number; total: number } | null {
		const folder = this.plugin.settings.manuscriptFolder.replace(/^\/+|\/+$/g, "");
		if (!folder) return null;
		const chapters = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/"));
		if (!chapters.length) return null;
		let pov = 0;
		for (const ch of chapters) {
			const raw = this.app.metadataCache.getFileCache(ch)?.frontmatter?.pov;
			const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
			if (list.some((p: unknown) => this.app.metadataCache.getFirstLinkpathDest(linkBasename(String(p)), ch.path) === file)) pov++;
		}
		return { pov, total: chapters.length };
	}

	private renderLinked(parent: HTMLElement, file: TFile): void {
		const links = this.backlinks(file);
		const sec = parent.createDiv({ cls: "ct-stack-6" });
		sectionLabel(sec, `Linked notes · ${links.length}`);
		if (!links.length) sec.createSpan({ cls: "ct-faint ct-13", text: "No notes link here yet." });
		for (const l of links.slice(0, 3)) renderLinkish(this.app, sec, `[[${l.path.replace(/\.md$/, "")}|${l.basename}]]`, file.path, "ct-13");
	}

	private headerButtons(parent: HTMLElement, file: TFile): void {
		const btns = parent.createDiv({ cls: "ct-header-btns" });
		button(btns, "Edit", () => this.editSource());
		button(btns, "Show on timeline", () => this.plugin.openTimeline({ focusLane: file.basename }));
	}

	private descValue(c: Character, group: string, key: string) {
		return c.description[group]?.[key];
	}

	// ---------- 1a: full three-column layout ----------

	private renderFull(root: HTMLElement, file: TFile, c: Character, body: string): void {
		const page = root.createDiv({ cls: "ct-sheet" });

		const header = page.createDiv({ cls: "ct-sheet-header" });
		const titles = header.createDiv({ cls: "ct-stack-6" });
		titles.createDiv({ cls: "ct-breadcrumb", text: (file.parent?.path ?? "").split("/").filter(Boolean).join(" / ") || "Vault" });
		titles.createDiv({ cls: "ct-name", text: c.name });
		if (c.quote) titles.createDiv({ cls: "ct-quote", text: `“${c.quote}”` });
		this.headerButtons(header, file);

		const grid = page.createDiv({ cls: "ct-grid" });

		// Left column
		const left = grid.createDiv({ cls: "ct-col ct-col-left" });
		this.renderPortrait(left, c, file, "ct-portrait");
		if (c.vitals.length) {
			const v = left.createDiv({ cls: "ct-stack-10" });
			sectionLabel(v, "Vitals");
			c.vitals.forEach((vit, i) => this.renderVital(v, vit, i));
		}
		const t = left.createDiv({ cls: "ct-stack-8" });
		sectionLabel(t, "Traits");
		this.renderTraitPills(t, c);

		// Middle column
		const mid = grid.createDiv({ cls: "ct-col ct-col-mid" });
		const props = mid.createDiv({ cls: "ct-props" });
		const prop = (k: string, fill: (el: HTMLElement) => void) => {
			const row = props.createDiv({ cls: "ct-prop" });
			row.createSpan({ cls: "ct-prop-key", text: k });
			fill(row.createDiv({ cls: "ct-prop-val" }));
		};
		if (c.role) prop("Role", (el) => el.setText(c.role));
		if (c.ancestry) prop("Ancestry", (el) => el.setText(c.ancestry));
		if (c.born) prop("Born", (el) => el.setText(this.bornText(c)));
		if (c.affiliation) prop("Affiliation", (el) => renderLinkish(this.app, el, c.affiliation, file.path));
		if (c.faction)
			prop("Faction", (el) => {
				el.addClass("ct-row-8");
				renderLinkish(this.app, el, c.faction, file.path);
				if (c.factionTag) pill(el, c.factionTag, "purple", "ct-pill is-small");
			});
		if (c.status) prop("Status", (el) => el.createSpan({ cls: "ct-status-text", text: c.status }));

		if (STAT_KEYS.some((k) => c.stats[k])) {
			const r = mid.createDiv({ cls: "ct-radar-wrap" });
			renderRadar(r, STAT_KEYS.map((k) => c.stats[k]), this.plugin.settings.statMax);
		}
		const bs = mid.createDiv({ cls: "ct-stack-8" });
		bs.createDiv({ cls: "ct-h16", text: "Backstory" });
		this.renderMarkdown(bs.createDiv({ cls: "ct-body markdown-rendered" }), body, file, "Nothing written yet. Use Edit to add backstory in the note body.");

		// Right column
		const right = grid.createDiv({ cls: "ct-col ct-col-right" });
		const goals = right.createDiv({ cls: "ct-stack-8" });
		sectionLabel(goals, "Goals");
		if (!c.goals.length) goals.createSpan({ cls: "ct-faint ct-13", text: "—" });
		c.goals.forEach((g, i) => this.renderGoal(goals, g, i));

		const rels = right.createDiv({ cls: "ct-stack-8" });
		sectionLabel(rels, "Relationships");
		if (!c.relationships.length) rels.createSpan({ cls: "ct-faint ct-13", text: "—" });
		c.relationships.forEach((r) => this.renderRelation(rels, r, file));

		const inv = right.createDiv({ cls: "ct-stack-6" });
		sectionLabel(inv, "Inventory");
		if (!c.inventory.length) inv.createSpan({ cls: "ct-faint ct-13", text: "—" });
		for (const it of c.inventory) {
			const row = inv.createDiv({ cls: "ct-inv" });
			row.createSpan({ text: it.item + (it.qty && it.qty !== "1" && it.tag !== "currency" ? ` ×${it.qty}` : "") });
			const tag = it.tag === "currency" ? it.qty : it.tag;
			row.createSpan({ cls: `ct-inv-tag ${it.tag === "quest" ? "is-quest" : ""} ${it.tag === "currency" ? "ct-mono" : ""}`, text: tag });
		}
		this.renderLinked(right, file);

		// Description
		this.renderDescriptionFull(page, file, c);
	}

	private renderDescriptionFull(page: HTMLElement, file: TFile, c: Character): void {
		const s = this.plugin.settings;
		const sec = page.createDiv({ cls: "ct-desc" });
		const head = sec.createDiv({ cls: "ct-desc-head" });
		head.createDiv({ cls: "ct-h18", text: "Description" });
		head.createDiv({ cls: "ct-faint ct-12", text: "Writer's reference · used when drafting" });

		const cols = sec.createDiv({ cls: "ct-desc-grid" });
		const pov = this.povCount(file);
		for (const g of GROUPS) {
			const col = cols.createDiv({ cls: "ct-stack-0" });
			col.createDiv({ cls: "ct-desc-group", text: GROUP_TITLES[g] });
			for (const f of s.descFields[g]) {
				if (f.key === "voice_sample") continue;
				this.descRow(col, f.label, this.descValue(c, g, f.key), f.type === "color");
			}
			if (g === "narration") {
				if (c.storyRole) this.descRow(col, "Role", { text: c.storyRole }, false);
				if (pov) this.descRow(col, "Chapters", { text: `${pov.pov} of ${pov.total} from this POV` }, false);
			}
		}

		const sample = this.descValue(c, "narration", "voice_sample")?.text;
		const pv = this.descValue(c, "narration", "pov")?.text;
		const tense = this.descValue(c, "narration", "tense")?.text;
		if (sample || pv || tense) {
			const card = sec.createDiv({ cls: "ct-voice" });
			const row = card.createDiv({ cls: "ct-voice-head" });
			row.createSpan({ cls: "ct-label", text: "Voice sample" });
			if (pv) row.createSpan({ cls: "ct-chip", text: pv });
			if (tense) row.createSpan({ cls: "ct-chip", text: `${tense} tense` });
			if (pov) row.createSpan({ cls: "ct-chip", text: `POV in ${pov.pov} / ${pov.total} chapters` });
			card.createDiv({ cls: "ct-voice-text", text: sample ? `“${sample.replace(/^["“]|["”]$/g, "")}”` : "No voice sample yet." });
		}
	}

	private descRow(parent: HTMLElement, label: string, v: { text: string; color?: string } | undefined, isColor: boolean): void {
		const row = parent.createDiv({ cls: "ct-desc-row" });
		row.createSpan({ cls: "ct-faint", text: label });
		const val = row.createSpan({ cls: "ct-desc-val" });
		if (isColor && v?.color) {
			const sw = val.createSpan({ cls: "ct-swatch" });
			sw.style.background = v.color;
		}
		if (v?.text) val.appendText(v.text);
		else val.createSpan({ cls: "ct-faint", text: "—" });
	}

	// ---------- 1b: dossier layout ----------

	private renderDossier(root: HTMLElement, file: TFile, c: Character, body: string): void {
		const page = root.createDiv({ cls: "ct-dossier" });
		const header = page.createDiv({ cls: "ct-dossier-header" });
		this.renderPortrait(header, c, file, "ct-dossier-portrait");
		const info = header.createDiv({ cls: "ct-dossier-info" });
		const top = info.createDiv({ cls: "ct-row-8" });
		if (c.status) pill(top, c.status, "orange", "ct-pill is-status");
		const sub = [c.storyRole, this.plugin.settings.timelineName].filter(Boolean).join(" · ");
		if (sub) top.createSpan({ cls: "ct-muted ct-12", text: sub });
		info.createDiv({ cls: "ct-dossier-name", text: c.name });
		const meta = info.createDiv({ cls: "ct-dossier-meta" });
		if (c.role) meta.createSpan({ text: c.role });
		if (c.ancestry) meta.createSpan({ text: c.ancestry });
		if (c.born) meta.createSpan({ text: this.bornText(c) });
		if (c.affiliation) renderLinkish(this.app, meta.createSpan(), c.affiliation, file.path);
		if (c.faction) {
			const f = meta.createSpan({ cls: "ct-row-6" });
			f.createSpan({ cls: "ct-faint", text: "Faction" });
			renderLinkish(this.app, f, c.faction, file.path);
		}
		this.headerButtons(header, file);

		const bar = page.createDiv({ cls: "ct-tabs" });
		for (const [k, label] of TABS) {
			const t = bar.createDiv({ cls: `ct-tab ${this.tab === k ? "is-active" : ""}`, text: label });
			t.addEventListener("click", () => {
				this.tab = k;
				this.app.workspace.requestSaveLayout();
				this.render();
			});
		}

		const content = page.createDiv({ cls: "ct-dossier-content" });
		switch (this.tab) {
			case "overview":
				this.dossierOverview(content, c);
				break;
			case "desc":
				this.dossierDescription(content, file, c);
				break;
			case "rel": {
				const grid = content.createDiv({ cls: "ct-rel-grid" });
				if (!c.relationships.length) content.createDiv({ cls: "ct-faint", text: "No relationships yet." });
				c.relationships.forEach((r) => this.renderRelation(grid, r, file, true));
				break;
			}
			case "inv": {
				const tbl = content.createDiv({ cls: "ct-inv-table" });
				if (!c.inventory.length) content.createDiv({ cls: "ct-faint", text: "Inventory is empty." });
				for (const it of c.inventory) {
					const row = tbl.createDiv({ cls: "ct-inv-row" });
					row.createSpan({ text: it.item });
					row.createSpan({ cls: `ct-inv-tag ${it.tag === "quest" ? "is-quest" : ""}`, text: it.tag });
					row.createSpan({ cls: "ct-mono ct-right", text: it.qty });
				}
				break;
			}
			case "lore": {
				const lore = content.createDiv({ cls: "ct-lore markdown-rendered" });
				this.renderMarkdown(lore, body, file, "Nothing written yet. Use Edit to add backstory in the note body.");
				this.renderLinked(content.createDiv({ cls: "ct-lore-links" }), file);
				break;
			}
		}
	}

	private dossierOverview(content: HTMLElement, c: Character): void {
		const grid = content.createDiv({ cls: "ct-overview" });
		const left = grid.createDiv({ cls: "ct-stack-16" });
		renderRadar(left, STAT_KEYS.map((k) => c.stats[k]), this.plugin.settings.statMax);
		const tiles = left.createDiv({ cls: "ct-stat-tiles" });
		for (const k of STAT_KEYS) {
			const tile = tiles.createDiv({ cls: "ct-stat-tile" });
			tile.createDiv({ cls: "ct-stat-key", text: k.toUpperCase() });
			tile.createDiv({ cls: "ct-stat-val", text: String(c.stats[k]) });
		}

		const right = grid.createDiv({ cls: "ct-stack-24" });
		if (c.vitals.length) {
			const v = right.createDiv({ cls: "ct-stack-10" });
			sectionLabel(v, "Vitals");
			const vg = v.createDiv({ cls: "ct-vitals-2col" });
			c.vitals.forEach((vit, i) => this.renderVital(vg, vit, i, true));
		}
		const tvw = right.createDiv({ cls: "ct-tvw" });
		const list = (label: string, color: string, items: string[]) => {
			const col = tvw.createDiv({ cls: "ct-stack-6" });
			const l = sectionLabel(col, label);
			l.style.color = `var(--color-${color})`;
			if (!items.length) col.createSpan({ cls: "ct-faint ct-13", text: "—" });
			items.forEach((t) => col.createDiv({ cls: "ct-13", text: t }));
		};
		list("Traits", "green", c.traits);
		list("Values", "blue", c.values);
		list("Weaknesses", "red", c.weaknesses);

		const active = c.goals.find((g) => !g.done);
		if (active) {
			const card = right.createDiv({ cls: "ct-card" });
			sectionLabel(card, "Active goal");
			card.createDiv({ cls: "ct-14", text: active.text });
		}
	}

	private dossierDescription(content: HTMLElement, file: TFile, c: Character): void {
		const s = this.plugin.settings;
		const wrap = content.createDiv({ cls: "ct-stack-24" });
		const pov = this.povCount(file);
		for (const g of GROUPS) {
			const row = wrap.createDiv({ cls: "ct-ddesc-row" });
			row.createDiv({ cls: "ct-desc-group", text: GROUP_TITLES[g] });
			const fields = row.createDiv({ cls: "ct-ddesc-fields" });
			const add = (label: string, v: { text: string; color?: string } | undefined, isColor: boolean) => {
				const f = fields.createDiv({ cls: "ct-ddesc-field" });
				f.createDiv({ cls: "ct-faint ct-11", text: label });
				const val = f.createDiv({ cls: "ct-13 ct-desc-val" });
				if (isColor && v?.color) val.createSpan({ cls: "ct-swatch" }).style.background = v.color;
				if (v?.text) val.appendText(v.text);
				else val.createSpan({ cls: "ct-faint", text: "—" });
			};
			for (const f of s.descFields[g]) {
				if (f.key === "voice_sample") continue;
				add(f.label, this.descValue(c, g, f.key), f.type === "color");
			}
			if (g === "narration" && pov) add("Chapters", { text: `${pov.pov} of ${pov.total} from this POV` }, false);
		}
		const sample = this.descValue(c, "narration", "voice_sample")?.text;
		if (sample) {
			const row = wrap.createDiv({ cls: "ct-ddesc-row" });
			row.createDiv({ cls: "ct-desc-group", text: "Voice sample" });
			row.createDiv({ cls: "ct-voice-text", text: `“${sample.replace(/^["“]|["”]$/g, "")}”` });
		}
	}

}

export function noticeNotCharacter(): void {
	new Notice("This note isn't a character (frontmatter type: character).");
}
