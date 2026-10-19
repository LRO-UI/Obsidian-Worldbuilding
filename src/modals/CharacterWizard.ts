import { App, Modal, Notice, normalizePath, setIcon, stringifyYaml } from "obsidian";
import type StoryPlugin from "../main";
import { ensureFolder, joinPath, safeFileName, STAT_HINTS, STAT_KEYS, STAT_NAMES, StatKey } from "../model";
import { DescField, DescGroupKey, GROUP_TITLES } from "../settings";
import { button, ImagePickerModal, NoteSuggest, renderRadar } from "../ui/components";

const STEPS = ["Identity", "Attributes", "Description", "Traits", "Relationships", "Lore"];
const HELP = [
	"Who they are, where they come from, and who they answer to.",
	"Spend points above the base. Lowering a stat below the base refunds points.",
	"The writer's reference you'll lean on while drafting.",
	"Short tags. Press Enter or comma to add one.",
	"Link other character notes and say how this one feels about them.",
	"Backstory and notes. This becomes the note body (Markdown, wikilinks work).",
];

interface Draft {
	name: string;
	quote: string;
	role: string;
	ancestry: string;
	bornMonth: number;
	bornYear: string;
	affiliation: string;
	faction: string;
	factionTag: string;
	status: string;
	storyRole: string;
	portrait: string;
	stats: Record<StatKey, number>;
	desc: Record<DescGroupKey, Record<string, { text: string; color: string }>>;
	traits: string[];
	values: string[];
	weaknesses: string[];
	goals: string[];
	relationships: { who: string; kind: string; score: number }[];
	lore: string;
}

export class CharacterWizard extends Modal {
	private step = 0;
	private reached = 0;
	private draft: Draft;
	private errors: Record<string, string> = {};
	private railEl!: HTMLElement;
	private mainEl!: HTMLElement;

	constructor(app: App, private plugin: StoryPlugin) {
		super(app);
		const s = plugin.settings;
		const stats = {} as Record<StatKey, number>;
		STAT_KEYS.forEach((k) => (stats[k] = s.statBase));
		const desc = { appearance: {}, personality: {}, narration: {} } as Draft["desc"];
		(Object.keys(desc) as DescGroupKey[]).forEach((g) =>
			s.descFields[g].forEach((f) => (desc[g][f.key] = { text: "", color: "#808080" }))
		);
		this.draft = {
			name: "", quote: "", role: "", ancestry: "", bornMonth: 0, bornYear: "",
			affiliation: "", faction: "", factionTag: "", status: "", storyRole: "", portrait: "",
			stats, desc, traits: [], values: [], weaknesses: [], goals: [], relationships: [], lore: "",
		};
	}

	private options(f: DescField): string[] {
		return (f.options ?? "").split(",").map((o) => o.trim()).filter(Boolean);
	}

	onOpen(): void {
		this.modalEl.addClass("ct-wizard-modal");
		this.contentEl.empty();
		const shell = this.contentEl.createDiv({ cls: "ct-wizard" });
		this.railEl = shell.createDiv({ cls: "ct-wizard-rail" });
		this.mainEl = shell.createDiv({ cls: "ct-wizard-main" });
		this.render();
	}

	private get spent(): number {
		const s = this.plugin.settings;
		return STAT_KEYS.reduce((a, k) => a + (this.draft.stats[k] - s.statBase), 0);
	}

	private get filePath(): string {
		const name = safeFileName(this.draft.name) || "<Name>";
		return normalizePath(joinPath(this.plugin.settings.charactersFolder, `${name}.md`));
	}

	private validateIdentity(): boolean {
		this.errors = {};
		const name = safeFileName(this.draft.name);
		if (!name) this.errors.name = "A name is required.";
		else if (this.app.vault.getAbstractFileByPath(this.filePath)) this.errors.name = `${this.filePath} already exists. Pick another name.`;
		return !this.errors.name;
	}

