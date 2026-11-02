import { TFile, setIcon } from "obsidian";
import { splitSections } from "../model";
import { CustomType } from "../settings";
import { button } from "../ui/components";
import { GallerySheetView } from "./GallerySheetView";

export const VIEW_CUSTOM = "custom-sheet";

/** One view for every user-defined type in settings (artifact, religion, language…). */
export class CustomSheetView extends GallerySheetView {
	protected readonly fallbackTitle = "Sheet";

	/** The custom type of the current note, if it is one. */
	private get def(): CustomType | null {
		const type = this.file ? this.app.metadataCache.getFileCache(this.file)?.frontmatter?.type : null;
		return this.plugin.customType(type);
	}

	protected get noteType(): string {
		return this.def?.type ?? "";
	}
	protected get noun(): string {
		return this.def?.label.toLowerCase() ?? "note";
	}

	protected accepts(type: unknown): boolean {
		return !!this.plugin.customType(type);
	}

	getViewType(): string {
		return VIEW_CUSTOM;
	}
	getIcon(): string {
		return this.def?.icon || "file-text";
	}

	protected openEditor(): void {
		const def = this.def;
		if (this.file && def) this.plugin.openCustomModal(def, this.file);
	}

	protected renderEmpty(root: HTMLElement): void {
		const box = root.createDiv({ cls: "ct-empty" });
		setIcon(box.createDiv({ cls: "ct-empty-icon" }), "shapes");
		box.createDiv({ cls: "ct-empty-title", text: this.file ? "This note isn't a custom type" : "No note selected" });
		const types = this.plugin.settings.customTypes;
		box.createDiv({
			cls: "ct-empty-text",
			text: types.length ? `Custom types: ${types.map((t) => t.type).join(", ")}. Add more in settings.` : "Define types like artifact or religion under Custom types in settings.",
		});
		for (const t of types) button(box, `Create new ${t.label.toLowerCase()}`, () => this.plugin.openCustomModal(t), "ct-btn mod-cta");
	}

	protected renderSheet(root: HTMLElement, file: TFile, fm: Record<string, unknown>, body: string): void {
		const def = this.def!;
		const noun = def.label.toLowerCase();
		const page = root.createDiv({ cls: "ct-sheet ct-city ct-species ct-custom" });
		this.renderHeader(page, file, fm, def.tagline ? fm[def.tagline] : null);
		this.renderGallery(page, file, fm);

		const { intro, sections } = splitSections(body);
		const grid = page.createDiv({ cls: "ct-city-grid" });
		const ov = grid.createDiv({ cls: "ct-stack-8" });
		ov.createDiv({ cls: "ct-h16", text: "Overview" });
		this.renderMarkdown(ov.createDiv({ cls: "ct-body markdown-rendered" }), intro, file, `Nothing written yet. Use the wand to describe the ${noun}.`);
		const example = def.fields.slice(0, 2).map((f) => f.label.toLowerCase()).join(" or ");
		this.renderGlance(grid.createDiv({ cls: "ct-stack-8" }), file, fm, def.fields, example ? `Add fields like ${example} to the frontmatter.` : "Add \"At a glance\" fields for this type in settings.");

		this.renderSections(page, file, sections, def.sections);
		this.renderTables(page, file, fm, def.tables);

		const bottom = page.createDiv({ cls: "ct-city-bottom" });
		this.renderPeople(bottom.createDiv({ cls: "ct-stack-8" }), file, fm, "Notable people", "notable_people");
		this.renderRelated(bottom.createDiv({ cls: "ct-stack-8" }), file);
	}
}
