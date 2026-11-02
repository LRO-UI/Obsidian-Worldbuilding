import { debounce, Keymap, Menu, normalizePath, Notice, PaneType, stringifyYaml, TFile, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import { buildMapModel, isVisibleAt, MapBorder, MapData, MapItem, MapModel, MapPin, parseMap, place, PLACE_TYPES, REALM_TYPES, removeItem, simplifyPath, writeBorder, writePin } from "../maps";
import { ensureFolder, joinPath, linkBasename, resolveFirstLink, safeFileName } from "../model";
import { MapItemFields, MapItemModal } from "../modals/MapItemModal";
import { THEME_COLORS } from "../settings";
import { button, resolveImage, svgEl } from "../ui/components";
import { NoteSheetState, NoteSheetView } from "./NoteSheetView";

export const VIEW_MAP = "map-sheet";

type Tool = "view" | "pins" | "borders";
type Layer = "pins" | "borders";

interface MapViewState extends NoteSheetState {
	date?: number | null;
	hidden?: Layer[];
	focus?: string;
}

type DrawnPin = MapModel["pins"][number];
type DrawnBorder = MapModel["borders"][number];

interface Press {
	id: number;
	x: number;
	y: number;
	camX: number;
	camY: number;
	moved: boolean;
	pin?: DrawnPin;
	/** Where on the pin it was grabbed, relative to its tip. */
	grab?: [number, number];
	border?: DrawnBorder;
	/** Corner of the selected border being dragged. */
	vertex?: number;
	/** Edge of the selected border; dragging it inserts a corner. */
	edge?: number;
	/** Tracing a border freehand. */
	lasso?: boolean;
	/** Middle button: pans whatever is under it. */
	pan?: boolean;
}

/** What the side list has picked, waiting to be marked on the map. */
interface Armed {
	note: string;
	name: string;
	/** Typed into the search box; its note is created when it's placed. */
	isNew: boolean;
}

const MARKER = "M0,0 C-2,-8 -11,-13 -11,-21 A11,11 0 1 1 11,-21 C11,-13 2,-8 0,0 Z";

const TOOLS: [Tool, string][] = [["view", "View"], ["pins", "Pins"], ["borders", "Borders"]];
const MAX_TICKS = 60;
const colorVar = (c: string) => (c ? `var(--color-${c})` : "var(--interactive-accent)");

/** A `type: map` note: an image with pins and dated borders on top, filtered by the in-world calendar. */
export class MapView extends NoteSheetView {
	protected readonly noteType = "map";
	protected readonly fallbackTitle = "Map";

	private data: MapData = { image: "", pins: [], borders: [] };
	private model: MapModel = { pins: [], borders: [], stops: [] };
	private signature = "";
	private src: string | null = null;
	private width = 0;
	private height = 0;

	private tool: Tool = "view";
	/** Month index the map is filtered to; null shows everything. */
	private date: number | null = null;
	private hidden = new Set<Layer>();
	private selected: number | null = null;
	private draft: [number, number][] | null = null;
	private drawMode: "lasso" | "corners" = "lasso";
	private armed: Armed | null = null;
	private query = "";
	/** A border drawn while filtered to a date starts at that date. */
	private startsHere = true;
	/** The item the side list just added, offered for dates or undo. */
	private lastAdded: { kind: "pin"; item: MapPin; hidden: boolean } | { kind: "border"; item: MapBorder; hidden: boolean } | null = null;
	private pendingFocus: string | null = null;
	/** The leaf pins open their sheets in, so the map stays visible. */
	private sheetLeaf: WorkspaceLeaf | null = null;

	private toolbar: HTMLElement | null = null;
	private stage: HTMLElement | null = null;
	private svg: SVGSVGElement | null = null;
	private viewport: SVGGElement | null = null;
	private imageEl: SVGImageElement | null = null;
	private borderLayer: SVGGElement | null = null;
	private handleLayer: SVGGElement | null = null;
	private pinLayer: SVGGElement | null = null;
	private hint: HTMLElement | null = null;
	private timeEl: HTMLElement | null = null;
	private panel: HTMLElement | null = null;
	private panelList: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private pinEls = new Map<number, SVGGElement>();
	private borderEls = new Map<number, { group: SVGGElement; shape: SVGPolygonElement; label: SVGTextElement }>();

	private cam = { x: 0, y: 0, k: 1 };
	/** Refit on resize until the user pans or zooms. */
	private autoFit = true;
	private press: Press | null = null;
	private touches = new Map<number, { x: number; y: number }>();
	private pinch: { dist: number; k: number; x: number; y: number; camX: number; camY: number } | null = null;
	private cursor: [number, number] | null = null;

	getViewType(): string {
		return VIEW_MAP;
	}
	getIcon(): string {
		return "map";
	}

	protected openEditor(): void {
		if (this.file) this.plugin.openMapModal({ file: this.file });
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), date: this.date, hidden: [...this.hidden] };
	}

	async setState(state: MapViewState, result: ViewStateResult): Promise<void> {
		if (state.date !== undefined) this.date = state.date;
		if (Array.isArray(state.hidden)) this.hidden = new Set(state.hidden);
		if (state.focus) this.pendingFocus = state.focus;
		return super.setState(state, result);
	}

	/** Centres the pin linked to this note. */
	focusPin(path: string): void {
		this.pendingFocus = path;
		this.applyFocus();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("ct-map");
		// Pins and stops also depend on the linked notes and on events.
		const refresh = debounce(() => this.render(), 300, true);
		this.registerEvent(this.app.metadataCache.on("changed", refresh));
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
		await super.onOpen();
	}

	/** Redraws after a settings change, such as new month names. */
	redraw(): void {
		this.signature = "";
		this.render();
	}

	// ---------- drawing ----------

	/** Replaces the base render: the image and camera survive updates, and a drag or a border in progress isn't interrupted. */
	async render(): Promise<void> {
		if (this.press?.moved || this.draft) return;
		const file = this.file;
		const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
		if (!file || !fm || !this.accepts(fm.type)) {
			this.signature = "";
			this.src = null;
			this.stage = null;
			this.contentEl.empty();
			this.renderEmpty(this.contentEl);
			return;
		}
		this.renderSheet(this.contentEl, file, fm);
	}

	protected renderEmpty(root: HTMLElement): void {
		const box = root.createDiv({ cls: "ct-empty" });
		setIcon(box.createDiv({ cls: "ct-empty-icon" }), "map");
		box.createDiv({ cls: "ct-empty-title", text: this.file ? "This note isn't a map" : "No map selected" });
		box.createDiv({ cls: "ct-empty-text", text: "Map notes have type: map in their frontmatter." });
		button(box, "Create new map", () => this.plugin.openMapModal(), "ct-btn mod-cta");
	}

	protected renderSheet(root: HTMLElement, file: TFile, fm: Record<string, unknown>): void {
		const data = parseMap(fm);
		const src = resolveImage(this.app, data.image, file.path);
		const model = buildMapModel(this.app, file.path, data);
		const sig = JSON.stringify([
			src,
			data,
			model.pins.map((p) => [p.name, p.file?.path, p.start, p.end, p.events.map((e) => [e.title, e.start, e.end])]),
			model.borders.map((b) => [b.name, b.file?.path, b.start, b.end]),
			model.stops,
		]);
		if (sig === this.signature && (this.stage?.isConnected || !src)) return;
		this.signature = sig;
		this.data = data;
		this.model = model;
		if (this.selected != null && !model.borders.some((b) => b.index === this.selected)) this.selected = null;

		if (!src) {
			this.stage = null;
			this.src = null;
			root.empty();
			const box = root.createDiv({ cls: "ct-empty" });
			setIcon(box.createDiv({ cls: "ct-empty-icon" }), "image-plus");
			box.createDiv({ cls: "ct-empty-title", text: data.image ? `Image not found: ${linkBasename(data.image)}` : "This map has no image yet" });
			box.createDiv({ cls: "ct-empty-text", text: "Choose an image from your vault, or import one from your computer." });
			button(box, "Choose image", () => this.openEditor(), "ct-btn mod-cta");
			return;
		}

		if (!this.stage?.isConnected) this.buildShell(root);
		this.renderToolbar();
		this.renderTime();
		this.renderPanel();
		if (src === this.src) this.drawOverlays();
		else this.loadImage(src);
	}

	private buildShell(root: HTMLElement): void {
		root.empty();
		this.src = null;
		this.toolbar = root.createDiv({ cls: "ct-tl-toolbar" });
		const body = root.createDiv({ cls: "ct-map-body" });
		this.stage = body.createDiv({ cls: "ct-map-stage", attr: { tabindex: "-1" } });
		this.panel = body.createDiv({ cls: "ct-map-panel" });
		this.svg = svgEl(this.stage, "svg", { class: "ct-map-svg" });
		this.viewport = svgEl(this.svg, "g");
		this.imageEl = svgEl(this.viewport, "image", { preserveAspectRatio: "none" });
		this.borderLayer = svgEl(this.viewport, "g");
		this.pinLayer = svgEl(this.viewport, "g");
		this.handleLayer = svgEl(this.viewport, "g");
		this.hint = this.stage.createDiv({ cls: "ct-map-hint" });
		this.timeEl = root.createDiv({ cls: "ct-map-time" });
		this.bindPointer(this.svg);
		this.bindDrop(this.stage);
		this.stage.addEventListener("keydown", (e) => this.onKey(e));
		// Also catches the date bar changing height, which onResize doesn't.
		const observer = new ResizeObserver(() => {
			if (this.autoFit) this.fit();
		});
		observer.observe(this.stage);
		this.register(() => observer.disconnect());
	}

	private loadImage(src: string): void {
		this.src = src;
		const img = new Image();
		img.onload = () => {
			if (src !== this.src || !this.imageEl) return;
			this.width = img.naturalWidth || 1000;
			this.height = img.naturalHeight || 1000;
			this.imageEl.setAttr("href", src);
			this.imageEl.setAttr("width", this.width);
			this.imageEl.setAttr("height", this.height);
			this.autoFit = true;
			this.drawOverlays();
			this.fit();
			this.applyFocus();
		};
		img.onerror = () => {
			if (src === this.src) new Notice(`Couldn't load the map image ${linkBasename(this.data.image)}.`);
		};
		img.src = src;
	}

	private renderToolbar(): void {
		const bar = this.toolbar!;
		bar.empty();
		bar.createSpan({ cls: "ct-tl-name", text: String(this.file?.basename ?? "Map") });
		this.countEl = bar.createSpan({ cls: "ct-mono ct-faint ct-12" });

		const seg = bar.createDiv({ cls: "ct-seg" });
		for (const [t, label] of TOOLS) {
			const item = seg.createDiv({ cls: `ct-seg-item ${this.tool === t ? "is-active" : ""}`, text: label });
			item.addEventListener("click", () => this.setTool(t));
		}

		bar.createDiv({ cls: "ct-spacer" });
		const legend = bar.createDiv({ cls: "ct-legend" });
		for (const [layer, label] of [["pins", "Pins"], ["borders", "Borders"]] as [Layer, string][]) {
			const off = this.hidden.has(layer);
			const item = legend.createSpan({ cls: `ct-legend-item ct-rg-toggle ${off ? "is-off" : ""}`, text: label, attr: { role: "button", tabindex: "0", "aria-pressed": String(!off), "aria-label": `${off ? "Show" : "Hide"} ${label.toLowerCase()}` } });
			const toggle = () => {
				if (off) this.hidden.delete(layer);
				else this.hidden.add(layer);
				this.app.workspace.requestSaveLayout();
				this.renderToolbar();
				this.applyDate();
			};
			item.addEventListener("click", toggle);
			item.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					toggle();
				}
			});
		}

		const iconBtn = (icon: string, label: string, onClick: () => void) => {
			const b = bar.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": label } });
			setIcon(b, icon);
			b.addEventListener("click", onClick);
		};
		const zoomBy = (f: number) => this.zoomAt(this.stage!.clientWidth / 2, this.stage!.clientHeight / 2, this.cam.k * f);
		iconBtn("zoom-out", "Zoom out", () => zoomBy(1 / 1.4));
		iconBtn("zoom-in", "Zoom in", () => zoomBy(1.4));
		iconBtn("scan", "Fit to view", () => {
			this.autoFit = true;
			this.fit();
		});
		this.updateCount();
	}

	private setTool(tool: Tool): void {
		if (this.draft) this.cancelDraft();
		this.tool = tool;
		this.selected = null;
		this.armed = null;
		this.lastAdded = null;
		this.query = "";
		this.renderToolbar();
		this.renderPanel();
		this.drawOverlays();
	}

	// ---------- side list ----------

	private renderPanel(): void {
		const el = this.panel;
		if (!el) return;
		const typing = document.activeElement?.classList.contains("ct-map-search");
		el.empty();
		this.panelList = null;
		el.toggleClass("is-hidden", this.tool === "view");
		if (this.tool === "view") return;
		const pins = this.tool === "pins";
		el.createDiv({ cls: "ct-h16", text: pins ? "Add a pin" : "Add a border" });
		el.createDiv({ cls: "ct-faint ct-12", text: pins ? "Choose a place, then click the map." : "Choose a realm, then outline it on the map." });

		if (!pins) {
			const seg = el.createDiv({ cls: "ct-seg ct-map-modes" });
			for (const [mode, label] of [["lasso", "Lasso"], ["corners", "Corners"]] as ["lasso" | "corners", string][]) {
				seg.createDiv({ cls: `ct-seg-item ${this.drawMode === mode ? "is-active" : ""}`, text: label }).addEventListener("click", () => {
					if (this.draft) this.cancelDraft();
					this.drawMode = mode;
					this.renderPanel();
					this.renderHint();
				});
			}
			const at = this.dateShown();
			if (at != null) {
				const lab = el.createEl("label", { cls: "ct-row-6 ct-12" });
				const cb = lab.createEl("input", { type: "checkbox" });
				cb.checked = this.startsHere;
				cb.addEventListener("change", () => (this.startsHere = cb.checked));
				lab.appendText(`Starts in ${this.plugin.calendar.format(at)}`);
			}
		}

		const added = this.lastAdded;
		if (added) {
			const strip = el.createDiv({ cls: "ct-map-added" });
			strip.createDiv({ cls: "ct-13", text: `${added.item.label || linkBasename(added.item.note) || "Border"} added.${added.hidden ? " It isn't shown at this date." : ""}` });
			const row = strip.createDiv({ cls: "ct-row-8" });
			button(row, "Set dates", () => {
				this.lastAdded = null;
				this.renderPanel();
				if (added.kind === "pin") this.editPin(added.item);
				else this.editBorder(added.item);
			}, "ct-btn is-small");
			button(row, "Undo", () => {
				if (added.kind === "pin") this.removePin(added.item);
				else this.removeBorder(added.item);
			}, "ct-btn is-small");
		}

		const search = el.createEl("input", { type: "text", cls: "ct-map-search", value: this.query, attr: { placeholder: pins ? "Search or name a new place" : "Search or name a new realm", "aria-label": "Search notes" } });
		search.addEventListener("input", () => {
			this.query = search.value;
			this.renderPanelList();
		});
		this.panelList = el.createDiv({ cls: "ct-map-list" });
		this.renderPanelList();
		if (typing) search.focus();
	}

	private renderPanelList(): void {
		const el = this.panelList;
		if (!el) return;
		el.empty();
		const pins = this.tool === "pins";
		const placed = pins ? this.model.pins : this.model.borders;
		const onMap = new Set(placed.map((p) => p.file?.path));
		const q = this.query.trim();
		const lower = q.toLowerCase();
		const types = pins ? PLACE_TYPES : REALM_TYPES;
		const typeOf = (f: TFile) => this.app.metadataCache.getFileCache(f)?.frontmatter?.type;
		const rank = (f: TFile) => (types.includes(typeOf(f)) ? 0 : 1);
		const all = this.app.vault.getMarkdownFiles();
		// Searching reaches every note; the unfiltered list is only the likely ones.
		const choices = all
			.filter((f) => typeOf(f) !== "map" && !onMap.has(f.path) && (q ? f.basename.toLowerCase().includes(lower) : rank(f) === 0))
			.sort((a, b) => rank(a) - rank(b) || a.basename.localeCompare(b.basename))
			.slice(0, 50);

		const row = (parent: HTMLElement, name: string, sub: string, onClick: () => void, cls = "") => {
			const r = parent.createDiv({ cls: `ct-map-row ${cls}`, attr: { role: "button", tabindex: "0" } });
			r.createSpan({ cls: "ct-map-row-name", text: name });
			if (sub) r.createSpan({ cls: "ct-faint ct-11", text: sub });
			r.addEventListener("click", onClick);
			r.addEventListener("keydown", (e) => {
				if (e.key !== "Enter" && e.key !== " ") return;
				e.preventDefault();
				onClick();
			});
		};

		el.createDiv({ cls: "ct-label", text: `Not on the map yet · ${choices.length}` });
		for (const f of choices) {
			const note = `[[${this.app.metadataCache.fileToLinktext(f, this.file?.path ?? "", true)}]]`;
			const type = typeOf(f);
			row(el, f.basename, typeof type === "string" ? type : "", () => this.arm({ note, name: f.basename, isNew: false }), this.armed?.note === note ? "is-armed" : "");
		}
		if (q && !all.some((f) => f.basename.toLowerCase() === lower)) {
			row(el, `Create “${q}”`, pins ? "new city" : "new faction", () => this.arm({ note: `[[${q}]]`, name: q, isNew: true }), this.armed?.isNew && this.armed.name === q ? "is-armed" : "");
		} else if (!choices.length) {
			el.createDiv({ cls: "ct-faint ct-12", text: q ? "No other notes match." : pins ? "Every place is on the map. Type a name to add a new one." : "No factions or regions left. Type a name to add a new one." });
		}

		const shown = placed.filter((p) => !q || p.name.toLowerCase().includes(lower));
		if (!shown.length) return;
		el.createDiv({ cls: "ct-label", text: `On the map · ${shown.length}` });
		for (const p of shown) {
			const name = p.name || "Unnamed";
			if (pins) row(el, name, "edit", () => this.editPin(p as DrawnPin));
			else row(el, name, "reshape", () => this.selectBorder(p.index), this.selected === p.index ? "is-armed" : "");
		}
	}

	/** The side list's pick: the next click or outline on the map is for this. Picking it again lets go. */
	private arm(armed: Armed): void {
		if (this.draft) this.cancelDraft();
		this.armed = this.armed?.note === armed.note ? null : armed;
		this.selected = null;
		this.cursor = null;
		this.drawHandles();
		this.renderHint();
		this.renderPanelList();
		if (this.armed) this.stage?.focus({ preventScroll: true });
	}

	private disarm(): void {
		this.armed = null;
		this.cursor = null;
		this.drawHandles();
		this.renderHint();
		this.renderPanelList();
	}

	/** The armed note's link, creating the note first if it was typed in as a new name. */
	private async armedNote(armed: Armed, type: "city" | "faction"): Promise<string | null> {
		if (!armed.isNew) return armed.note;
		const s = this.plugin.settings;
		const file = await this.createNote(armed.note, type, type === "city" ? s.citiesFolder : s.factionsFolder);
		return file ? `[[${this.app.metadataCache.fileToLinktext(file, this.file?.path ?? "", true)}]]` : null;
	}

	private async placeArmedPin(x: number, y: number): Promise<void> {
		const armed = this.armed;
		if (!armed) return;
		const note = await this.armedNote(armed, "city");
		if (!note) return;
		const pin: MapPin = { index: -1, note, label: "", color: "", from: null, to: null, x, y };
		await this.savePin(pin);
		this.lastAdded = { kind: "pin", item: pin, hidden: !isVisibleAt(place(this.app, pin, this.file?.path ?? ""), this.dateShown()) };
		this.armed = null;
		this.cursor = null;
		this.query = "";
		this.drawHandles();
		this.renderHint();
		this.renderPanel();
	}

	private drawOverlays(): void {
		if (!this.svg || !this.width) return;
		this.svg.dataset.tool = this.tool;
		this.pinEls.clear();
		this.borderEls.clear();
		this.borderLayer!.empty();
		this.pinLayer!.empty();
		for (const b of this.model.borders) this.drawBorder(b);
		for (const p of this.model.pins) this.drawPin(p);
		this.drawHandles();
		this.renderHint();
		this.applyCamera();
		this.applyDate();
	}

	private drawBorder(b: DrawnBorder): void {
		const group = svgEl(this.borderLayer!, "g", { class: `ct-map-border ${b.note ? "has-note" : ""}`, role: b.note ? "link" : "img", "aria-label": b.name || "Unnamed border" });
		group.dataset.index = String(b.index);
		group.style.setProperty("--ct-c", colorVar(b.color));
		const shape = svgEl(group, "polygon", { class: "ct-map-area" });
		const label = svgEl(group, "text", { class: "ct-map-area-label" });
		label.textContent = b.name;
		svgEl(group, "title").textContent = `${b.name || "Unnamed border"}${this.rangeText(b)}`;
		this.borderEls.set(b.index, { group, shape, label });
		this.placeBorder(b);
		if (b.note) {
			group.addEventListener("pointerenter", (e) => this.hoverLink(e, group, b));
		}
	}

	private drawPin(p: DrawnPin): void {
		const g = svgEl(this.pinLayer!, "g", { class: `ct-map-pin ${p.note && !p.file ? "is-unresolved" : ""}`, tabindex: 0, role: "link", "aria-label": p.name || "Unnamed pin" });
		g.dataset.index = String(p.index);
		g.style.setProperty("--ct-c", colorVar(p.color));
		svgEl(g, "circle", { class: "ct-map-pulse", cy: -21, r: 11 });
		svgEl(g, "path", { class: "ct-map-marker", d: MARKER });
		svgEl(g, "circle", { class: "ct-map-marker-dot", cy: -21, r: 4 });
		const label = svgEl(g, "text", { class: "ct-map-pin-label", x: 15, y: -21 });
		label.textContent = p.name;
		const here = p.events.map((e) => `\n${e.title} · ${this.plugin.calendar.shortRange(e.start, e.end)}`).join("");
		svgEl(g, "title").textContent = `${p.name || "Unnamed pin"}${p.note && !p.file ? " (no note yet)" : ""}${this.rangeText(p)}${here}`;
		g.addEventListener("pointerenter", (e) => this.hoverLink(e, g, p));
		g.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.stopPropagation();
			if (this.tool === "view") this.openItem(p, Keymap.isModEvent(e));
			else this.editPin(p);
		});
		this.pinEls.set(p.index, g);
	}

	private hoverLink(e: PointerEvent, el: Element, item: { file: TFile | null }): void {
		if (item.file) this.app.workspace.trigger("hover-link", { event: e, source: "worldbuilding", hoverParent: this.contentEl, targetEl: el, linktext: item.file.path, sourcePath: "" });
	}

	private rangeText(item: { start: number | null; end: number | null }): string {
		const cal = this.plugin.calendar;
		if (item.start != null && item.end != null) return item.start === item.end ? `\n${cal.format(item.start)}` : `\n${cal.format(item.start)} → ${cal.format(item.end)}`;
		if (item.start != null) return `\nFrom ${cal.format(item.start)}`;
		return item.end != null ? `\nUntil ${cal.format(item.end)}` : "";
	}

	private placePin(p: MapPin): void {
		this.pinEls.get(p.index)?.setAttr("transform", `translate(${(p.x * this.width).toFixed(1)},${(p.y * this.height).toFixed(1)}) scale(${(1 / this.cam.k).toFixed(4)})`);
	}

	private placeBorder(b: MapBorder): void {
		const els = this.borderEls.get(b.index);
		if (!els) return;
		els.shape.setAttr("points", b.points.map(([x, y]) => `${(x * this.width).toFixed(1)},${(y * this.height).toFixed(1)}`).join(" "));
		const cx = (b.points.reduce((s, p) => s + p[0], 0) / b.points.length) * this.width;
		const cy = (b.points.reduce((s, p) => s + p[1], 0) / b.points.length) * this.height;
		els.label.setAttr("transform", `translate(${cx.toFixed(1)},${cy.toFixed(1)}) scale(${(1 / this.cam.k).toFixed(4)})`);
	}

	/** Corners and edge midpoints of the selected border, and the border being drawn. */
	private drawHandles(): void {
		const layer = this.handleLayer;
		if (!layer) return;
		layer.empty();
		const dot = (x: number, y: number, cls: string, r: number, data: Record<string, number> = {}) => {
			const c = svgEl(layer, "circle", { class: cls, r: r / this.cam.k, cx: x * this.width, cy: y * this.height });
			for (const [k, v] of Object.entries(data)) c.dataset[k] = String(v);
		};
		if (this.armed && this.tool === "pins" && this.cursor) {
			const ghost = svgEl(layer, "g", { class: "ct-map-ghost", transform: `translate(${this.cursor[0] * this.width},${this.cursor[1] * this.height}) scale(${1 / this.cam.k})` });
			svgEl(ghost, "path", { class: "ct-map-marker", d: MARKER });
			return;
		}
		if (this.draft) {
			const pts = [...this.draft, ...(this.cursor ? [this.cursor] : [])];
			svgEl(layer, "polyline", { class: "ct-map-draft", points: pts.map(([x, y]) => `${x * this.width},${y * this.height}`).join(" ") });
			this.draft.forEach(([x, y], i) => dot(x, y, `ct-map-handle ${i === 0 && this.draft!.length >= 3 ? "is-closing" : ""}`, i === 0 && this.draft!.length >= 3 ? 8 : 5));
			return;
		}
		const b = this.selectedBorder();
		if (!b || this.tool !== "borders") return;
		b.points.forEach(([x, y], i) => {
			const [nx, ny] = b.points[(i + 1) % b.points.length];
			dot((x + nx) / 2, (y + ny) / 2, "ct-map-handle is-mid", 4, { edge: i });
		});
		b.points.forEach(([x, y], i) => dot(x, y, "ct-map-handle", 6, { vertex: i }));
	}

	private selectedBorder(): DrawnBorder | null {
		return this.model.borders.find((b) => b.index === this.selected) ?? null;
	}

	private renderHint(): void {
		const el = this.hint;
		if (!el) return;
		el.empty();
		let text = "";
		const b = this.selectedBorder();
		const lasso = this.drawMode === "lasso";
		const name = this.armed?.name;
		if (this.draft && lasso) text = "Keep holding and trace the outline. Let go to close it.";
		else if (this.draft) text = "Click to add corners. Double-click, press Enter or click the first corner to close it. Esc cancels.";
		else if (name && this.tool === "pins") text = `Click the map where ${name} goes. Esc cancels.`;
		else if (name) text = lasso ? `Hold and drag around ${name}, then let go. Scroll to zoom, drag with the middle button to pan. Esc cancels.` : `Click around ${name} to place its corners. Esc cancels.`;
		else if (this.tool === "pins") text = "Choose a place from the list, or click the map to drop a pin by hand. Drag a pin to move it; click it to edit.";
		else if (this.tool === "borders" && b) text = `${b.name || "Unnamed border"}: drag a corner to reshape, drag a small dot to add a corner, right-click a corner to remove it.`;
		else if (this.tool === "borders") text = lasso ? "Choose a realm from the list, or drag around any area to outline it. Click a border to reshape it." : "Choose a realm from the list, or click the map to start placing corners. Click a border to reshape it.";
		else if (!this.model.pins.length && !this.model.borders.length) text = "Nothing on this map yet. Switch to Pins to drop your first pin, or Borders to draw a realm.";
		el.toggleClass("is-hidden", !text);
		el.createSpan({ text });
		if (this.draft && !lasso) {
			if (this.draft.length >= 3) button(el, "Close border", () => this.finishDraft(), "ct-btn mod-cta is-small");
			button(el, "Cancel", () => this.cancelDraft(), "ct-btn is-small");
		} else if (this.tool === "borders" && b) {
			button(el, "Details", () => this.editBorder(b), "ct-btn is-small");
		}
	}

	// ---------- date filter ----------

	private stopIndex(): number {
		const stops = this.model.stops;
		let i = 0;
		if (this.date != null) stops.forEach((s, n) => {
			if (s.at <= this.date!) i = n;
		});
		return i;
	}

	/** The date the map is showing, snapped to a stop; null when it shows everything. */
	private dateShown(): number | null {
		return this.date == null ? null : this.model.stops[this.stopIndex()]?.at ?? this.date;
	}

	private setDate(at: number | null): void {
		this.date = at;
		this.app.workspace.requestSaveLayout();
		this.applyDate();
		if (this.tool === "borders") this.renderPanel();
	}

	private renderTime(): void {
		const el = this.timeEl;
		if (!el) return;
		el.empty();
		const stops = this.model.stops;
		el.toggleClass("is-hidden", !stops.length);
		if (!stops.length) return;
		const seg = el.createDiv({ cls: "ct-seg" });
		const on = this.date != null;
		seg.createDiv({ cls: `ct-seg-item ${on ? "" : "is-active"}`, text: "All dates" }).addEventListener("click", () => {
			if (!on) return;
			this.setDate(null);
			this.renderTime();
		});
		seg.createDiv({ cls: `ct-seg-item ${on ? "is-active" : ""}`, text: "By date" }).addEventListener("click", () => {
			if (on) return;
			// Start at the story's present.
			const now = this.plugin.settings.currentYear * 12;
			this.setDate([...stops].reverse().find((s) => s.at <= now)?.at ?? stops[0].at);
			this.renderTime();
		});
		if (!on) {
			el.createSpan({ cls: "ct-faint ct-12", text: `${stops.length} date${stops.length === 1 ? "" : "s"} change this map. Choose By date to step through them.` });
			this.applyDate();
			return;
		}

		const step = (d: number) => {
			const next = stops[this.stopIndex() + d];
			if (next) this.setDate(next.at);
		};
		const prev = el.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": "Previous change" } });
		setIcon(prev, "chevron-left");
		prev.addEventListener("click", () => step(-1));

		// One notch per change: nothing differs between two stops, and long gaps between eras don't squeeze the recent ones.
		const track = el.createDiv({ cls: "ct-map-track" });
		const max = stops.length - 1;
		const slider = track.createEl("input", { type: "range", cls: "slider ct-map-slider", attr: { min: "0", max: String(max), step: "1", "aria-label": "Map date" } });
		slider.disabled = !max;
		slider.addEventListener("input", () => this.setDate(stops[Number(slider.value)].at));
		if (max && stops.length <= MAX_TICKS) {
			const ticks = track.createDiv({ cls: "ct-map-ticks" });
			stops.forEach((_, i) => (ticks.createSpan({ cls: "ct-map-tick" }).style.left = `calc(8px + (100% - 16px) * ${i / max})`));
		}

		const next = el.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": "Next change" } });
		setIcon(next, "chevron-right");
		next.addEventListener("click", () => step(1));

		const label = el.createDiv({ cls: "ct-map-when" });
		label.createDiv({ cls: "ct-map-when-date ct-mono ct-13" });
		label.createDiv({ cls: "ct-map-when-what ct-faint ct-12" });
		this.applyDate();
	}

	/** Shows what exists at the selected date, without rebuilding anything the slider is holding on to. */
	private applyDate(): void {
		const stops = this.model.stops;
		const i = this.stopIndex();
		const at = this.dateShown();
		const showPins = !this.hidden.has("pins");
		const showBorders = !this.hidden.has("borders");
		let pins = 0;
		for (const p of this.model.pins) {
			const on = isVisibleAt(p, at);
			if (on) pins++;
			const el = this.pinEls.get(p.index);
			el?.toggleClass("is-hidden", !on || !showPins);
			el?.toggleClass("is-active", at != null && p.events.some((e) => isVisibleAt({ start: e.start, end: e.end ?? e.start }, at)));
		}
		let borders = 0;
		for (const b of this.model.borders) {
			const on = isVisibleAt(b, at);
			if (on) borders++;
			this.borderEls.get(b.index)?.group.toggleClass("is-hidden", !on || !showBorders);
		}
		this.updateCount(pins, borders);

		const el = this.timeEl;
		if (!el || at == null) return;
		const slider = el.querySelector<HTMLInputElement>(".ct-map-slider");
		if (slider) slider.value = String(i);
		const buttons = el.querySelectorAll<HTMLButtonElement>(".ct-icon-btn");
		if (buttons.length === 2) {
			buttons[0].disabled = i === 0;
			buttons[1].disabled = i === stops.length - 1;
		}
		const abbr = this.plugin.settings.eraAbbr;
		el.querySelector(".ct-map-when-date")?.setText(`${this.plugin.calendar.format(at)}${abbr ? ` ${abbr}` : ""}`);
		const changes = stops[i]?.changes ?? [];
		el.querySelector(".ct-map-when-what")?.setText(changes.slice(0, 2).join(" · ") + (changes.length > 2 ? ` · +${changes.length - 2} more` : ""));
	}

	private updateCount(pins = this.model.pins.length, borders = this.model.borders.length): void {
		this.countEl?.setText(`${pins} pin${pins === 1 ? "" : "s"} · ${borders} border${borders === 1 ? "" : "s"}`);
	}

	// ---------- camera ----------

	private applyCamera(): void {
		this.viewport?.setAttr("transform", `translate(${this.cam.x.toFixed(1)},${this.cam.y.toFixed(1)}) scale(${this.cam.k.toFixed(4)})`);
		// Pins, labels and handles keep their size on screen at any zoom.
		for (const p of this.model.pins) this.placePin(p);
		for (const b of this.model.borders) this.placeBorder(b);
		this.drawHandles();
	}

	private fitScale(): number {
		return Math.min(this.stage!.clientWidth / this.width, this.stage!.clientHeight / this.height);
	}

	private fit(): void {
		if (!this.stage || !this.width) return;
		const w = this.stage.clientWidth, h = this.stage.clientHeight;
		if (!w || !h) return;
		const k = this.fitScale();
		this.cam = { k, x: (w - this.width * k) / 2, y: (h - this.height * k) / 2 };
		this.applyCamera();
	}

	private zoomAt(mx: number, my: number, target: number): void {
		if (!this.width) return;
		const min = this.fitScale() * 0.5;
		const k = Math.min(Math.max(min * 24, 4), Math.max(min, target));
		const f = k / this.cam.k;
		this.cam = { k, x: mx - (mx - this.cam.x) * f, y: my - (my - this.cam.y) * f };
		this.autoFit = false;
		this.applyCamera();
	}

	private applyFocus(): void {
		const path = this.pendingFocus;
		if (!path || !this.width || !this.stage) return;
		this.pendingFocus = null;
		const p = this.model.pins.find((x) => x.file?.path === path);
		const el = p && this.pinEls.get(p.index);
		if (!p || !el) return;
		// The pin may not exist at the selected date.
		if (!isVisibleAt(p, this.dateShown())) {
			this.setDate(null);
			this.renderTime();
		}
		const k = Math.max(this.cam.k, Math.min(this.fitScale() * 2.5, 2));
		this.autoFit = false;
		this.cam = { k, x: this.stage.clientWidth / 2 - p.x * this.width * k, y: this.stage.clientHeight / 2 - p.y * this.height * k };
		this.applyCamera();
		el.addClass("is-focused");
		window.setTimeout(() => el.removeClass("is-focused"), 1800);
	}

	// ---------- pointer ----------

	/** The image fraction under a pointer. */
	private toImage(e: MouseEvent): [number, number] {
		const r = this.svg!.getBoundingClientRect();
		return [(e.clientX - r.left - this.cam.x) / this.cam.k / this.width, (e.clientY - r.top - this.cam.y) / this.cam.k / this.height];
	}

	private hit(target: EventTarget | null): Pick<Press, "pin" | "border" | "vertex" | "edge"> {
		const el = target as Element;
		const handle = el.closest?.<SVGElement>(".ct-map-handle");
		if (handle?.dataset.vertex != null) return { border: this.selectedBorder() ?? undefined, vertex: Number(handle.dataset.vertex) };
		if (handle?.dataset.edge != null) return { border: this.selectedBorder() ?? undefined, edge: Number(handle.dataset.edge) };
		const index = (cls: string) => {
			const found = el.closest?.<SVGElement>(cls);
			return found ? Number(found.dataset.index) : null;
		};
		const pin = index(".ct-map-pin");
		if (pin != null) return { pin: this.model.pins.find((p) => p.index === pin) };
		const border = index(".ct-map-border");
		if (border != null) return { border: this.model.borders.find((b) => b.index === border) };
		return {};
	}

	private bindPointer(svg: SVGSVGElement): void {
		svg.addEventListener("pointerdown", (e) => {
			if (e.button > 1) return;
			if (e.button === 1) e.preventDefault();
			this.stage?.focus({ preventScroll: true });
			this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (this.touches.size === 2) {
				if (this.press?.lasso) this.cancelDraft();
				this.press = null;
				this.startPinch();
				return;
			}
			const pan = e.button === 1;
			// With something picked from the list, the map is only a place to mark it.
			const hit = pan || this.armed ? {} : this.hit(e.target);
			const lasso = !pan && this.tool === "borders" && this.drawMode === "lasso" && !this.draft && !hit.border;
			if (lasso) {
				this.draft = [this.toImage(e)];
				this.cursor = null;
				this.renderHint();
			}
			this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, camX: this.cam.x, camY: this.cam.y, moved: false, lasso, pan, ...hit };
			svg.setPointerCapture(e.pointerId);
		});
		svg.addEventListener("pointerleave", () => {
			if (!this.cursor || this.press) return;
			this.cursor = null;
			this.drawHandles();
		});
		svg.addEventListener("pointermove", (e) => {
			if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (this.pinch) {
				this.movePinch();
				return;
			}
			if ((this.draft && !this.press?.lasso) || (this.armed && this.tool === "pins")) {
				this.cursor = this.toImage(e);
				this.drawHandles();
			}
			const p = this.press;
			if (!p || p.id !== e.pointerId) return;
			if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
			this.dragTo(p, e);
		});
		const end = (e: PointerEvent) => {
			this.touches.delete(e.pointerId);
			if (this.touches.size < 2) this.pinch = null;
			const p = this.press;
			if (!p || p.id !== e.pointerId) return;
			this.press = null;
			svg.removeClass("is-panning");
			if (e.type === "pointercancel") {
				if (p.lasso) this.cancelDraft();
				return;
			}
			if (p.lasso) this.finishLasso(p.moved);
			else if (p.pan) return;
			else if (p.moved) this.dropped(p);
			else this.clicked(p, e);
		};
		svg.addEventListener("pointerup", end);
		svg.addEventListener("pointercancel", end);
		svg.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				const r = svg.getBoundingClientRect();
				this.zoomAt(e.clientX - r.left, e.clientY - r.top, this.cam.k * Math.exp(-e.deltaY * 0.0015));
			},
			{ passive: false }
		);
		svg.addEventListener("contextmenu", (e) => this.onContextMenu(e));
	}

	private startPinch(): void {
		const [a, b] = [...this.touches.values()];
		const r = this.svg!.getBoundingClientRect();
		this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: this.cam.k, x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top, camX: this.cam.x, camY: this.cam.y };
	}

	private movePinch(): void {
		const pinch = this.pinch!;
		const [a, b] = [...this.touches.values()];
		const r = this.svg!.getBoundingClientRect();
		const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
		this.cam.x = pinch.camX + mx - pinch.x;
		this.cam.y = pinch.camY + my - pinch.y;
		this.cam.k = pinch.k;
		this.zoomAt(mx, my, (pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist);
	}

	private dragTo(p: Press, e: PointerEvent): void {
		const clamp = (v: number) => Math.min(1, Math.max(0, v));
		const [x, y] = this.toImage(e);
		if (p.lasso) {
			p.moved = true;
			this.draft?.push([clamp(x), clamp(y)]);
			this.drawHandles();
			return;
		}
		if (!p.moved && p.pin) p.grab = [x - p.pin.x, y - p.pin.y];
		p.moved = true;
		if (this.tool === "pins" && p.pin) {
			// Held where it was grabbed, so the marker doesn't jump to put its tip under the pointer.
			p.pin.x = clamp(x - p.grab![0]);
			p.pin.y = clamp(y - p.grab![1]);
			this.placePin(p.pin);
			return;
		}
		if (this.tool === "borders" && p.border && (p.vertex != null || p.edge != null)) {
			if (p.edge != null) {
				p.border.points.splice(p.edge + 1, 0, [x, y]);
				p.vertex = p.edge + 1;
				p.edge = undefined;
			}
			p.border.points[p.vertex!] = [clamp(x), clamp(y)];
			this.placeBorder(p.border);
			this.drawHandles();
			return;
		}
		this.autoFit = false;
		this.svg?.addClass("is-panning");
		this.cam.x = p.camX + e.clientX - p.x;
		this.cam.y = p.camY + e.clientY - p.y;
		this.applyCamera();
	}

	/** A drag ended: keep the pin's or corner's new position. Panning has nothing to save. */
	private dropped(p: Press): void {
		if (this.tool === "pins" && p.pin) this.savePin(p.pin);
		else if (this.tool === "borders" && p.border && p.vertex != null) this.saveBorder(p.border);
	}

	private clicked(p: Press, e: PointerEvent): void {
		const [x, y] = this.toImage(e);
		const onImage = x >= 0 && x <= 1 && y >= 0 && y <= 1;
		if (this.armed && this.tool === "pins") {
			if (onImage) this.placeArmedPin(x, y);
		} else if (this.tool === "view") {
			const item = p.pin ?? p.border;
			if (item?.note) this.openItem(item, Keymap.isModEvent(e));
		} else if (this.tool === "pins") {
			if (p.pin) this.editPin(p.pin);
			else if (onImage) this.newPin(x, y);
		} else if (this.draft) {
			if (onImage) this.addCorner(x, y);
		} else if (p.vertex == null && p.edge == null) {
			if (p.border) this.selectBorder(p.border.index);
			else if (this.selected != null) this.selectBorder(null);
			else if (onImage) this.startDraft(x, y);
		}
	}

	private onContextMenu(e: MouseEvent): void {
		e.preventDefault();
		const at = this.toImage(e);
		const target = this.hit(e.target);
		const menu = new Menu();
		const item = target.pin ?? target.border;
		if (target.vertex != null && target.border) {
			const b = target.border;
			const vertex = target.vertex;
			menu.addItem((i) =>
				i.setTitle("Remove this corner").setIcon("x").setDisabled(b.points.length <= 3).onClick(() => {
					b.points.splice(vertex, 1);
					this.placeBorder(b);
					this.drawHandles();
					this.saveBorder(b);
				})
			);
		} else if (item) {
			if (item.note) menu.addItem((i) => i.setTitle("Open note").setIcon("arrow-up-right").onClick(() => this.openItem(item, false)));
			if (target.pin) {
				const pin = target.pin;
				menu.addItem((i) => i.setTitle("Edit pin").setIcon("pencil").onClick(() => this.editPin(pin)));
				menu.addItem((i) => i.setTitle("Remove pin").setIcon("trash").onClick(() => this.removePin(pin)));
			} else if (target.border) {
				const b = target.border;
				menu.addItem((i) => i.setTitle("Edit border details").setIcon("pencil").onClick(() => this.editBorder(b)));
				menu.addItem((i) =>
					i.setTitle("Reshape border").setIcon("spline").onClick(() => {
						this.tool = "borders";
						this.selected = b.index;
						this.renderToolbar();
						this.drawOverlays();
					})
				);
				menu.addItem((i) => i.setTitle("Remove border").setIcon("trash").onClick(() => this.removeBorder(b)));
			}
		} else if (at[0] >= 0 && at[0] <= 1 && at[1] >= 0 && at[1] <= 1) {
			menu.addItem((i) => i.setTitle("Add pin here").setIcon("map-pin").onClick(() => this.newPin(at[0], at[1])));
		}
		menu.showAtMouseEvent(e);
	}

	private onKey(e: KeyboardEvent): void {
		if (this.draft) {
			if (e.key === "Escape") this.cancelDraft();
			else if (e.key === "Enter") this.finishDraft();
			else if (e.key === "Backspace") {
				this.draft.pop();
				if (!this.draft.length) this.cancelDraft();
				else {
					this.drawHandles();
					this.renderHint();
				}
			} else return;
			e.preventDefault();
		} else if (e.key === "Escape" && this.armed) {
			this.disarm();
		} else if (e.key === "Escape" && this.selected != null) {
			this.selectBorder(null);
		}
	}

	/** Dragging a note from the file list drops a pin for it. */
	private bindDrop(stage: HTMLElement): void {
		const dragged = (): TFile | null => {
			const d = (this.app as unknown as { dragManager?: { draggable?: { type?: string; file?: TFile } } }).dragManager?.draggable;
			return d?.type === "file" && d.file instanceof TFile && d.file.extension === "md" ? d.file : null;
		};
		stage.addEventListener("dragover", (e) => {
			if (!dragged() || !this.width) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "link";
		});
		stage.addEventListener("drop", (e) => {
			const file = dragged();
			if (!file || !this.file || !this.width) return;
			e.preventDefault();
			const [x, y] = this.toImage(e);
			const note = `[[${this.app.metadataCache.fileToLinktext(file, this.file.path, true)}]]`;
			this.savePin({ index: -1, note, label: "", color: "", from: null, to: null, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
		});
	}

	// ---------- borders being drawn ----------

	private selectBorder(index: number | null): void {
		this.selected = index;
		this.armed = null;
		this.drawHandles();
		this.renderHint();
		this.renderPanelList();
	}

	/** A freehand outline ended. A press that never moved isn't an outline, only a click on empty map. */
	private finishLasso(moved: boolean): void {
		const points = this.draft ?? [];
		if (!moved) {
			this.draft = null;
			this.drawHandles();
			if (this.selected != null) this.selectBorder(null);
			else this.renderHint();
			return;
		}
		const scale = this.cam.k;
		const px = points.map(([x, y]) => [x * this.width * scale, y * this.height * scale] as [number, number]);
		const kept = simplifyPath(px, 4);
		// A trace usually ends where it began; the shape closes itself, so that's not another corner.
		const [fx, fy] = kept[0];
		const [lx, ly] = kept[kept.length - 1];
		if (kept.length > 3 && Math.hypot(fx - lx, fy - ly) < 12) kept.pop();
		const simple = kept.map(([x, y]) => [x / this.width / scale, y / this.height / scale] as [number, number]);
		if (simple.length < 3) {
			new Notice("Drag all the way around the area to outline it.");
			this.cancelDraft();
			return;
		}
		this.draft = simple;
		this.finishDraft();
	}

	private startDraft(x: number, y: number): void {
		this.draft = [[x, y]];
		this.cursor = null;
		this.drawHandles();
		this.renderHint();
	}

	private addCorner(x: number, y: number): void {
		const draft = this.draft!;
		const near = (p: [number, number], px: number) => Math.hypot((p[0] - x) * this.width, (p[1] - y) * this.height) * this.cam.k < px;
		// Clicking the first corner closes the shape, and so does the second click of a double-click.
		if (draft.length >= 3 && (near(draft[0], 12) || near(draft[draft.length - 1], 8))) {
			this.finishDraft();
			return;
		}
		if (near(draft[draft.length - 1], 4)) return;
		draft.push([x, y]);
		this.cursor = null;
		this.drawHandles();
		this.renderHint();
	}

	private cancelDraft(): void {
		this.draft = null;
		this.cursor = null;
		this.drawHandles();
		this.renderHint();
		this.render();
	}

	/** Saved right away, so what was drawn survives closing the details form. */
	private async finishDraft(): Promise<void> {
		const points = this.draft;
		if (!points || points.length < 3) return;
		this.draft = null;
		this.cursor = null;
		const color = THEME_COLORS[this.model.borders.length % THEME_COLORS.length];
		const armed = this.armed;
		const note = armed ? await this.armedNote(armed, "faction") : "";
		if (note == null) return;
		const border: MapBorder = { index: -1, note, label: "", color, from: this.startsHere ? this.dateShown() : null, to: null, points };
		await this.saveBorder(border);
		this.drawHandles();
		this.renderHint();
		if (!armed) {
			// Drawn without choosing from the list, so it still needs a name.
			this.selected = border.index;
			this.editBorder(border);
			return;
		}
		this.lastAdded = { kind: "border", item: border, hidden: !isVisibleAt(place(this.app, border, this.file?.path ?? ""), this.dateShown()) };
		this.armed = null;
		this.query = "";
		this.renderHint();
		this.renderPanel();
	}

	// ---------- saving ----------

	private savePin(pin: MapPin): Promise<void> {
		return this.update((fm) => writePin(fm, pin));
	}

	private saveBorder(border: MapBorder): Promise<void> {
		return this.update((fm) => writeBorder(fm, border));
	}

	private removePin(pin: MapPin): Promise<void> {
		this.clearAdded();
		return this.update((fm) => removeItem(fm, "pins", pin.index));
	}

	/** Removing anything shifts list positions, so the strip's item can't be trusted after. */
	private clearAdded(): void {
		this.lastAdded = null;
		this.renderPanel();
	}

	private removeBorder(border: MapBorder): Promise<void> {
		this.selected = null;
		this.clearAdded();
		return this.update((fm) => removeItem(fm, "borders", border.index));
	}

	private openItemModal(kind: "pin" | "border", item: MapItem, isNew: boolean, save: (v: MapItemFields) => void, remove: () => void): void {
		new MapItemModal(this.app, this.plugin, {
			kind,
			isNew,
			sourcePath: this.file?.path ?? "",
			value: { note: item.note, label: item.label, color: item.color, from: item.from, to: item.to },
			defaultDate: this.date,
			onSave: save,
			onRemove: remove,
		}).open();
	}

	private newPin(x: number, y: number): void {
		const pin: MapPin = { index: -1, note: "", label: "", color: "", from: null, to: null, x, y };
		this.openItemModal("pin", pin, true, (v) => this.savePin({ ...pin, ...v }), () => undefined);
	}

	private editPin(pin: MapPin): void {
		const { index, x, y } = pin;
		this.openItemModal("pin", pin, false, (v) => this.savePin({ ...v, index, x, y }), () => this.removePin(pin));
	}

	private editBorder(border: MapBorder): void {
		const { index, points } = border;
		this.openItemModal("border", border, false, (v) => this.saveBorder({ ...v, index, points }), () => this.removeBorder(border));
	}

	// ---------- opening notes ----------

	/** Opens the linked note's sheet beside the map. A pin typed before its note exists creates a city. */
	private async openItem(item: MapItem, newLeaf: PaneType | boolean): Promise<void> {
		const source = this.file?.path ?? "";
		const s = this.plugin.settings;
		const file = resolveFirstLink(this.app, item.note, source) ?? (await this.createNote(item.note, "city", s.citiesFolder));
		if (!file) return;
		await this.plugin.openNoteIn(newLeaf ? this.app.workspace.getLeaf(newLeaf) : this.besideMap(), file);
	}

	private besideMap(): WorkspaceLeaf {
		let alive = false;
		this.app.workspace.iterateAllLeaves((l) => {
			if (l === this.sheetLeaf) alive = true;
		});
		if (!alive || !this.sheetLeaf) this.sheetLeaf = this.app.workspace.getLeaf("split", "vertical");
		return this.sheetLeaf;
	}

	private async createNote(link: string, type: string, folder: string): Promise<TFile | null> {
		const name = linkBasename(link);
		const base = safeFileName(name);
		if (!base) return null;
		try {
			await ensureFolder(this.app, folder);
			return await this.app.vault.create(normalizePath(joinPath(folder, `${base}.md`)), `---\n${stringifyYaml({ type, name })}---\n\n`);
		} catch (err) {
			new Notice(`Couldn't create ${base}: ${(err as Error).message}`);
			return null;
		}
	}
}
