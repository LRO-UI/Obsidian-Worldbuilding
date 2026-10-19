import { debounce, ItemView, TFile, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import { fromIndex } from "../calendar";
import type StoryPlugin from "../main";
import { collectEvents, initials, StoryEvent } from "../model";
import { EventModal } from "../modals/EventModal";
import { button, renderLinkish } from "../ui/components";

export const VIEW_TIMELINE = "story-timeline";
export type Zoom = "era" | "year" | "month";
export const PPM: Record<Zoom, number> = { era: 7, year: 22, month: 80 };
const PAD = 20;
const RULER_H = 44;
const ROW_H = 34;

interface TimelineState {
	zoom?: Zoom;
	selected?: string | null;
	focusLane?: string;
}

interface Drag {
	path: string;
	mode: "move" | "resize";
	startX: number;
	origStart: number;
	origEnd: number | null;
	delta: number;
}

export class TimelineView extends ItemView {
	private events: StoryEvent[] = [];
	private zoom: Zoom = "year";
	private selected: string | null = null;
	private drag: Drag | null = null;
	private origin = 0;
	private span = 0;
	private pendingFocus: string | null = null;

	private bodyEl!: HTMLElement;
	private scrollEl!: HTMLElement;
	private detailEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private plugin: StoryPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TIMELINE;
	}
	getDisplayText(): string {
		return this.plugin.settings.timelineName || "Timeline";
	}
	getIcon(): string {
		return "git-commit-horizontal";
	}

	getState(): Record<string, unknown> {
		return { zoom: this.zoom, selected: this.selected };
	}

	async setState(state: TimelineState, result: ViewStateResult): Promise<void> {
		if (state.zoom && state.zoom in PPM) this.zoom = state.zoom;
		if (state.selected !== undefined) this.selected = state.selected;
		if (state.focusLane) this.pendingFocus = state.focusLane;
		if (this.bodyEl) this.render();
		return super.setState(state, result);
	}

	focusLane(lane: string): void {
		this.pendingFocus = lane;
		this.render();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("ct-view", "ct-timeline");
		const refresh = debounce(() => {
			if (!this.drag) {
				this.reload();
				this.render();
			}
		}, 150, true);
		this.registerEvent(this.app.metadataCache.on("changed", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
		this.reload();
		this.render();
	}

	reload(): void {
		this.events = collectEvents(this.app);
		if (this.selected && !this.events.some((e) => e.path === this.selected)) this.selected = null;
	}

	private ppm(): number {
		return PPM[this.zoom];
	}

	private color(cat: string): string {
		const c = this.plugin.settings.categories.find((x) => x.key === cat);
		return c ? `var(--color-${c.color})` : "var(--text-muted)";
	}

	private x(m: number): number {
		return PAD + (m - this.origin) * this.ppm();
	}

	private computeRange(): void {
		if (this.drag) return; // keep the axis still while dragging
		if (!this.events.length) {
			this.origin = this.plugin.settings.currentYear * 12;
			this.span = 36;
			return;
		}
		const min = Math.min(...this.events.map((e) => e.start));
		const max = Math.max(...this.events.map((e) => e.end ?? e.start + 1));
		this.origin = Math.floor(min / 12) * 12;
		this.span = Math.ceil((max + 1) / 12) * 12 - this.origin;
	}

	private lanes(): string[] {
		const set = new Set(this.events.map((e) => e.lane).filter((l) => l !== "World"));
		if (this.pendingFocus && this.pendingFocus !== "World") set.add(this.pendingFocus);
		const counts = (l: string) => this.events.filter((e) => e.lane === l).length;
		const list = [...set].sort((a, b) => counts(b) - counts(a) || a.localeCompare(b));
		return [...list, "World"];
	}

	render(): void {
		const root = this.contentEl;
		const sl = this.scrollEl?.scrollLeft ?? 0;
		const st = this.bodyEl?.scrollTop ?? 0;
		root.empty();
		this.computeRange();
		this.renderToolbar(root);
		this.bodyEl = root.createDiv({ cls: "ct-tl-body" });
		this.renderBody();
		this.detailEl = root.createDiv({ cls: "ct-tl-detail" });
		this.renderDetail();
		this.scrollEl.scrollLeft = sl;
		this.bodyEl.scrollTop = st;
		if (this.pendingFocus) this.applyFocus();
	}

	private applyFocus(): void {
		const lane = this.pendingFocus!;
		this.pendingFocus = null;
		const evs = this.events.filter((e) => e.lane === lane).sort((a, b) => a.start - b.start);
		if (evs[0]) {
			this.selected = evs[0].path;
			this.renderBody();
			this.renderDetail();
			this.scrollEl.scrollLeft = Math.max(0, this.x(evs[0].start) - 60);
		}
		const laneEl = this.bodyEl.querySelector(`[data-lane="${CSS.escape(lane)}"]`) as HTMLElement | null;
		laneEl?.scrollIntoView({ block: "nearest" });
	}

	private renderToolbar(root: HTMLElement): void {
		const s = this.plugin.settings;
		const bar = root.createDiv({ cls: "ct-tl-toolbar" });
		bar.createSpan({ cls: "ct-tl-name", text: s.timelineName || "Timeline" });
		const y0 = Math.floor(this.origin / 12);
		const y1 = Math.floor((this.origin + this.span) / 12);
		bar.createSpan({ cls: "ct-mono ct-faint ct-12", text: `${s.eraName ? s.eraName + " · " : ""}${y0}–${y1}` });
		const seg = bar.createDiv({ cls: "ct-seg" });
		for (const [k, label] of [["era", "Era"], ["year", "Year"], ["month", "Month"]] as [Zoom, string][]) {
			const b = seg.createDiv({ cls: `ct-seg-item ${this.zoom === k ? "is-active" : ""}`, text: label });
			b.addEventListener("click", () => {
				const centre = this.scrollEl ? (this.scrollEl.scrollLeft + this.scrollEl.clientWidth / 2 - PAD) / this.ppm() : 0;
				this.zoom = k;
				this.app.workspace.requestSaveLayout();
				this.render();
				this.scrollEl.scrollLeft = Math.max(0, centre * this.ppm() + PAD - this.scrollEl.clientWidth / 2);
			});
		}
		bar.createDiv({ cls: "ct-spacer" });
		const legend = bar.createDiv({ cls: "ct-legend" });
		for (const c of s.categories) {
			const item = legend.createSpan({ cls: "ct-legend-item" });
			item.createSpan({ cls: "ct-dot" }).style.background = `var(--color-${c.color})`;
			item.appendText(c.label);
		}
		const add = button(bar, "+ Event", () => this.newEvent({}), "ct-btn mod-cta is-small");
		add.setAttr("aria-label", "New event");
	}

	private newEvent(prefill: { lane?: string; start?: number }): void {
		new EventModal(this.app, this.plugin, prefill, (f) => {
			this.selected = f.path;
		}).open();
	}

	private renderBody(): void {
		const body = this.bodyEl;
		body.empty();
		const ppm = this.ppm();
		const lanes = this.lanes();

		// Lane layout with greedy row stacking.
		const laid = lanes.map((lane) => {
			const evs = this.events.filter((e) => e.lane === lane).sort((a, b) => a.start - b.start);
			const rows: number[] = [];
			const items = evs.map((e) => {
				const isBar = e.end != null;
				const x0 = this.x(e.start);
				const lw = (e.title.length + 12) * 6.4 + (isBar ? 0 : 16);
				const x1 = Math.max(isBar ? this.x(e.end!) : x0, x0 + lw);
				let r = rows.findIndex((end) => end < x0 - 10);
				if (r < 0) {
					r = rows.length;
					rows.push(0);
				}
				rows[r] = x1;
				return { e, isBar, x0, top: 10 + r * ROW_H };
			});
			return { lane, items, h: Math.max(1, rows.length) * ROW_H + 16 };
		});

		// Lane headers
		const heads = body.createDiv({ cls: "ct-tl-heads" });
		heads.createDiv({ cls: "ct-tl-ruler-spacer" });
		for (const l of laid) {
			const h = heads.createDiv({ cls: "ct-tl-head" });
			h.style.height = `${l.h}px`;
			h.createSpan({ cls: "ct-avatar is-small", text: l.lane === "World" ? "—" : initials(l.lane) });
			if (l.lane === "World") h.createSpan({ text: "World" });
			else renderLinkish(this.app, h, `[[${l.lane}]]`, "", "ct-tl-lane-link");
		}

		// Scroll area
		this.scrollEl = body.createDiv({ cls: "ct-tl-scroll" });
		const inner = this.scrollEl.createDiv({ cls: "ct-tl-inner" });
		inner.style.width = `${PAD * 2 + this.span * ppm + 200}px`;

		const ruler = inner.createDiv({ cls: "ct-tl-ruler" });
		const months = this.plugin.settings.months;
		for (let i = 0; i <= this.span; i++) {
			const m = this.origin + i;
			const x = this.x(m);
			const yr = m % 12 === 0 || i === 0;
			const year = Math.floor(m / 12);
			const tick = (h: number, cls: string, label: string, lcls: string) => {
				const t = ruler.createDiv({ cls: `ct-tick ${cls}` });
				t.style.left = `${x}px`;
				t.style.height = `${h}px`;
				if (label) {
					const lb = ruler.createDiv({ cls: `ct-tick-label ${lcls}`, text: label });
					lb.style.left = `${x + 4}px`;
				}
			};
			if (this.zoom === "era") {
				if (yr) tick(14, "is-major", String(year), "is-muted");
			} else if (this.zoom === "year") {
				if (yr) tick(16, "is-major", String(year), "is-normal");
				else if (m % 3 === 0) tick(6, "is-minor", "", "");
			} else {
				tick(yr ? 18 : 8, yr ? "is-major" : "is-minor", yr ? `${months[0]} ${year}` : months[m % 12] ?? "", yr ? "is-normal" : "is-faint");
			}
			if (yr) {
				const g = inner.createDiv({ cls: "ct-tl-grid" });
				g.style.left = `${x}px`;
			}
		}

		for (const l of laid) {
			const laneEl = inner.createDiv({ cls: "ct-tl-lane", attr: { "data-lane": l.lane } });
			laneEl.style.height = `${l.h}px`;
			laneEl.addEventListener("dblclick", (ev) => {
				if (ev.target !== laneEl) return;
				const rect = laneEl.getBoundingClientRect();
				const m = this.origin + Math.round((ev.clientX - rect.left - PAD) / ppm);
				this.newEvent({ lane: l.lane, start: Math.max(0, m) });
			});
			for (const it of l.items) this.renderEvent(laneEl, it.e, it.isBar, it.x0, it.top);
		}
	}

	private renderEvent(laneEl: HTMLElement, e: StoryEvent, isBar: boolean, x0: number, top: number): void {
		const cal = this.plugin.calendar;
		const el = laneEl.createDiv({ cls: `ct-ev ${isBar ? "is-bar" : "is-point"} ${this.selected === e.path ? "is-selected" : ""}`, attr: { "data-path": e.path } });
		el.style.left = `${x0}px`;
		el.style.top = `${top}px`;
		el.style.setProperty("--ct-c", this.color(e.category));
		const label = (parent: HTMLElement) => {
			const l = parent.createDiv({ cls: "ct-ev-label", text: e.title + " " });
			l.createSpan({ cls: "ct-ev-date", text: cal.shortRange(e.start, e.end) });
		};
		if (isBar) {
			label(el);
			const bar = el.createDiv({ cls: "ct-ev-bar ct-ev-mark" });
			bar.style.width = `${Math.max(8, (e.end! - e.start) * this.ppm())}px`;
			const handle = bar.createDiv({ cls: "ct-ev-handle", attr: { "aria-label": "Drag to change end" } });
			handle.addEventListener("pointerdown", (ev) => this.startDrag(ev, e, "resize"));
		} else {
			el.createSpan({ cls: "ct-ev-diamond ct-ev-mark" });
			label(el);
		}
		el.addEventListener("pointerdown", (ev) => this.startDrag(ev, e, "move"));
		el.addEventListener("dblclick", (ev) => {
			ev.stopPropagation();
			this.openNote(e.path, ev.ctrlKey || ev.metaKey);
		});
	}

	private select(path: string | null): void {
		this.selected = path;
		this.bodyEl.querySelectorAll(".ct-ev").forEach((n) => n.toggleClass("is-selected", (n as HTMLElement).dataset.path === path));
		this.renderDetail();
		this.app.workspace.requestSaveLayout();
	}

	private startDrag(ev: PointerEvent, e: StoryEvent, mode: Drag["mode"]): void {
		if (ev.button !== 0) return;
		ev.preventDefault();
		ev.stopPropagation();
		this.select(e.path);
		this.drag = { path: e.path, mode, startX: ev.clientX, origStart: e.start, origEnd: e.end, delta: 0 };
		const ppm = this.ppm();

		const move = (m: PointerEvent) => {
			const d = this.drag;
			if (!d) return;
			const delta = Math.round((m.clientX - d.startX) / ppm);
			if (delta === d.delta) return;
			d.delta = delta;
			const target = this.events.find((x) => x.path === d.path);
			if (!target) return;
			if (d.mode === "resize" && d.origEnd != null) {
				target.end = Math.max(d.origStart + 1, d.origEnd + delta);
			} else {
				target.start = Math.max(0, d.origStart + delta);
				target.end = d.origEnd != null ? target.start + (d.origEnd - d.origStart) : null;
			}
			const sl = this.scrollEl.scrollLeft;
			const st = this.bodyEl.scrollTop;
			this.renderBody();
			this.scrollEl.scrollLeft = sl;
			this.bodyEl.scrollTop = st;
			this.renderDetail();
		};
		const up = async () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", up);
			const d = this.drag;
			const target = d && this.events.find((x) => x.path === d.path);
			if (d && target && d.delta !== 0) {
				const file = this.app.vault.getAbstractFileByPath(d.path);
				if (file instanceof TFile) {
					await this.app.fileManager.processFrontMatter(file, (fm) => {
						fm["tl-start"] = fromIndex(target.start);
						if (target.end != null) fm["tl-end"] = fromIndex(target.end);
					});
				}
			}
			this.drag = null;
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", up);
	}

	private openNote(path: string, newLeaf = false): void {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) this.app.workspace.getLeaf(newLeaf ? "tab" : false).openFile(f);
	}

	private renderDetail(): void {
		const el = this.detailEl;
		if (!el) return;
		el.empty();
		const e = this.events.find((x) => x.path === this.selected);
		if (!e) {
			el.createSpan({ cls: "ct-faint ct-13", text: "Select an event. Drag to re-date, drag the right edge to change its end, double-click to open." });
			return;
		}
		el.createSpan({ cls: "ct-dot is-large" }).style.background = this.color(e.category);
		const t = el.createDiv({ cls: "ct-stack-2 ct-tl-detail-title" });
		t.createSpan({ cls: "ct-14 ct-strong", text: e.title });
		t.createSpan({ cls: "ct-mono ct-muted ct-12", text: this.plugin.calendar.formatRange(e.start, e.end) });
		const lane = el.createDiv({ cls: "ct-stack-2" });
		lane.createSpan({ cls: "ct-faint ct-11", text: "Lane" });
		lane.createSpan({ cls: "ct-13", text: e.lane });
		if (e.location) {
			const loc = el.createDiv({ cls: "ct-stack-2" });
			loc.createSpan({ cls: "ct-faint ct-11", text: "Location" });
			renderLinkish(this.app, loc, e.location, e.path, "ct-13");
		}
		const note = el.createDiv({ cls: "ct-stack-2" });
		note.createSpan({ cls: "ct-faint ct-11", text: "Note" });
		const base = e.path.split("/").pop()!.replace(/\.md$/, "");
		renderLinkish(this.app, note, `[[${e.path.replace(/\.md$/, "")}|${base}]]`, "", "ct-13").setText(`[[${base}]]`);
		el.createDiv({ cls: "ct-spacer" });
		const open = button(el, "Open note", () => this.openNote(e.path));
		setIcon(open.createSpan({ cls: "ct-btn-icon" }), "arrow-up-right");
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}
