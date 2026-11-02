import { debounce, ItemView, Keymap, PaneType, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import type StoryPlugin from "../main";
import { initials } from "../model";
import { collectRelGraph, layoutFamilyTree, OTHER_CATEGORY, REL_CATEGORIES, RelEdge, RelGraph, RelNode } from "../relations";
import { button, svgEl } from "../ui/components";

export const VIEW_RELATIONS = "story-relations";

type Mode = "web" | "tree";

interface RelationsState {
	mode?: Mode;
	hidden?: string[];
	focus?: string;
}

interface SimNode extends RelNode {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	fixed: boolean;
	el?: SVGGElement;
}

interface DrawnEdge {
	edge: RelEdge;
	/** Sideways bend, so two people's relationships to each other don't overlap. */
	bend: number;
	path?: SVGPathElement;
	hit?: SVGPathElement;
	label?: SVGTextElement;
}

const ALL_CATEGORIES = [...REL_CATEGORIES, OTHER_CATEGORY];
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
let instances = 0;

/** Characters and their relationships as a force graph, or a family tree from parent/child/spouse/sibling kinds. */
export class RelationshipGraphView extends ItemView {
	private mode: Mode = "web";
	private hidden = new Set<string>();
	private pendingFocus: string | null = null;

	private graph: RelGraph = { nodes: [], edges: [] };
	private signature = "";
	private nodes = new Map<string, SimNode>();
	private drawn: DrawnEdge[] = [];
	/** Family tree positions; kept apart from the simulation so the web keeps its layout. */
	private treePos: Map<string, { x: number; y: number }> | null = null;

	private stage: HTMLElement | null = null;
	private svg: SVGSVGElement | null = null;
	private viewport: SVGGElement | null = null;
	private cam = { x: 0, y: 0, k: 1 };
	/** Refit on resize until the user pans or zooms. */
	private autoFit = true;

	private alpha = 0;
	private frame = 0;
	private dragging: SimNode | null = null;
	private readonly uid = `ct-rg-${++instances}`;

	constructor(leaf: WorkspaceLeaf, private plugin: StoryPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_RELATIONS;
	}
	getDisplayText(): string {
		return "Relationships";
	}
	getIcon(): string {
		return "waypoints";
	}

	getState(): Record<string, unknown> {
		return { mode: this.mode, hidden: [...this.hidden] };
	}

	async setState(state: RelationsState, result: ViewStateResult): Promise<void> {
		if (state.mode === "web" || state.mode === "tree") this.mode = state.mode;
		if (Array.isArray(state.hidden)) this.hidden = new Set(state.hidden);
		if (state.focus) this.pendingFocus = state.focus;
		if (this.stage) this.render();
		return super.setState(state, result);
	}

	/** Highlights and centres a character. */
	focusNode(path: string): void {
		this.pendingFocus = path;
		this.render();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("ct-view", "ct-relations");
		const refresh = debounce(() => this.reload(), 400, true);
		this.registerEvent(this.app.metadataCache.on("changed", refresh));
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
		this.reload(true);
	}

	async onClose(): Promise<void> {
		cancelAnimationFrame(this.frame);
	}

	onResize(): void {
		if (this.autoFit) this.fit();
	}

	/** Re-reads every character's relationships; redraws only when something changed. */
	reload(force = false): void {
		const graph = collectRelGraph(this.app);
		const sig = JSON.stringify([graph.nodes.map((n) => [n.id, n.name, n.status]), graph.edges.map((e) => [e.from, e.to, e.kind, e.score])]);
		if (!force && sig === this.signature) return;
		const structural = !force && JSON.stringify([graph.nodes.map((n) => n.id), graph.edges.map((e) => [e.from, e.to])]) !== this.structure();
		this.signature = sig;
		this.graph = graph;

		// Keep existing positions; new people start next to someone they know.
		const old = this.nodes;
		this.nodes = new Map();
		graph.nodes.forEach((n, i) => {
			const prev = old.get(n.id);
			const deg = graph.edges.filter((e) => e.from === n.id || e.to === n.id).length;
			const r = n.character ? 16 + Math.min(deg, 8) * 1.5 : 12;
			if (prev) {
				this.nodes.set(n.id, { ...n, x: prev.x, y: prev.y, vx: 0, vy: 0, r, fixed: false });
				return;
			}
			const friend = graph.edges.map((e) => (e.from === n.id ? e.to : e.to === n.id ? e.from : null)).find((id) => id && old.has(id));
			const anchor = friend ? old.get(friend)! : null;
			const a = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
			const d = anchor ? 60 : 80 + graph.nodes.length * 12;
			this.nodes.set(n.id, { ...n, x: (anchor?.x ?? 0) + Math.cos(a) * d, y: (anchor?.y ?? 0) + Math.sin(a) * d, vx: 0, vy: 0, r, fixed: false });
		});
		if (!old.size) {
			this.alpha = 1;
			for (let i = 0; i < 300; i++) this.tick();
			this.alpha = 0;
		} else if (structural) this.alpha = Math.max(this.alpha, 0.5);
		this.render();
	}

	private structure(): string {
		return JSON.stringify([[...this.nodes.keys()], this.graph.edges.map((e) => [e.from, e.to])]);
	}

	// ---------- drawing ----------

	render(): void {
		cancelAnimationFrame(this.frame);
		const root = this.contentEl;
		root.empty();
		this.renderToolbar(root);
		this.stage = root.createDiv({ cls: "ct-rg-stage" });

		const characters = this.graph.nodes.filter((n) => n.character);
		if (!characters.length) {
			this.svg = this.viewport = null;
			this.empty(this.stage, "No characters yet", "Characters with relationships in their frontmatter appear here, linked by kind and score.");
			button(this.stage.querySelector(".ct-empty")!, "Create first character", () => this.plugin.openWizard(), "ct-btn mod-cta");
			return;
		}

		this.svg = svgEl(this.stage, "svg", { class: "ct-rg-svg" });
		this.defineArrows(this.svg);
		this.viewport = svgEl(this.svg, "g");
		this.bindPointer(this.svg);
		for (const n of this.nodes.values()) n.el = undefined;
		this.treePos = null;

		let focusable = true;
		if (this.mode === "tree") focusable = this.drawTree(this.viewport);
		else this.drawWeb(this.viewport);
		this.applyCamera();

		const focus = this.pendingFocus;
		this.pendingFocus = null;
		if (focus && focusable && this.nodes.get(focus)?.el) window.requestAnimationFrame(() => this.centreOn(focus));
		else window.requestAnimationFrame(() => this.fit());
		if (this.mode === "web" && this.alpha > 0.005) this.loop();
	}

	private empty(parent: HTMLElement, title: string, text: string): void {
		const box = parent.createDiv({ cls: "ct-empty" });
		setIcon(box.createDiv({ cls: "ct-empty-icon" }), "waypoints");
		box.createDiv({ cls: "ct-empty-title", text: title });
		box.createDiv({ cls: "ct-empty-text", text });
	}

	private renderToolbar(root: HTMLElement): void {
		const bar = root.createDiv({ cls: "ct-tl-toolbar" });
		bar.createSpan({ cls: "ct-tl-name", text: "Relationships" });
		const people = this.graph.nodes.filter((n) => n.character).length;
		bar.createSpan({ cls: "ct-mono ct-faint ct-12", text: `${people} character${people === 1 ? "" : "s"} · ${this.graph.edges.length} relationship${this.graph.edges.length === 1 ? "" : "s"}` });

		const seg = bar.createDiv({ cls: "ct-seg" });
		for (const [m, label] of [["web", "Web"], ["tree", "Family tree"]] as [Mode, string][]) {
			const item = seg.createDiv({ cls: `ct-seg-item ${this.mode === m ? "is-active" : ""}`, text: label });
			item.addEventListener("click", () => {
				if (this.mode === m) return;
				this.mode = m;
				this.autoFit = true;
				this.app.workspace.requestSaveLayout();
				this.render();
			});
		}

		bar.createDiv({ cls: "ct-spacer" });
		const legend = bar.createDiv({ cls: "ct-legend" });
		if (this.mode === "web") {
			for (const cat of ALL_CATEGORIES) {
				const n = this.graph.edges.filter((e) => e.category.key === cat.key).length;
				if (!n) continue;
				const off = this.hidden.has(cat.key);
				const item = legend.createSpan({ cls: `ct-legend-item ct-rg-toggle ${off ? "is-off" : ""}`, attr: { role: "button", tabindex: "0", "aria-pressed": String(!off), "aria-label": `${off ? "Show" : "Hide"} ${cat.label.toLowerCase()} relationships` } });
				item.createSpan({ cls: "ct-rg-swatch" }).style.setProperty("--ct-c", `var(--color-${cat.color})`);
				item.appendText(`${cat.label} ${n}`);
				const toggle = () => {
					if (off) this.hidden.delete(cat.key);
					else this.hidden.add(cat.key);
					this.app.workspace.requestSaveLayout();
					this.render();
				};
				item.addEventListener("click", toggle);
				item.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						toggle();
					}
				});
			}
			const neg = legend.createSpan({ cls: "ct-legend-item" });
			neg.createSpan({ cls: "ct-rg-swatch is-dashed" });
			neg.appendText("Negative");
		} else {
			const pc = legend.createSpan({ cls: "ct-legend-item" });
			pc.createSpan({ cls: "ct-rg-swatch" }).style.setProperty("--ct-c", "var(--text-muted)");
			pc.appendText("Parent – child");
			const sp = legend.createSpan({ cls: "ct-legend-item" });
			sp.createSpan({ cls: "ct-rg-swatch is-double" }).style.setProperty("--ct-c", "var(--color-pink)");
			sp.appendText("Spouses");
		}

		const fit = bar.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": "Fit to view" } });
		setIcon(fit, "scan");
		fit.addEventListener("click", () => {
			this.autoFit = true;
			this.fit();
		});
		if (this.mode === "web") {
			const shuffle = bar.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": "Re-run layout" } });
			setIcon(shuffle, "refresh-cw");
			shuffle.addEventListener("click", () => {
				let i = 0;
				for (const n of this.nodes.values()) {
					const a = (i++ / this.nodes.size) * Math.PI * 2;
					n.x = Math.cos(a) * 200 + Math.random() * 20;
					n.y = Math.sin(a) * 200 + Math.random() * 20;
				}
				this.alpha = 1;
				this.autoFit = true;
				this.loop();
			});
		}
	}

	private defineArrows(svg: SVGSVGElement): void {
		const defs = svgEl(svg, "defs");
		for (const cat of ALL_CATEGORIES) {
			const m = svgEl(defs, "marker", { id: `${this.uid}-${cat.key}`, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 8, markerHeight: 8, markerUnits: "userSpaceOnUse", orient: "auto" });
			const p = svgEl(m, "path", { d: "M0,1 L9,5 L0,9 z" });
			p.style.fill = `var(--color-${cat.color})`;
		}
	}

	private drawWeb(vp: SVGGElement): void {
		const edgeLayer = svgEl(vp, "g");
		const labelLayer = svgEl(vp, "g", { class: "ct-rg-labels" });
		const nodeLayer = svgEl(vp, "g");

		const visible = this.graph.edges.filter((e) => !this.hidden.has(e.category.key));
		const pairs = new Map<string, RelEdge[]>();
		for (const e of visible) {
			const k = pairKey(e.from, e.to);
			if (!pairs.has(k)) pairs.set(k, []);
			pairs.get(k)!.push(e);
		}
		this.drawn = [];
		for (const list of pairs.values()) {
			list.forEach((edge, i) => {
				// Bend relative to the pair's canonical direction, so A→B and B→A go to opposite sides.
				const flip = edge.from < edge.to ? 1 : -1;
				const bend = (i - (list.length - 1) / 2) * 36 * flip;
				const d: DrawnEdge = { edge, bend };
				const g = svgEl(edgeLayer, "g", { class: "ct-rg-edge" });
				g.style.setProperty("--ct-c", `var(--color-${edge.category.color})`);
				d.hit = svgEl(g, "path", { class: "ct-rg-hit" });
				d.path = svgEl(g, "path", { class: `ct-rg-line ${edge.score < 0 ? "is-neg" : ""}`, "marker-end": `url(#${this.uid}-${edge.category.key})` });
				const abs = Math.abs(edge.score);
				d.path.style.strokeWidth = String(1.2 + abs * 0.45);
				d.path.style.opacity = String(0.45 + abs * 0.055);
				const from = this.nodes.get(edge.from)!.name;
				const to = this.nodes.get(edge.to)!.name;
				svgEl(g, "title").textContent = `${from} → ${to}\n${edge.kind || "(no kind)"} · ${signed(edge.score)}`;
				d.label = svgEl(labelLayer, "text", { class: "ct-rg-edge-label" });
				d.label.textContent = `${truncate(edge.kind || edge.category.label, 22)} ${signed(edge.score)}`;
				d.label.dataset.from = edge.from;
				d.label.dataset.to = edge.to;
				g.dataset.from = edge.from;
				g.dataset.to = edge.to;
				this.drawn.push(d);
			});
		}

		for (const n of this.nodes.values()) this.drawNode(nodeLayer, n);
		this.updatePositions();
	}

	private drawNode(layer: SVGGElement, n: SimNode, r = n.r): void {
		const g = svgEl(layer, "g", { class: `ct-rg-node ${n.character ? "" : "is-other"} ${n.file ? "" : "is-unresolved"} ${/\b(dead|deceased|died|late|lost)\b/i.test(n.status) ? "is-dead" : ""}`, tabindex: 0, role: "link", "aria-label": n.name });
		g.dataset.id = n.id;
		svgEl(g, "circle", { r });
		const ini = svgEl(g, "text", { class: "ct-rg-initials" });
		ini.textContent = initials(n.name);
		ini.style.fontSize = `${Math.max(9, r * 0.6)}px`;
		const label = svgEl(g, "text", { class: "ct-rg-name", y: r + 14 });
		label.textContent = truncate(n.name, 22);
		svgEl(g, "title").textContent = n.file ? `${n.name}${n.status ? ` · ${n.status}` : ""}` : `${n.name} (no note yet)`;
		g.addEventListener("pointerenter", (e) => {
			this.highlight(n.id);
			if (n.file) this.app.workspace.trigger("hover-link", { event: e, source: "worldbuilding", hoverParent: this.contentEl, targetEl: g, linktext: n.file.path, sourcePath: "" });
		});
		g.addEventListener("pointerleave", () => this.highlight(null));
		g.addEventListener("focus", () => this.highlight(n.id));
		g.addEventListener("blur", () => this.highlight(null));
		g.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.openNode(n, Keymap.isModEvent(e));
		});
		n.el = g;
	}

	/** Returns false when the focused character has no family links, so the caller fits instead. */
	private drawTree(vp: SVGGElement): boolean {
		const tree = layoutFamilyTree(this.graph.edges);
		if (!tree.members.size) {
			this.svg?.remove();
			this.svg = this.viewport = null;
			this.empty(this.stage!, "No family links yet", "Give relationships a kind like Father, Mother, Son, Daughter, Sister or Wife and they'll be drawn here as a tree.");
			return false;
		}
		const linesLayer = svgEl(vp, "g", { class: "ct-rg-tree-lines" });
		const nodeLayer = svgEl(vp, "g");
		const R = 22;
		const at = (id: string) => tree.pos.get(id)!;

		for (const [a, b] of tree.spouses) {
			const pa = at(a), pb = at(b);
			const [l, r] = pa.x < pb.x ? [pa, pb] : [pb, pa];
			for (const dy of [-2.5, 2.5]) svgEl(linesLayer, "line", { x1: l.x + R, y1: l.y + dy, x2: r.x - R, y2: r.y + dy, class: "ct-rg-spouse" });
		}
		for (const fam of tree.families) {
			const ps = fam.parents.map(at);
			const ox = ps.reduce((s, p) => s + p.x, 0) / ps.length;
			const oy = ps[0].y + (ps.length > 1 ? 0 : R + 22);
			const cs = fam.children.map(at);
			const cy = Math.min(...cs.map((c) => c.y));
			const busY = oy + (cy - R - oy) / 2 + (ps.length > 1 ? R / 2 : 0);
			const xs = [ox, ...cs.map((c) => c.x)];
			let d = `M${ox},${oy} V${busY} M${Math.min(...xs)},${busY} H${Math.max(...xs)}`;
			for (const c of cs) d += ` M${c.x},${busY} V${c.y - R - 2}`;
			svgEl(linesLayer, "path", { d, class: "ct-rg-tree-line" });
		}

		this.drawn = [];
		this.treePos = tree.pos;
		for (const id of tree.members) {
			const n = this.nodes.get(id);
			if (!n) continue;
			const p = at(id);
			this.drawNode(nodeLayer, n, R);
			n.el!.setAttr("transform", `translate(${p.x},${p.y})`);
		}
		const hiddenCount = this.graph.nodes.filter((n) => n.character && !tree.members.has(n.id)).length;
		if (hiddenCount) this.stage!.createDiv({ cls: "ct-rg-note ct-12 ct-faint", text: `${hiddenCount} character${hiddenCount === 1 ? "" : "s"} without family links not shown` });
		return true;
	}

	private highlight(id: string | null): void {
		if (!this.svg || this.dragging) return;
		this.svg.toggleClass("is-hovering", !!id);
		if (!id) {
			this.svg.querySelectorAll(".is-lit").forEach((el) => el.removeClass("is-lit"));
			return;
		}
		const near = new Set([id]);
		for (const d of this.drawn) {
			const on = d.edge.from === id || d.edge.to === id;
			d.path?.parentElement?.toggleClass("is-lit", on);
			d.label?.toggleClass("is-lit", on);
			if (on) near.add(d.edge.from).add(d.edge.to);
		}
		for (const n of this.nodes.values()) n.el?.toggleClass("is-lit", near.has(n.id));
	}

	private openNode(n: SimNode, newLeaf: PaneType | boolean): void {
		if (n.file) this.app.workspace.getLeaf(newLeaf).openFile(n.file);
		else this.app.workspace.openLinkText(n.name, n.source ?? "", newLeaf);
	}

	// ---------- simulation ----------

	private tick(): void {
		const ns = [...this.nodes.values()];
		const a = this.alpha;
		for (let i = 0; i < ns.length; i++) {
			const p = ns[i];
			for (let j = i + 1; j < ns.length; j++) {
				const q = ns[j];
				let dx = q.x - p.x, dy = q.y - p.y;
				if (!dx && !dy) dx = Math.random() - 0.5;
				const d2 = Math.max(dx * dx + dy * dy, 64);
				const f = (60000 * a) / d2;
				const d = Math.sqrt(d2);
				p.vx -= (dx / d) * f; p.vy -= (dy / d) * f;
				q.vx += (dx / d) * f; q.vy += (dy / d) * f;
			}
		}
		// One spring per pair of people; stronger feelings, either way, pull them closer.
		const springs = new Map<string, [SimNode, SimNode, number]>();
		for (const e of this.graph.edges) {
			if (this.hidden.has(e.category.key)) continue;
			const k = pairKey(e.from, e.to);
			const s = springs.get(k);
			if (s) s[2] = Math.max(s[2], Math.abs(e.score));
			else springs.set(k, [this.nodes.get(e.from)!, this.nodes.get(e.to)!, Math.abs(e.score)]);
		}
		for (const [p, q, s] of springs.values()) {
			const dx = q.x - p.x, dy = q.y - p.y;
			const d = Math.sqrt(dx * dx + dy * dy) || 1;
			const f = ((d - (200 - s * 7)) / d) * 0.03 * a;
			p.vx += dx * f; p.vy += dy * f;
			q.vx -= dx * f; q.vy -= dy * f;
		}
		for (const n of ns) {
			n.vx -= n.x * 0.015 * a;
			n.vy -= n.y * 0.015 * a;
			n.vx *= 0.6;
			n.vy *= 0.6;
			if (n.fixed) n.vx = n.vy = 0;
			else {
				n.x += n.vx;
				n.y += n.vy;
			}
		}
		// Keep circles and their name labels apart.
		for (let i = 0; i < ns.length; i++) {
			for (let j = i + 1; j < ns.length; j++) {
				const p = ns[i], q = ns[j];
				const dx = q.x - p.x, dy = q.y - p.y;
				const d = Math.sqrt(dx * dx + dy * dy) || 1;
				const min = p.r + q.r + 40;
				if (d >= min) continue;
				const push = (min - d) / d / (p.fixed || q.fixed ? 1 : 2);
				if (!p.fixed) { p.x -= dx * push; p.y -= dy * push; }
				if (!q.fixed) { q.x += dx * push; q.y += dy * push; }
			}
		}
		if (!this.dragging) this.alpha *= 0.975;
	}

	private loop(): void {
		cancelAnimationFrame(this.frame);
		const step = () => {
			this.tick();
			this.updatePositions();
			if (this.autoFit && !this.dragging) this.fit();
			if (this.alpha > 0.005 || this.dragging) this.frame = requestAnimationFrame(step);
		};
		this.frame = requestAnimationFrame(step);
	}

	private updatePositions(): void {
		for (const n of this.nodes.values()) n.el?.setAttr("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
		for (const d of this.drawn) {
			const p = this.nodes.get(d.edge.from)!, q = this.nodes.get(d.edge.to)!;
			const dx = q.x - p.x, dy = q.y - p.y;
			const len = Math.sqrt(dx * dx + dy * dy) || 1;
			const cx = (p.x + q.x) / 2 - (dy / len) * d.bend * 2;
			const cy = (p.y + q.y) / 2 + (dx / len) * d.bend * 2;
			// Trim both ends to the circles so the arrowhead shows.
			const trim = (from: { x: number; y: number }, to: SimNode, r: number) => {
				const ex = to.x - from.x, ey = to.y - from.y;
				const el = Math.sqrt(ex * ex + ey * ey) || 1;
				return { x: to.x - (ex / el) * r, y: to.y - (ey / el) * r };
			};
			const s = trim({ x: cx, y: cy }, p, p.r + 2);
			const t = trim({ x: cx, y: cy }, q, q.r + 4);
			const path = `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${t.x.toFixed(1)},${t.y.toFixed(1)}`;
			d.path?.setAttr("d", path);
			d.hit?.setAttr("d", path);
			d.label?.setAttr("x", (0.25 * s.x + 0.5 * cx + 0.25 * t.x).toFixed(1));
			d.label?.setAttr("y", (0.25 * s.y + 0.5 * cy + 0.25 * t.y).toFixed(1));
		}
	}

	// ---------- camera & pointer ----------

	private applyCamera(): void {
		this.viewport?.setAttr("transform", `translate(${this.cam.x.toFixed(1)},${this.cam.y.toFixed(1)}) scale(${this.cam.k.toFixed(4)})`);
	}

	/** Where a node is drawn in the current mode. */
	private at(n: SimNode): { x: number; y: number; r: number } {
		const p = this.treePos?.get(n.id);
		return p ? { ...p, r: 22 } : n;
	}

	private visibleNodes(): { x: number; y: number; r: number }[] {
		return [...this.nodes.values()].filter((n) => n.el).map((n) => this.at(n));
	}

	private fit(): void {
		if (!this.svg || !this.stage) return;
		const ns = this.visibleNodes();
		const w = this.stage.clientWidth, h = this.stage.clientHeight;
		if (!ns.length || !w || !h) return;
		const pad = 60;
		const minX = Math.min(...ns.map((n) => n.x - n.r)) - pad, maxX = Math.max(...ns.map((n) => n.x + n.r)) + pad;
		const minY = Math.min(...ns.map((n) => n.y - n.r)) - pad, maxY = Math.max(...ns.map((n) => n.y + n.r + 18)) + pad;
		const k = Math.min(w / (maxX - minX), h / (maxY - minY), 1.4);
		this.cam = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k };
		this.applyCamera();
	}

	private centreOn(id: string): void {
		const n = this.nodes.get(id);
		if (!n?.el || !this.stage) return;
		this.fit();
		this.autoFit = false;
		const k = Math.max(this.cam.k, 1);
		const p = this.at(n);
		this.cam = { k, x: this.stage.clientWidth / 2 - p.x * k, y: this.stage.clientHeight / 2 - p.y * k };
		this.applyCamera();
		n.el.addClass("is-focused");
		window.setTimeout(() => n.el?.removeClass("is-focused"), 1800);
	}

	private bindPointer(svg: SVGSVGElement): void {
		let start: { x: number; y: number; cx: number; cy: number } | null = null;
		let pressed: SimNode | null = null;
		let moved = false;
		const toWorld = (e: PointerEvent) => {
			const r = svg.getBoundingClientRect();
			return { x: (e.clientX - r.left - this.cam.x) / this.cam.k, y: (e.clientY - r.top - this.cam.y) / this.cam.k };
		};

		svg.addEventListener("pointerdown", (e) => {
			if (e.button !== 0) return;
			const el = (e.target as Element).closest(".ct-rg-node") as SVGGElement | null;
			pressed = el ? this.nodes.get(el.dataset.id ?? "") ?? null : null;
			start = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
			moved = false;
			svg.setPointerCapture(e.pointerId);
		});
		svg.addEventListener("pointermove", (e) => {
			if (!start) return;
			if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
			moved = true;
			if (pressed && this.mode === "web") {
				if (!this.dragging) {
					this.dragging = pressed;
					pressed.fixed = true;
					svg.addClass("is-dragging");
					this.autoFit = false;
					this.alpha = Math.max(this.alpha, 0.3);
					this.loop();
				}
				const w = toWorld(e);
				pressed.x = w.x;
				pressed.y = w.y;
			} else {
				this.autoFit = false;
				this.cam.x = start.cx + e.clientX - start.x;
				this.cam.y = start.cy + e.clientY - start.y;
				this.applyCamera();
				svg.addClass("is-panning");
			}
		});
		const end = (e: PointerEvent) => {
			if (!start) return;
			if (pressed && !moved) this.openNode(pressed, Keymap.isModEvent(e));
			if (this.dragging) {
				this.dragging.fixed = false;
				this.dragging = null;
				this.alpha = Math.max(this.alpha, 0.1);
				this.loop();
			}
			svg.removeClass("is-dragging", "is-panning");
			start = pressed = null;
		};
		svg.addEventListener("pointerup", end);
		svg.addEventListener("pointercancel", end);
		svg.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				const r = svg.getBoundingClientRect();
				const mx = e.clientX - r.left, my = e.clientY - r.top;
				const k = Math.min(3, Math.max(0.15, this.cam.k * Math.exp(-e.deltaY * 0.0015)));
				const f = k / this.cam.k;
				this.cam = { k, x: mx - (mx - this.cam.x) * f, y: my - (my - this.cam.y) * f };
				this.autoFit = false;
				this.applyCamera();
			},
			{ passive: false }
		);
	}
}
