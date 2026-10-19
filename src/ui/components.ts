import { AbstractInputSuggest, App, FuzzySuggestModal, Keymap, Modal, TFile, setIcon } from "obsidian";
import { parseLink, STAT_KEYS } from "../model";

const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl<K extends keyof SVGElementTagNameMap>(
	parent: Element,
	tag: K,
	attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
	parent.appendChild(el);
	return el;
}

/** Hexagonal radar: viewBox 300×260, centre (150,130), radius 95, axes clockwise from the top. */
export function renderRadar(parent: HTMLElement, values: number[], max: number, cls = "ct-radar"): SVGSVGElement {
	const cx = 150, cy = 130, R = 95, n = values.length;
	const pt = (i: number, r: number) => {
		const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
		return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
	};
	const pts = (r: (i: number) => number) => values.map((_, i) => pt(i, r(i)).map((v) => v.toFixed(1)).join(",")).join(" ");
	const svg = svgEl(parent, "svg", { viewBox: "0 0 300 260", class: cls });
	for (const f of [0.25, 0.5, 0.75, 1]) svgEl(svg, "polygon", { points: pts(() => R * f), class: "ct-radar-grid" });
	values.forEach((_, i) => {
		const [x, y] = pt(i, R);
		svgEl(svg, "line", { x1: cx, y1: cy, x2: x, y2: y, class: "ct-radar-grid" });
	});
	svgEl(svg, "polygon", { points: pts((i) => R * Math.max(0.05, Math.min(1, values[i] / max))), class: "ct-radar-data" });
	values.forEach((v, i) => {
		const [x, y] = pt(i, R + 20);
		const t = svgEl(svg, "text", { x, y, class: "ct-radar-label" });
		t.textContent = `${STAT_KEYS[i].toUpperCase()} ${v}`;
	});
	return svg;
}

export function sectionLabel(parent: HTMLElement, text: string): HTMLElement {
	return parent.createDiv({ cls: "ct-label", text });
}

export function pill(parent: HTMLElement, text: string, color: string, cls = "ct-pill"): HTMLElement {
	const el = parent.createSpan({ cls, text });
	el.style.setProperty("--ct-c", `var(--color-${color})`);
	return el;
}

/** Renders a frontmatter value that may be a [[wikilink]] as a live internal link. */
export function renderLinkish(app: App, parent: HTMLElement, raw: string, sourcePath: string, cls = ""): HTMLElement {
	const { target, display } = parseLink(raw);
	if (!target) return parent.createSpan({ text: display, cls });
	const a = parent.createEl("a", { text: display, cls: `internal-link ${cls}`.trim(), attr: { "data-href": target, href: target } });
	const dest = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
	if (!dest) a.addClass("is-unresolved");
	a.addEventListener("click", (e) => {
		e.preventDefault();
		app.workspace.openLinkText(target, sourcePath, Keymap.isModEvent(e));
	});
	a.addEventListener("mouseover", (e) => {
		app.workspace.trigger("hover-link", { event: e, source: "story-characters-timeline", hoverParent: parent, targetEl: a, linktext: target, sourcePath });
	});
	return a;
}

export function button(parent: HTMLElement, text: string, onClick: (e: MouseEvent) => void, cls = "ct-btn"): HTMLButtonElement {
	const b = parent.createEl("button", { text, cls });
	b.addEventListener("click", onClick);
	return b;
}

/** Suggests vault notes in a text input; the chosen note is written back as a [[wikilink]]. */
export class NoteSuggest extends AbstractInputSuggest<TFile> {
	constructor(app: App, private input: HTMLInputElement, private onPick?: (link: string) => void, private filter?: (f: TFile) => boolean) {
		super(app, input);
	}
	getSuggestions(query: string): TFile[] {
		const q = query.replace(/^\[\[|\]\]$/g, "").toLowerCase();
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => (!this.filter || this.filter(f)) && f.basename.toLowerCase().includes(q))
			.slice(0, 30);
	}
	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.basename);
		el.createDiv({ text: file.parent?.path ?? "", cls: "ct-suggest-path" });
	}
	selectSuggestion(file: TFile): void {
		const link = `[[${file.basename}]]`;
		this.input.value = link;
		this.input.dispatchEvent(new Event("input"));
		this.onPick?.(link);
		this.close();
	}
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

export class ImagePickerModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder("Pick a portrait image from the vault");
	}
	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => IMAGE_EXT.includes(f.extension.toLowerCase()));
	}
	getItemText(f: TFile): string {
		return f.path;
	}
	onChooseItem(f: TFile): void {
		this.onPick(f);
	}
}

export function resolveImage(app: App, raw: string, sourcePath: string): string | null {
	if (!raw) return null;
	const { target, display } = parseLink(raw);
	const f = app.metadataCache.getFirstLinkpathDest(target ?? display, sourcePath);
	return f ? app.vault.getResourcePath(f) : null;
}

/** Renders text that may contain [[wikilinks]] anywhere in it. */
export function renderInline(app: App, parent: HTMLElement, text: string, sourcePath: string): void {
	const re = /!?\[\[[^\]]+\]\]/g;
	let last = 0;
	for (const m of text.matchAll(re)) {
		if (m.index! > last) parent.appendText(text.slice(last, m.index));
		renderLinkish(app, parent, m[0], sourcePath);
		last = m.index! + m[0].length;
	}
	if (last < text.length) parent.appendText(text.slice(last));
}

/** Full-size image viewer with previous/next and arrow-key navigation. */
export class ImageLightbox extends Modal {
	constructor(app: App, private srcs: { src: string; name: string }[], private index: number) {
		super(app);
	}
	onOpen(): void {
		this.modalEl.addClass("ct-lightbox-modal");
		this.scope.register([], "ArrowLeft", () => this.go(-1));
		this.scope.register([], "ArrowRight", () => this.go(1));
		this.draw();
	}
	private go(d: number): boolean {
		this.index = (this.index + d + this.srcs.length) % this.srcs.length;
		this.draw();
		return false;
	}
	private draw(): void {
		const el = this.contentEl;
		el.empty();
		const cur = this.srcs[this.index];
		const stage = el.createDiv({ cls: "ct-lightbox" });
		stage.createEl("img", { attr: { src: cur.src, alt: cur.name } });
		if (this.srcs.length > 1) {
			const prev = stage.createEl("button", { cls: "ct-lightbox-nav is-prev", attr: { "aria-label": "Previous image" } });
			setIcon(prev, "chevron-left");
			prev.addEventListener("click", () => this.go(-1));
			const next = stage.createEl("button", { cls: "ct-lightbox-nav is-next", attr: { "aria-label": "Next image" } });
			setIcon(next, "chevron-right");
			next.addEventListener("click", () => this.go(1));
		}
		const cap = el.createDiv({ cls: "ct-lightbox-caption" });
		cap.createSpan({ text: cur.name });
		cap.createSpan({ cls: "ct-mono ct-faint", text: `${this.index + 1} / ${this.srcs.length}` });
	}
	onClose(): void {
		this.contentEl.empty();
	}
}