	private go(step: number): void {
		if (step > this.step && this.step === 0 && !this.validateIdentity()) {
			this.render();
			return;
		}
		this.step = step;
		this.reached = Math.max(this.reached, step);
		this.render();
	}

	private render(): void {
		this.renderRail();
		const main = this.mainEl;
		main.empty();

		const head = main.createDiv({ cls: "ct-wizard-head" });
		const titles = head.createDiv({ cls: "ct-stack-4" });
		titles.createDiv({ cls: "ct-h18", text: STEPS[this.step] });
		titles.createDiv({ cls: "ct-muted ct-13", text: HELP[this.step] });
		if (this.step === 1) {
			const left = this.plugin.settings.pointPool - this.spent;
			const pts = head.createDiv({ cls: "ct-points" });
			pts.createDiv({ cls: `ct-points-num ${left === 0 ? "is-zero" : ""}`, text: String(left) });
			pts.createDiv({ cls: "ct-faint ct-11", text: "points left" });
		}

		const body = main.createDiv({ cls: "ct-wizard-body" });
		[this.stepIdentity, this.stepAttributes, this.stepDescription, this.stepTraits, this.stepRelationships, this.stepLore][this.step].call(this, body);

		const foot = main.createDiv({ cls: "ct-wizard-foot" });
		foot.createDiv({ cls: "ct-faint ct-12", text: `Saves to ${this.filePath}` });
		const btns = foot.createDiv({ cls: "ct-row-8" });
		if (this.step > 0) button(btns, "Back", () => this.go(this.step - 1));
		if (this.step < STEPS.length - 1) button(btns, `Next: ${STEPS[this.step + 1]}`, () => this.go(this.step + 1), "ct-btn mod-cta");
		else button(btns, "Create character", () => this.create(), "ct-btn mod-cta");
	}

	private renderRail(): void {
		const rail = this.railEl;
		rail.empty();
		rail.createDiv({ cls: "ct-wizard-title", text: "New character" });
		STEPS.forEach((label, i) => {
			const done = i < this.step || (i <= this.reached && i !== this.step);
			const row = rail.createDiv({ cls: `ct-step ${i === this.step ? "is-current" : ""} ${done ? "is-done" : ""} ${i > this.reached ? "is-future" : ""}` });
			const dot = row.createSpan({ cls: "ct-step-dot" });
			if (done) setIcon(dot, "check");
			else dot.setText(String(i + 1));
			row.createSpan({ text: label });
			if (i <= this.reached && i !== this.step) row.addEventListener("click", () => this.go(i));
		});
	}

	// ---------- field helpers ----------

	private field(parent: HTMLElement, label: string, opts: { value: string; onChange: (v: string) => void; placeholder?: string; error?: string; suggest?: boolean; full?: boolean }): HTMLInputElement {
		const wrap = parent.createDiv({ cls: `ct-field ${opts.full ? "is-full" : ""}` });
		wrap.createEl("label", { text: label });
		const input = wrap.createEl("input", { type: "text", value: opts.value, attr: { placeholder: opts.placeholder ?? "" } });
		input.addEventListener("input", () => opts.onChange(input.value));
		if (opts.suggest) new NoteSuggest(this.app, input);
		if (opts.error) wrap.createDiv({ cls: "ct-error", text: opts.error });
		return input;
	}

