import { App, TFile } from "obsidian";
import type StoryPlugin from "../main";
import { SheetEditorModal } from "./SheetEditorModal";

/** Creates a city, or edits an existing city note in place when given a file. */
export class CityModal extends SheetEditorModal {
	constructor(app: App, plugin: StoryPlugin, onCreated?: (f: TFile) => void, file: TFile | null = null) {
		const s = plugin.settings;
		super(
			app,
			plugin,
			{
				type: "city",
				noun: "city",
				folder: s.citiesFolder,
				fields: s.cityFields,
				tables: s.cityTables,
				linkFields: ["region", "ruler"],
				namePlaceholder: "Kesthaven",
				tagline: { key: "motto", label: "Motto", placeholder: "The tide keeps no ledger" },
				people: { key: "notable_people", title: "Notable people", help: "Characters whose notes link to this city are added automatically; list anyone else here." },
			},
			onCreated,
			file
		);
	}

	protected renderBody(parent: HTMLElement): void {
		const desc = this.section(parent, "Description", "The note body. Markdown and [[links]] work.");
		const ta = desc.createEl("textarea", { cls: "ct-lore-input is-short", text: this.body });
		ta.addEventListener("input", () => (this.body = ta.value));
	}
}
