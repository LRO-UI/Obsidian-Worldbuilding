import { App, Modal, TFile } from "obsidian";
import type StoryPlugin from "../main";
import { PLACE_TYPES } from "../maps";
import { THEME_COLORS } from "../settings";
import { button, dateInput, NoteSuggest } from "../ui/components";

export interface MapItemFields {
	note: string;
	label: string;
	color: string;
	from: number | null;
	to: number | null;
}

export interface MapItemOptions {
	kind: "pin" | "border";
	isNew: boolean;
	sourcePath: string;
	value: MapItemFields;
	/** Where a newly enabled date starts: the date the map is showing. */
	defaultDate: number | null;
	onSave: (value: MapItemFields) => void;
	onRemove: () => void;
}

/** The details of a map pin or border: its note, how it looks, and when it exists. */
export class MapItemModal extends Modal {
	private value: MapItemFields;
	private error = "";

	constructor(app: App, private plugin: StoryPlugin, private opts: MapItemOptions) {
		super(app);
		this.value = { ...opts.value };
	}

	onOpen(): void {
		this.modalEl.addClass("ct-event-modal");
		const noun = this.opts.kind;
		this.setTitle(`${this.opts.isNew ? "New" : "Edit"} ${noun}`);
		this.scope.register([], "Enter", (e) => {
			if ((e.target as HTMLElement)?.tagName === "BUTTON") return;
			e.preventDefault();
			this.save();
			return false;
		});
		this.render();
	}

	/** Places first, then every other note. */
	private rank(f: TFile): number {
		const type = this.app.metadataCache.getFileCache(f)?.frontmatter?.type;
		if (typeof type === "string" && PLACE_TYPES.includes(type)) return 0;
		return this.opts.kind === "border" && type === "faction" ? 0 : 1;
	}

	private dateField(parent: HTMLElement, label: string, key: "from" | "to"): void {
		const field = parent.createDiv({ cls: "ct-field" });
		const lab = field.createEl("label", { cls: "ct-row-6" });
		const cb = lab.createEl("input", { type: "checkbox" });
		cb.checked = this.value[key] != null;
		lab.appendText(label);
		cb.addEventListener("change", () => {
			this.value[key] = cb.checked ? this.opts.defaultDate ?? this.plugin.settings.currentYear * 12 : null;
			this.render();
		});
		const at = this.value[key];
		if (at != null) dateInput(field, this.plugin.settings.months, at, (i) => (this.value[key] = i));
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const { kind } = this.opts;
		const grid = el.createDiv({ cls: "ct-form-grid" });

		const n = grid.createDiv({ cls: "ct-field is-full" });
		n.createEl("label", { text: kind === "pin" ? "Linked note" : "Linked note (a region or faction)" });
		const ni = n.createEl("input", { type: "text", value: this.value.note, attr: { placeholder: kind === "pin" ? "[[Kesthaven]]" : "[[House Dace]]" } });
		ni.addEventListener("input", () => (this.value.note = ni.value));
		new NoteSuggest(this.app, ni, undefined, undefined, (f) => this.rank(f));
		if (this.error) n.createDiv({ cls: "ct-error", text: this.error });
		window.setTimeout(() => ni.focus(), 0);

		const l = grid.createDiv({ cls: "ct-field" });
		l.createEl("label", { text: kind === "pin" ? "Label (defaults to the note's name)" : "Name (defaults to the note's name)" });
		const li = l.createEl("input", { type: "text", value: this.value.label, attr: { placeholder: kind === "pin" ? "The Lantern Spire" : "Dace holdings" } });
		li.addEventListener("input", () => (this.value.label = li.value));

		const c = grid.createDiv({ cls: "ct-field" });
		c.createEl("label", { text: "Colour" });
		const sel = c.createEl("select", { cls: "dropdown" });
		sel.createEl("option", { text: "Theme accent", value: "" });
		for (const color of THEME_COLORS) sel.createEl("option", { text: color[0].toUpperCase() + color.slice(1), value: color });
		sel.value = this.value.color;
		sel.addEventListener("change", () => (this.value.color = sel.value));

		this.dateField(grid, "Appears from", "from");
		this.dateField(grid, "Lasts until", "to");
		grid.createDiv({
			cls: "ct-field is-full ct-faint ct-12",
			text: "Leave a date off to use the linked note's own: when a city or faction was founded, or when an event happened. With no dates at all, it's always shown.",
		});

		const foot = el.createDiv({ cls: "ct-wizard-foot" });
		const left = foot.createDiv({ cls: "ct-row-8" });
		if (!this.opts.isNew) {
			const rm = button(left, `Remove ${kind}`, () => {
				this.close();
				this.opts.onRemove();
			});
			rm.addClass("mod-warning");
		}
		const btns = foot.createDiv({ cls: "ct-row-8" });
		button(btns, "Cancel", () => this.close());
		button(btns, this.opts.isNew ? "Add pin" : "Save", () => this.save(), "ct-btn mod-cta");
	}

	private save(): void {
		const v = this.value;
		const raw = v.note.trim();
		v.note = !raw || raw.includes("[[") ? raw : `[[${raw}]]`;
		v.label = v.label.trim();
		if (this.opts.kind === "pin" && !v.note && !v.label) this.error = "Link a note or give the pin a label.";
		else if (v.from != null && v.to != null && v.to < v.from) this.error = `"Lasts until" can't be before "Appears from".`;
		else this.error = "";
		if (this.error) return this.render();
		this.close();
		this.opts.onSave(v);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
