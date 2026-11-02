import { TFile, setIcon } from "obsidian";
import { initials, isCharacter, parseGoals, parseLink, resolveFirstLink } from "../model";
import { button, pill, renderLinkish, sectionLabel } from "../ui/components";
import { asList, GallerySheetView } from "./GallerySheetView";

export const VIEW_FACTION = "faction-sheet";

export const POWER_MAX = 10;
export const REPUTATION_MAX = 10;

const POWER_LABELS: [number, string][] = [[0, "Broken"], [2, "Fringe"], [4, "Minor"], [6, "Established"], [8, "Major"], [10, "Dominant"]];
const powerLabel = (n: number) => POWER_LABELS.find(([max]) => n <= max)?.[1] ?? "Dominant";
const reputationLabel = (n: number) => (n <= -7 ? "Reviled" : n <= -3 ? "Distrusted" : n < 3 ? "Neutral" : n < 7 ? "Respected" : "Revered");
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
const noteLink = (f: TFile) => `[[${f.path.replace(/\.md$/, "")}|${f.basename}]]`;

type Stance = "ally" | "rival";
interface Relation { file: TFile | null; raw: string; stance: Stance; note: string }
interface Member { file: TFile | null; raw: string; tag: string; leader: boolean }

export class FactionView extends GallerySheetView {
	protected readonly noteType = "faction";
	protected readonly fallbackTitle = "Faction";
	protected readonly noun = "faction";

	getViewType(): string {
		return VIEW_FACTION;
	}
	getIcon(): string {
		return "flag";
	}

	protected openEditor(): void {
		if (this.file) this.plugin.openFactionModal(this.file);
	}

	protected renderEmpty(root: HTMLElement): void {
		const box = root.createDiv({ cls: "ct-empty" });
		setIcon(box.createDiv({ cls: "ct-empty-icon" }), "flag");
		box.createDiv({ cls: "ct-empty-title", text: this.file ? "This note isn't a faction" : "No faction selected" });
		box.createDiv({ cls: "ct-empty-text", text: "Faction notes have type: faction in their frontmatter." });
		button(box, "Create new faction", () => this.plugin.openFactionModal(), "ct-btn mod-cta");
	}

	protected renderSheet(root: HTMLElement, file: TFile, fm: Record<string, unknown>, body: string): void {
		const page = root.createDiv({ cls: "ct-sheet ct-city ct-faction" });
		this.renderHeader(page, file, fm, fm.motto);
		this.renderGallery(page, file, fm);

		const grid = page.createDiv({ cls: "ct-city-grid" });
		const ov = grid.createDiv({ cls: "ct-stack-8" });
		ov.createDiv({ cls: "ct-h16", text: "Overview" });
		this.renderMarkdown(ov.createDiv({ cls: "ct-body markdown-rendered" }), body, file, "Nothing written yet. Use the wand to describe the faction.");
		const side = grid.createDiv({ cls: "ct-stack-16" });
		this.renderStanding(side.createDiv({ cls: "ct-stack-8" }), fm);
		this.renderGlance(side.createDiv({ cls: "ct-stack-8" }), file, fm, this.plugin.settings.factionFields, "Add fields like leader or seat to the frontmatter.");

		const mid = page.createDiv({ cls: "ct-city-bottom" });
		this.renderGoals(mid.createDiv({ cls: "ct-stack-8" }), fm);
		this.renderTerritory(mid.createDiv({ cls: "ct-stack-8" }), file, fm);

		this.renderTables(page, file, fm, this.plugin.settings.factionTables);

		const bottom = page.createDiv({ cls: "ct-city-bottom" });
		this.renderMembers(bottom.createDiv({ cls: "ct-stack-8" }), file, fm);
		this.renderRelations(bottom.createDiv({ cls: "ct-stack-16" }), file, fm);
	}

	// ---------- power & reputation ----------

	private renderStanding(col: HTMLElement, fm: Record<string, unknown>): void {
		sectionLabel(col, "Standing");
		const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
		const power = num(fm.power);
		const rep = num(fm.reputation);

		const p = this.meterHead(col, "Power", power == null ? "—" : `${clamp(power, 0, POWER_MAX)} / ${POWER_MAX} · ${powerLabel(clamp(power, 0, POWER_MAX))}`);
		const pv = power == null ? 0 : clamp(power, 0, POWER_MAX);
		const ptrack = p.createDiv({ cls: "ct-meter" });
		for (let i = 1; i <= POWER_MAX; i++) {
			const pip = this.pip(ptrack, `Set power to ${i}`, i <= pv);
			pip.addEventListener("click", () => this.update((f) => (f.power = i === pv ? i - 1 : i)));
		}

		const r = this.meterHead(col, "Reputation", rep == null ? "—" : `${signed(clamp(rep, -REPUTATION_MAX, REPUTATION_MAX))} · ${reputationLabel(clamp(rep, -REPUTATION_MAX, REPUTATION_MAX))}`);
		const rv = rep == null ? 0 : clamp(rep, -REPUTATION_MAX, REPUTATION_MAX);
		const rtrack = r.createDiv({ cls: "ct-meter is-diverging" });
		for (let i = -REPUTATION_MAX; i <= REPUTATION_MAX; i++) {
			if (i === 0) {
				rtrack.createSpan({ cls: "ct-meter-zero" });
				continue;
			}
			const on = i < 0 ? rv <= i : rv >= i;
			const pip = this.pip(rtrack, `Set reputation to ${signed(i)}`, on, i < 0 ? "is-neg" : "is-pos");
			pip.addEventListener("click", () => this.update((f) => (f.reputation = i === rv ? 0 : i)));
		}
		if (power == null && rep == null) col.createDiv({ cls: "ct-faint ct-12", text: "Click a pip to set power and reputation." });
	}

