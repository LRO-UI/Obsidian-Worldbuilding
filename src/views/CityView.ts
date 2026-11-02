import { TFile, setIcon } from "obsidian";
import { collectEvents, parseLink } from "../model";
import { button, renderLinkish, sectionLabel } from "../ui/components";
import { GallerySheetView } from "./GallerySheetView";

export const VIEW_CITY = "city-sheet";

export class CityView extends GallerySheetView {
	protected readonly noteType = "city";
	protected readonly fallbackTitle = "City";
	protected readonly noun = "city";

	getViewType(): string {
		return VIEW_CITY;
	}
	getIcon(): string {
		return "castle";
	}

	protected openEditor(): void {
		if (this.file) this.plugin.openCityModal(this.file);
	}

	protected renderEmpty(root: HTMLElement): void {
		const box = root.createDiv({ cls: "ct-empty" });
		setIcon(box.createDiv({ cls: "ct-empty-icon" }), "castle");
		box.createDiv({ cls: "ct-empty-title", text: this.file ? "This note isn't a city" : "No city selected" });
		box.createDiv({ cls: "ct-empty-text", text: "City notes have type: city in their frontmatter." });
		button(box, "Create new city", () => this.plugin.openCityModal(), "ct-btn mod-cta");
	}

	protected renderSheet(root: HTMLElement, file: TFile, fm: Record<string, unknown>, body: string): void {
		const page = root.createDiv({ cls: "ct-sheet ct-city" });
		this.renderHeader(page, file, fm, fm.motto);
		this.renderGallery(page, file, fm);

		const grid = page.createDiv({ cls: "ct-city-grid" });
		const desc = grid.createDiv({ cls: "ct-stack-8" });
		desc.createDiv({ cls: "ct-h16", text: "Description" });
		this.renderMarkdown(desc.createDiv({ cls: "ct-body markdown-rendered" }), body, file, "Nothing written yet. Use Edit to describe the city in the note body.");
		this.renderGlance(grid.createDiv({ cls: "ct-stack-8" }), file, fm, this.plugin.settings.cityFields, "Add fields like region or population to the frontmatter.");

		this.renderTables(page, file, fm, this.plugin.settings.cityTables);

		const bottom = page.createDiv({ cls: "ct-city-bottom" });
		this.renderPeople(bottom.createDiv({ cls: "ct-stack-8" }), file, fm, "Notable people", "notable_people");
		this.renderEvents(bottom.createDiv({ cls: "ct-stack-8" }), file);
	}

	private renderEvents(col: HTMLElement, file: TFile): void {
		const events = collectEvents(this.app)
			.filter((e) => {
				const t = parseLink(e.location).target;
				return t && this.app.metadataCache.getFirstLinkpathDest(t, e.path) === file;
			})
			.sort((a, b) => a.start - b.start);
		sectionLabel(col, `Events here · ${events.length}`);
		if (!events.length) {
			col.createSpan({ cls: "ct-faint ct-13", text: "Give event notes location: \"[[" + file.basename + "]]\" to list them here." });
			return;
		}
		const cats = this.plugin.settings.categories;
		for (const e of events) {
			const row = col.createDiv({ cls: "ct-city-event" });
			const cat = cats.find((c) => c.key === e.category);
			row.createSpan({ cls: "ct-dot" }).style.background = cat ? `var(--color-${cat.color})` : "var(--text-muted)";
			renderLinkish(this.app, row, `[[${e.path.replace(/\.md$/, "")}|${e.title}]]`, file.path, "ct-13");
			row.createSpan({ cls: "ct-mono ct-faint ct-11 ct-city-event-date", text: this.plugin.calendar.shortRange(e.start, e.end) });
		}
	}
}