	private stepIdentity(body: HTMLElement): void {
		const d = this.draft;
		const s = this.plugin.settings;
		const grid = body.createDiv({ cls: "ct-form-grid" });
		const nameInput = this.field(grid, "Name *", {
			value: d.name,
			placeholder: "Maren Voss",
			error: this.errors.name,
			full: true,
			onChange: (v) => {
				d.name = v;
				const foot = this.mainEl.querySelector(".ct-wizard-foot .ct-faint");
				if (foot) foot.setText(`Saves to ${this.filePath}`);
			},
		});
		window.setTimeout(() => nameInput.focus(), 0);
		this.field(grid, "Quote", { value: d.quote, onChange: (v) => (d.quote = v), full: true, placeholder: "A line they'd say" });
		this.field(grid, "Role", { value: d.role, onChange: (v) => (d.role = v), placeholder: "Cartographer, sellsword" });
		this.field(grid, "Ancestry", { value: d.ancestry, onChange: (v) => (d.ancestry = v) });

		const born = grid.createDiv({ cls: "ct-field" });
		born.createEl("label", { text: `Born (${s.eraAbbr || "year"})` });
		const row = born.createDiv({ cls: "ct-row-8" });
		const sel = row.createEl("select", { cls: "dropdown" });
		s.months.forEach((m, i) => sel.createEl("option", { text: m, value: String(i) }));
		sel.value = String(d.bornMonth);
		sel.addEventListener("change", () => (d.bornMonth = Number(sel.value)));
		const yr = row.createEl("input", { type: "number", value: d.bornYear, cls: "ct-year", attr: { placeholder: String(s.currentYear - 20) } });
		yr.addEventListener("input", () => (d.bornYear = yr.value));

		this.field(grid, "Story role", { value: d.storyRole, onChange: (v) => (d.storyRole = v), placeholder: "Protagonist" });
		this.field(grid, "Affiliation", { value: d.affiliation, onChange: (v) => (d.affiliation = v), suggest: true, placeholder: "[[Gilded Compass]]" });
		this.field(grid, "Faction", { value: d.faction, onChange: (v) => (d.faction = v), suggest: true, placeholder: "[[The Unmapped]]" });
		this.field(grid, "Faction tag", { value: d.factionTag, onChange: (v) => (d.factionTag = v), placeholder: "Outlaw" });
		this.field(grid, "Status", { value: d.status, onChange: (v) => (d.status = v), placeholder: "Exiled" });

		const p = grid.createDiv({ cls: "ct-field is-full" });
		p.createEl("label", { text: "Portrait" });
		const pr = p.createDiv({ cls: "ct-row-8" });
		const pin = pr.createEl("input", { type: "text", value: d.portrait, attr: { placeholder: "[[maren.png]]" } });
		pin.addEventListener("input", () => (d.portrait = pin.value));
		button(pr, "Choose…", () =>
			new ImagePickerModal(this.app, (f) => {
				d.portrait = `[[${f.name}]]`;
				pin.value = d.portrait;
			}).open()
		);
	}

	private stepAttributes(body: HTMLElement): void {
		const s = this.plugin.settings;
		const d = this.draft;
		const wrap = body.createDiv({ cls: "ct-attr" });
		const rows = wrap.createDiv({ cls: "ct-attr-rows" });
		for (const k of STAT_KEYS) {
			const row = rows.createDiv({ cls: "ct-attr-row" });
			const name = row.createDiv({ cls: "ct-stack-0" });
			name.createDiv({ cls: "ct-13", text: STAT_NAMES[k] });
			name.createDiv({ cls: "ct-faint ct-11", text: STAT_HINTS[k] });
			const set = (delta: number) => {
				const v = d.stats[k] + delta;
				if (v < s.statMin || v > s.statMax || this.spent + delta > s.pointPool) return;
				d.stats[k] = v;
				this.render();
			};
			button(row, "−", () => set(-1), "ct-step-btn").setAttr("aria-label", `Lower ${STAT_NAMES[k]}`);
			row.createDiv({ cls: "ct-attr-val", text: String(d.stats[k]) });
			button(row, "+", () => set(1), "ct-step-btn").setAttr("aria-label", `Raise ${STAT_NAMES[k]}`);
		}
		const side = wrap.createDiv({ cls: "ct-attr-side" });
		renderRadar(side, STAT_KEYS.map((k) => d.stats[k]), s.statMax);
		side.createEl("pre", { cls: "ct-yaml", text: "---\nstats:\n" + STAT_KEYS.map((k) => `  ${k}: ${d.stats[k]}`).join("\n") + "\n---" });
	}

