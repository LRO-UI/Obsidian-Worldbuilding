import { App, TFile, setIcon } from "obsidian";
import type StoryPlugin from "../main";
import { Goal, parseGoals } from "../model";
import { button, tagInput } from "../ui/components";
import { POWER_MAX, REPUTATION_MAX } from "../views/FactionView";
import { SheetEditorModal } from "./SheetEditorModal";

const asList = (v: unknown): string[] => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String);

/** Creates a faction, or edits an existing faction note in place when given a file. */
export class FactionModal extends SheetEditorModal {
	private power = "";
	private reputation = "";
	private goals: Goal[] = [];
	private territory: string[] = [];
	private allies: string[] = [];
	private rivals: string[] = [];

	constructor(app: App, plugin: StoryPlugin, onCreated?: (f: TFile) => void, file: TFile | null = null) {
		const s = plugin.settings;
		super(
			app,
			plugin,
			{
				type: "faction",
				noun: "faction",
				folder: s.factionsFolder,
				fields: s.factionFields,
				tables: s.factionTables,
				linkFields: ["leader", "seat"],
				namePlaceholder: "Gilded Compass",
				tagline: { key: "motto", label: "Motto", placeholder: "Every route has a price" },
				people: { key: "members", title: "Members", help: "Characters whose faction or affiliation links here are added automatically; list anyone else here." },
			},
			onCreated,
			file
		);
	}

	protected loadExtra(fm: Record<string, unknown>): void {
		this.power = fm.power == null ? "" : String(fm.power);
		this.reputation = fm.reputation == null ? "" : String(fm.reputation);
		this.goals = parseGoals(fm.goals);
		this.territory = asList(fm.territory);
		this.allies = asList(fm.allies);
		this.rivals = asList(fm.rivals);
	}

	protected renderExtra(parent: HTMLElement): void {
		const st = this.section(parent, "Standing", `Power 0–${POWER_MAX}, reputation −${REPUTATION_MAX} to +${REPUTATION_MAX}. You can also click the meters on the sheet.`);
		const grid = st.createDiv({ cls: "ct-form-grid" });
		const num = (label: string, value: string, min: number, max: number, set: (v: string) => void) => {
			const wrap = grid.createDiv({ cls: "ct-field" });
			wrap.createEl("label", { text: label });
			const input = wrap.createEl("input", { type: "number", value, attr: { min, max, step: 1 } });
			input.addEventListener("input", () => set(input.value));
		};
		num("Power", this.power, 0, POWER_MAX, (v) => (this.power = v));
		num("Reputation", this.reputation, -REPUTATION_MAX, REPUTATION_MAX, (v) => (this.reputation = v));

		const gs = this.section(parent, "Goals", "Tick a goal once the faction has achieved it.");
		this.goals.forEach((g, i) => {
			const row = gs.createDiv({ cls: "ct-goal-edit" });
			const cb = row.createEl("input", { type: "checkbox" });
			cb.checked = g.done;
			cb.addEventListener("change", () => (g.done = cb.checked));
			const input = row.createEl("input", { type: "text", value: g.text });
			input.addEventListener("input", () => (g.text = input.value));
			const rm = row.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": "Remove goal" } });
			setIcon(rm, "x");
			rm.addEventListener("click", () => {
				this.goals.splice(i, 1);
				this.render();
			});
		});
		button(gs, "+ Add goal", () => {
			this.goals.push({ text: "", done: false });
			this.render();
		}).addClass("ct-self-start");

		const tr = this.section(parent, "Territory", "Places the faction holds. Cities that list this faction under factions show up too, as \"present\".");
		tagInput(this.app, tr, "", this.territory, "cyan", { suggestNotes: true });
		const rel = this.section(parent, "Allies and rivals", "Other factions. Ones that list this faction in their own allies or rivals are added automatically.");
		tagInput(this.app, rel, "Allies", this.allies, "green", { suggestNotes: true });
		tagInput(this.app, rel, "Rivals", this.rivals, "red", { suggestNotes: true });
	}

	protected buildExtra(): Record<string, unknown> {
		const num = (v: string, lo: number, hi: number) => (v.trim() !== "" && Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : "");
		return {
			power: num(this.power, 0, POWER_MAX),
			reputation: num(this.reputation, -REPUTATION_MAX, REPUTATION_MAX),
			goals: this.goals.filter((g) => g.text.trim()).map((g) => ({ text: g.text.trim(), done: g.done })),
			territory: [...this.territory],
			allies: [...this.allies],
			rivals: [...this.rivals],
		};
	}

	protected renderBody(parent: HTMLElement): void {
		const desc = this.section(parent, "Overview", "The note body. Markdown and [[links]] work.");
		const ta = desc.createEl("textarea", { cls: "ct-lore-input is-short", text: this.body });
		ta.addEventListener("input", () => (this.body = ta.value));
	}
}
