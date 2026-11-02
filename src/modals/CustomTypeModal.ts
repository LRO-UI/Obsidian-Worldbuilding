import { App, FuzzySuggestModal, TFile } from "obsidian";
import type StoryPlugin from "../main";
import { CustomType } from "../settings";
import { SectionedSheetModal } from "./SectionedSheetModal";

const humanize = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Picks which custom type to create. */
export class CustomTypePicker extends FuzzySuggestModal<CustomType> {
	constructor(app: App, private types: CustomType[], private onPick: (t: CustomType) => void) {
		super(app);
		this.setPlaceholder("Create a new…");
	}
	getItems(): CustomType[] {
		return this.types;
	}
	getItemText(t: CustomType): string {
		return t.label;
	}
	onChooseItem(t: CustomType): void {
		this.onPick(t);
	}
}

/** Creates a note of a user-defined type, or edits an existing one in place when given a file. */
export class CustomTypeModal extends SectionedSheetModal {
	constructor(app: App, plugin: StoryPlugin, def: CustomType, onCreated?: (f: TFile) => void, file: TFile | null = null) {
		const noun = def.label.toLowerCase();
		super(
			app,
			plugin,
			{
				type: def.type,
				noun,
				folder: def.folder,
				fields: def.fields,
				tables: def.tables,
				linkFields: [],
				namePlaceholder: `Name of the ${noun}`,
				tagline: def.tagline ? { key: def.tagline, label: humanize(def.tagline), placeholder: "" } : undefined,
				people: { key: "notable_people", title: "Notable people", help: `Characters whose notes link to this ${noun} are added automatically; list anyone else here.` },
			},
			def.sections,
			onCreated,
			file
		);
	}
}