	private stepDescription(body: HTMLElement): void {
		const s = this.plugin.settings;
		const groups = body.createDiv({ cls: "ct-stack-20" });
		for (const g of Object.keys(GROUP_TITLES) as DescGroupKey[]) {
			if (!s.descFields[g].length) continue;
			const sec = groups.createDiv({ cls: "ct-stack-8" });
			sec.createDiv({ cls: "ct-label", text: GROUP_TITLES[g] });
			const grid = sec.createDiv({ cls: "ct-form-grid" });
			for (const f of s.descFields[g]) {
				const val = (this.draft.desc[g][f.key] ??= { text: "", color: "#808080" });
				const wrap = grid.createDiv({ cls: `ct-field ${f.type === "textarea" ? "is-full" : ""}` });
				wrap.createEl("label", { text: f.label });
				if (f.type === "enum") {
					const sel = wrap.createEl("select", { cls: "dropdown" });
					sel.createEl("option", { text: "—", value: "" });
					this.options(f).forEach((o) => sel.createEl("option", { text: o, value: o }));
					sel.value = val.text;
					sel.addEventListener("change", () => (val.text = sel.value));
				} else if (f.type === "textarea") {
					const ta = wrap.createEl("textarea", { text: val.text, attr: { rows: "3" } });
					ta.addEventListener("input", () => (val.text = ta.value));
				} else {
					const row = wrap.createDiv({ cls: "ct-row-8" });
					if (f.type === "color") {
						const c = row.createEl("input", { type: "color", value: val.color, cls: "ct-color" });
						c.addEventListener("input", () => (val.color = c.value));
					}
					const t = row.createEl("input", { type: "text", value: val.text });
					t.addEventListener("input", () => (val.text = t.value));
				}
			}
		}
	}

	private tagInput(parent: HTMLElement, label: string, list: string[], color: string): void {
		const wrap = parent.createDiv({ cls: "ct-field is-full" });
		wrap.createEl("label", { text: label });
		const box = wrap.createDiv({ cls: "ct-tag-input" });
		const draw = () => {
			box.empty();
			list.forEach((t, i) => {
				const p = box.createSpan({ cls: "ct-pill", text: t });
				p.style.setProperty("--ct-c", `var(--color-${color})`);
				const x = p.createSpan({ cls: "ct-pill-x", text: "×", attr: { "aria-label": `Remove ${t}` } });
				x.addEventListener("click", () => {
					list.splice(i, 1);
					draw();
				});
			});
			const input = box.createEl("input", { type: "text", attr: { placeholder: list.length ? "" : "Type and press Enter" } });
			input.addEventListener("keydown", (e) => {
				if ((e.key === "Enter" || e.key === ",") && input.value.trim()) {
					e.preventDefault();
					list.push(input.value.trim().replace(/,$/, ""));
					draw();
					(box.querySelector("input") as HTMLInputElement).focus();
				} else if (e.key === "Backspace" && !input.value && list.length) {
					list.pop();
					draw();
					(box.querySelector("input") as HTMLInputElement).focus();
				}
			});
		};
		draw();
	}

	private stepTraits(body: HTMLElement): void {
		const d = this.draft;
		const g = body.createDiv({ cls: "ct-form-grid" });
		this.tagInput(g, "Traits", d.traits, "green");
		this.tagInput(g, "Values", d.values, "blue");
		this.tagInput(g, "Weaknesses", d.weaknesses, "red");
		this.tagInput(g, "Goals", d.goals, "purple");
	}

