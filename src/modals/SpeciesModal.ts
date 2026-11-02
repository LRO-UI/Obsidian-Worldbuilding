import { App, TFile } from "obsidian";
import type StoryPlugin from "../main";
import { SectionedSheetModal } from "./SectionedSheetModal";

/** Creates a species, or edits an existing species note in place when given a file. */
export class SpeciesModal extends SectionedSheetModal {
	constructor(app: App, plugin: StoryPlugin, onCreated?: (f: TFile) => void, file: TFile | null = null) {
		const s = plugin.settings;
		super(
			app,
			plugin,
			{
				type: "species",
				noun: "species",
				folder: s.speciesFolder,
				fields: s.speciesFields,
				tables: s.speciesTables,
				linkFields: ["habitat", "range", "origin"],
				namePlaceholder: "Tidekin",
				tagline: { key: "epithet", label: "Epithet", placeholder: "Children of the undertow" },
				people: { key: "notable_members", title: "Notable members", help: "Characters whose notes link to this species are added automatically; list anyone else here." },
			},
			s.speciesSections,
			onCreated,
			file
		);
	}
}