	private meterHead(col: HTMLElement, label: string, value: string): HTMLElement {
		const wrap = col.createDiv({ cls: "ct-vital" });
		const head = wrap.createDiv({ cls: "ct-vital-head" });
		head.createSpan({ text: label });
		head.createSpan({ cls: "ct-mono", text: value });
		return wrap;
	}

	private pip(track: HTMLElement, label: string, on: boolean, cls = ""): HTMLButtonElement {
		return track.createEl("button", { cls: `ct-meter-pip ${cls} ${on ? "is-on" : ""}`, attr: { "aria-label": label, "aria-pressed": String(on) } });
	}

	// ---------- goals ----------

	private renderGoals(col: HTMLElement, fm: Record<string, unknown>): void {
		const goals = parseGoals(fm.goals);
		sectionLabel(col, `Goals · ${goals.filter((g) => !g.done).length} open`);
		if (!goals.length) col.createSpan({ cls: "ct-faint ct-13", text: "No goals yet. Add some with the wand." });
		goals.forEach((g, i) => {
			const row = col.createDiv({ cls: `ct-goal ${g.done ? "is-done" : ""}` });
			const box = row.createSpan({ cls: "ct-check", attr: { role: "checkbox", "aria-checked": String(g.done), tabindex: "0" } });
			if (g.done) setIcon(box, "check");
			row.createSpan({ text: g.text });
			const toggle = () =>
				this.update((f) => {
					const cur = f.goals?.[i];
					if (cur == null) return;
					if (typeof cur === "object") cur.done = !cur.done;
					else f.goals[i] = { text: String(cur), done: true };
				});
			box.addEventListener("click", toggle);
			box.addEventListener("keydown", (e) => {
				if (e.key === " " || e.key === "Enter") {
					e.preventDefault();
					toggle();
				}
			});
		});
	}

	// ---------- territory ----------

	/** Places listed under `territory`, plus cities that list this faction under `factions`. */
	private renderTerritory(col: HTMLElement, file: TFile, fm: Record<string, unknown>): void {
		const places = new Map<string, { file: TFile | null; raw: string; held: boolean }>();
		for (const raw of asList(fm.territory).map(String)) {
			const f = resolveFirstLink(this.app, raw, file.path);
			places.set(f?.path ?? raw, { file: f, raw, held: true });
		}
		for (const src of this.backlinks(file)) {
			const sfm = this.app.metadataCache.getFileCache(src)?.frontmatter;
			if (sfm?.type !== "city" || places.has(src.path)) continue;
			if (asList(sfm.factions).some((v) => resolveFirstLink(this.app, v, src.path) === file)) places.set(src.path, { file: src, raw: src.basename, held: false });
		}

		sectionLabel(col, `Territory · ${places.size}`);
		if (!places.size) {
			col.createSpan({ cls: "ct-faint ct-13", text: `List places under territory, or add "[[${file.basename}]]" to a city's factions.` });
			return;
		}
		for (const p of places.values()) {
			const row = col.createDiv({ cls: "ct-city-event" });
			row.createSpan({ cls: "ct-dot" }).style.background = p.held ? "var(--interactive-accent)" : "var(--text-faint)";
			renderLinkish(this.app, row, p.file ? noteLink(p.file) : p.raw, file.path, "ct-13");
			row.createSpan({ cls: "ct-mono ct-faint ct-11 ct-city-event-date", text: p.held ? "held" : "present" });
		}
	}

	// ---------- members ----------