	private stepRelationships(body: HTMLElement): void {
		const d = this.draft;
		const list = body.createDiv({ cls: "ct-stack-10" });
		d.relationships.forEach((r, i) => {
			const row = list.createDiv({ cls: "ct-relrow" });
			const who = row.createEl("input", { type: "text", value: r.who, attr: { placeholder: "[[Character]]" } });
			who.addEventListener("input", () => (r.who = who.value));
			new NoteSuggest(this.app, who);
			const kind = row.createEl("input", { type: "text", value: r.kind, attr: { placeholder: "Partner, rival…" } });
			kind.addEventListener("input", () => (r.kind = kind.value));
			const sl = row.createEl("input", { type: "range", attr: { min: "-10", max: "10", step: "1" }, value: String(r.score) });
			const out = row.createSpan({ cls: "ct-mono ct-score", text: String(r.score) });
			sl.addEventListener("input", () => {
				r.score = Number(sl.value);
				out.setText(r.score > 0 ? `+${r.score}` : r.score < 0 ? `−${-r.score}` : "0");
				out.toggleClass("is-pos", r.score > 0);
				out.toggleClass("is-neg", r.score < 0);
			});
			const rm = row.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": "Remove" } });
			setIcon(rm, "x");
			rm.addEventListener("click", () => {
				d.relationships.splice(i, 1);
				this.render();
			});
		});
		button(list, "+ Add relationship", () => {
			d.relationships.push({ who: "", kind: "", score: 0 });
			this.render();
		});
	}

	private stepLore(body: HTMLElement): void {
		const ta = body.createEl("textarea", { cls: "ct-lore-input", text: this.draft.lore, attr: { placeholder: "Apprenticed to the [[Gilded Compass]] at eleven…" } });
		ta.addEventListener("input", () => (this.draft.lore = ta.value));
	}

	// ---------- write ----------

	private buildFrontmatter(): Record<string, unknown> {
		const d = this.draft;
		const s = this.plugin.settings;
		const fm: Record<string, unknown> = { type: "character", name: d.name.trim() };
		const put = (k: string, v: unknown) => {
			if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
			fm[k] = v;
		};
		put("quote", d.quote);
		put("portrait", d.portrait);
		put("status", d.status);
		put("role", d.role);
		put("ancestry", d.ancestry);
		if (d.bornYear !== "" && Number.isFinite(Number(d.bornYear))) fm.born = { month: d.bornMonth, year: Number(d.bornYear) };
		put("affiliation", d.affiliation);
		put("faction", d.faction);
		put("faction_tag", d.factionTag);
		put("story_role", d.storyRole);
		fm.stats = { ...d.stats };
		put("traits", d.traits);
		put("values", d.values);
		put("weaknesses", d.weaknesses);
		put("goals", d.goals.map((text) => ({ text, done: false })));
		put("relationships", d.relationships.filter((r) => r.who.trim()).map((r) => (r.kind.trim() ? r : { who: r.who, score: r.score })));

		const description: Record<string, Record<string, unknown>> = {};
		for (const g of Object.keys(GROUP_TITLES) as DescGroupKey[]) {
			const out: Record<string, unknown> = {};
			for (const f of s.descFields[g]) {
				const v = d.desc[g][f.key];
				if (!v?.text) continue;
				out[f.key] = f.type === "color" ? { text: v.text, color: v.color } : v.text;
			}
			if (Object.keys(out).length) description[g] = out;
		}
		if (Object.keys(description).length) fm.description = description;
		return fm;
	}

	private async create(): Promise<void> {
		if (!this.validateIdentity()) {
			this.step = 0;
			this.render();
			return;
		}
		try {
			await ensureFolder(this.app, this.plugin.settings.charactersFolder);
			const content = `---\n${stringifyYaml(this.buildFrontmatter())}---\n\n${this.draft.lore.trim()}\n`;
			const file = await this.app.vault.create(this.filePath, content);
			this.close();
			await this.plugin.openSheet(file);
		} catch (e) {
			console.error(e);
			new Notice(`Couldn't create character: ${(e as Error).message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
