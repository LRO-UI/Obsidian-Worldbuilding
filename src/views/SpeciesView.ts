import { TFile, setIcon } from "obsidian";
import { splitSections } from "../model";
import { button } from "../ui/components";
import { GallerySheetView } from "./GallerySheetView";

export const VIEW_SPECIES = "species-sheet";

export class SpeciesView extends GallerySheetView {
	protected readonly noteType = "species";
	protected readonly fallbackTitle = "Species";
	protected readonly noun = "species";

	getViewType(): string {
		return VIEW_SPECIES;
	}
	getIcon(): string {
		return "paw-print";
	}

	protected openEditor(): void {
		if (this.file) this.plugin.openSpeciesModal(this.file);
	}

	protected renderEmpty(root: HTMLElement): void {
		const box = root.createDiv({ cls: "ct-empty" });
		setIcon(box.createDiv({ cls: "ct-empty-icon" }), "paw-print");
		box.createDiv({ cls: "ct-empty-title", text: this.file ? "This note isn't a species" : "No species selected" });
		box.createDiv({ cls: "ct-empty-text", text: "Species notes have type: species in their frontmatter." });
		button(box, "Create new species", () => this.plugin.openSpeciesModal(), "ct-btn mod-cta");
	}

	protected renderSheet(root: HTMLElement, file: TFile, fm: Record<string, unknown>, body: string): void {
		const s = this.plugin.settings;
		const page = root.createDiv({ cls: "ct-sheet ct-city ct-species" });
		this.renderHeader(page, file, fm, fm.epithet);
		this.renderGallery(page, file, fm);

		const { intro, sections } = splitSections(body);
		const grid = page.createDiv({ cls: "ct-city-grid" });
		const ov = grid.createDiv({ cls: "ct-stack-8" });
		ov.createDiv({ cls: "ct-h16", text: "Overview" });
		this.renderMarkdown(ov.createDiv({ cls: "ct-body markdown-rendered" }), intro, file, "Nothing written yet. Use the wand to describe the species.");
		this.renderGlance(grid.createDiv({ cls: "ct-stack-8" }), file, fm, s.speciesFields, "Add fields like habitat or lifespan to the frontmatter.");

		this.renderSections(page, file, sections, s.speciesSections);
		this.renderTables(page, file, fm, s.speciesTables);

		const bottom = page.createDiv({ cls: "ct-city-bottom" });
		this.renderPeople(bottom.createDiv({ cls: "ct-stack-8" }), file, fm, "Notable members", "notable_members");
		this.renderRelated(bottom.createDiv({ cls: "ct-stack-8" }), file);
	}
}