	/** Characters whose `faction` or `affiliation` points here, anyone under `members`, and the leader. */
	private renderMembers(col: HTMLElement, file: TFile, fm: Record<string, unknown>): void {
		const members = new Map<string, Member>();
		const leader = resolveFirstLink(this.app, fm.leader, file.path);
		for (const src of this.backlinks(file)) {
			if (!isCharacter(this.app, src)) continue;
			const cfm = this.app.metadataCache.getFileCache(src)?.frontmatter ?? {};
			if (resolveFirstLink(this.app, cfm.faction, src.path) === file) members.set(src.path, { file: src, raw: src.basename, tag: String(cfm.faction_tag ?? "") || "Member", leader: false });
			else if (resolveFirstLink(this.app, cfm.affiliation, src.path) === file) members.set(src.path, { file: src, raw: src.basename, tag: "Affiliate", leader: false });
		}
		for (const raw of asList(fm.members).map(String)) {
			const f = resolveFirstLink(this.app, raw, file.path);
			if (!members.has(f?.path ?? raw)) members.set(f?.path ?? raw, { file: f, raw, tag: "Member", leader: false });
		}
		if (leader) {
			const m = members.get(leader.path);
			if (m) m.leader = true;
			else members.set(leader.path, { file: leader, raw: leader.basename, tag: "", leader: true });
		}

		const name = (m: Member) => m.file?.basename ?? parseLink(m.raw).display;
		const list = [...members.values()].sort((a, b) => Number(b.leader) - Number(a.leader) || name(a).localeCompare(name(b)));
		sectionLabel(col, `Members · ${list.length}`);
		if (!list.length) col.createSpan({ cls: "ct-faint ct-13", text: `Give a character faction: "[[${file.basename}]]" to list them here.` });
		for (const m of list) {
			const row = col.createDiv({ cls: "ct-rel" });
			row.createSpan({ cls: "ct-avatar", text: initials(name(m)) });
			const mid = row.createDiv({ cls: "ct-rel-mid" });
			renderLinkish(this.app, mid, m.file ? noteLink(m.file) : m.raw, file.path, "ct-rel-name");
			const role = m.file ? this.app.metadataCache.getFileCache(m.file)?.frontmatter?.role : null;
			if (role) mid.createSpan({ cls: "ct-rel-kind", text: String(role) });
			const tags = row.createDiv({ cls: "ct-pills" });
			if (m.leader) pill(tags, "Leader", "yellow", "ct-pill is-small");
			if (m.tag) pill(tags, m.tag, m.tag === "Affiliate" ? "blue" : "purple", "ct-pill is-small");
		}
	}

	// ---------- allies & rivals ----------

	/** `allies` and `rivals` from this note, plus factions that list this one in theirs. */
	private renderRelations(col: HTMLElement, file: TFile, fm: Record<string, unknown>): void {
		const rels = new Map<string, Relation>();
		const stanceOf = (sfm: Record<string, unknown>, sourcePath: string): Stance | null => {
			const has = (key: string) => asList(sfm[key]).some((v) => resolveFirstLink(this.app, v, sourcePath) === file);
			return has("allies") ? "ally" : has("rivals") ? "rival" : null;
		};
		for (const [key, stance] of [["allies", "ally"], ["rivals", "rival"]] as const) {
			for (const raw of asList(fm[key]).map(String)) {
				const f = resolveFirstLink(this.app, raw, file.path);
				if (!rels.has(f?.path ?? raw)) rels.set(f?.path ?? raw, { file: f, raw, stance, note: "" });
			}
		}
		for (const src of this.backlinks(file)) {
			const sfm = this.app.metadataCache.getFileCache(src)?.frontmatter;
			if (sfm?.type !== "faction") continue;
			const theirs = stanceOf(sfm, src.path);
			if (!theirs) continue;
			const mine = rels.get(src.path);
			if (mine) mine.note = mine.stance === theirs ? "mutual" : `they list you as ${theirs}`;
			else rels.set(src.path, { file: src, raw: src.basename, stance: theirs, note: "listed by them" });
		}

		for (const [stance, title, color] of [["ally", "Allies", "green"], ["rival", "Rivals", "red"]] as const) {
			const sec = col.createDiv({ cls: "ct-stack-8" });
			const list = [...rels.values()].filter((r) => r.stance === stance);
			sectionLabel(sec, `${title} · ${list.length}`);
			if (!list.length) sec.createSpan({ cls: "ct-faint ct-13", text: `List factions under ${title.toLowerCase()}.` });
			for (const r of list) {
				const row = sec.createDiv({ cls: "ct-city-event" });
				row.createSpan({ cls: "ct-dot" }).style.background = `var(--color-${color})`;
				renderLinkish(this.app, row, r.file ? noteLink(r.file) : r.raw, file.path, "ct-13");
				row.createSpan({ cls: "ct-mono ct-faint ct-11 ct-city-event-date", text: r.note });
			}
		}
	}

	private backlinks(file: TFile): TFile[] {
		const resolved = this.app.metadataCache.resolvedLinks;
		const out: TFile[] = [];
		for (const src in resolved) {
			if (src === file.path || !resolved[src][file.path]) continue;
			const f = this.app.vault.getAbstractFileByPath(src);
			if (f instanceof TFile && f.extension === "md") out.push(f);
		}
		return out;
	}
}
