import { App, Modal, Notice, normalizePath, stringifyYaml, TFile } from "obsidian";
import { fromIndex, toIndex } from "../calendar";
import type StoryPlugin from "../main";
import { ensureFolder, isCharacter, joinPath, safeFileName } from "../model";
import { button, NoteSuggest } from "../ui/components";

export interface EventPrefill {
	lane?: string; // basename or "World"
	start?: number; // month index
}

export class EventModal extends Modal {
	private title = "";
	private start: number;
	private end: number | null = null;
	private lane: string;
	private category: string;
	private characters = "";
	private location = "";
	private error = "";

	constructor(app: App, private plugin: StoryPlugin, prefill: EventPrefill = {}, private onCreated?: (f: TFile) => void) {
		super(app);
		this.start = prefill.start ?? plugin.settings.currentYear * 12;
		this.lane = !prefill.lane || prefill.lane === "World" ? "World" : `[[${prefill.lane}]]`;
		if (this.lane !== "World") this.characters = this.lane;
		this.category = plugin.settings.categories[0]?.key ?? "";
	}

	onOpen(): void {
		this.modalEl.addClass("ct-event-modal");
		this.setTitle("New event");
		this.render();
	}

	private dateInput(parent: HTMLElement, idx: number, onChange: (i: number) => void): void {
		const d = fromIndex(idx);
		const row = parent.createDiv({ cls: "ct-row-8" });
		const sel = row.createEl("select", { cls: "dropdown" });
		this.plugin.settings.months.forEach((m, i) => sel.createEl("option", { text: m, value: String(i) }));
		sel.value = String(d.month);
		const yr = row.createEl("input", { type: "number", value: String(d.year), cls: "ct-year" });
		const fire = () => onChange(toIndex({ month: Number(sel.value), year: Number(yr.value) || 0 }));
		sel.addEventListener("change", fire);
		yr.addEventListener("input", fire);
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const grid = el.createDiv({ cls: "ct-form-grid" });

		const t = grid.createDiv({ cls: "ct-field is-full" });
		t.createEl("label", { text: "Title *" });
		const ti = t.createEl("input", { type: "text", value: this.title, attr: { placeholder: "Betrayal at Varn" } });
		ti.addEventListener("input", () => (this.title = ti.value));
		if (this.error) t.createDiv({ cls: "ct-error", text: this.error });
		window.setTimeout(() => ti.focus(), 0);

		const s = grid.createDiv({ cls: "ct-field" });
		s.createEl("label", { text: "Start" });
		this.dateInput(s, this.start, (i) => (this.start = i));

		const e = grid.createDiv({ cls: "ct-field" });
		const lab = e.createEl("label", { cls: "ct-row-6" });
		const cb = lab.createEl("input", { type: "checkbox" });
		cb.checked = this.end != null;
		lab.appendText("Has an end (duration)");
		cb.addEventListener("change", () => {
			this.end = cb.checked ? this.start + 12 : null;
			this.render();
		});
		if (this.end != null) this.dateInput(e, this.end, (i) => (this.end = i));

		const l = grid.createDiv({ cls: "ct-field" });
		l.createEl("label", { text: "Lane" });
		const li = l.createEl("input", { type: "text", value: this.lane, attr: { placeholder: "[[Character]] or World" } });
		li.addEventListener("input", () => (this.lane = li.value));
		new NoteSuggest(this.app, li, undefined, (f) => isCharacter(this.app, f));

		const c = grid.createDiv({ cls: "ct-field" });
		c.createEl("label", { text: "Category" });
		const sel = c.createEl("select", { cls: "dropdown" });
		this.plugin.settings.categories.forEach((cat) => sel.createEl("option", { text: cat.label, value: cat.key }));
		sel.value = this.category;
		sel.addEventListener("change", () => (this.category = sel.value));

		const loc = grid.createDiv({ cls: "ct-field is-full" });
		loc.createEl("label", { text: "Location (city)" });
		const loci = loc.createEl("input", { type: "text", value: this.location, attr: { placeholder: "[[Kesthaven]]" } });
		loci.addEventListener("input", () => (this.location = loci.value));
		new NoteSuggest(this.app, loci, undefined, (f) => this.app.metadataCache.getFileCache(f)?.frontmatter?.type === "city");

		const ch = grid.createDiv({ cls: "ct-field is-full" });
		ch.createEl("label", { text: "Characters (comma-separated links)" });
		const chi = ch.createEl("input", { type: "text", value: this.characters, attr: { placeholder: "[[Maren Voss]], [[Ilsa Rhee]]" } });
		chi.addEventListener("input", () => (this.characters = chi.value));

		const foot = el.createDiv({ cls: "ct-wizard-foot" });
		foot.createDiv({ cls: "ct-faint ct-12", text: `Saves to ${this.plugin.settings.eventsFolder || "/"}` });
		const btns = foot.createDiv({ cls: "ct-row-8" });
		button(btns, "Cancel", () => this.close());
		button(btns, "Create event", () => this.create(), "ct-btn mod-cta");
	}

	private async create(): Promise<void> {
		const name = safeFileName(this.title);
		const path = normalizePath(joinPath(this.plugin.settings.eventsFolder, `${name}.md`));
		if (!name) this.error = "A title is required.";
		else if (this.app.vault.getAbstractFileByPath(path)) this.error = `${path} already exists.`;
		else this.error = "";
		if (this.error) return this.render();

		const fm: Record<string, unknown> = { type: "event", title: this.title.trim(), "tl-start": fromIndex(this.start) };
		if (this.end != null) fm["tl-end"] = fromIndex(Math.max(this.start + 1, this.end));
		fm.lane = this.lane.trim() || "World";
		fm.category = this.category;
		if (this.location.trim()) fm.location = this.location.trim();
		const chars = this.characters.split(",").map((x) => x.trim()).filter(Boolean);
		if (chars.length) fm.characters = chars;
		try {
			await ensureFolder(this.app, this.plugin.settings.eventsFolder);
			const f = await this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n`);
			this.close();
			this.onCreated?.(f);
		} catch (err) {
			new Notice(`Couldn't create event: ${(err as Error).message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
