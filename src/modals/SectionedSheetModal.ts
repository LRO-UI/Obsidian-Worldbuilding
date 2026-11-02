import { App, TFile } from "obsidian";
import type StoryPlugin from "../main";
import { joinSections, NoteSection, splitSections } from "../model";
import { SheetEditorConfig, SheetEditorModal } from "./SheetEditorModal";

/** A sheet editor whose body is an overview plus one box per configured "## " section (species, custom types). */
export abstract class SectionedSheetModal extends SheetEditorModal {
	private intro = "";
	private sections: (NoteSection & { extra: boolean })[] = [];

	constructor(app: App, plugin: StoryPlugin, cfg: SheetEditorConfig, private titles: string[], onCreated?: (f: TFile) => void, file: TFile | null = null) {
		super(app, plugin, cfg, onCreated, file);
		this.splitBody();
	}

	protected onBodyLoaded(): void {
		this.splitBody();
	}

	/** Configured sections in order, then any other "## " sections already in the note. */
	private splitBody(): void {
		const { intro, sections } = splitSections(this.body);
		const lower = this.titles.map((t) => t.toLowerCase());
		this.intro = intro;
		this.sections = [
			...this.titles.map((title) => ({ title, text: sections.find((x) => x.title.toLowerCase() === title.toLowerCase())?.text ?? "", extra: false })),
			...sections.filter((x) => !lower.includes(x.title.toLowerCase())).map((x) => ({ ...x, extra: true })),
		];
	}

	private textarea(sec: HTMLElement, value: string, cls: string, onInput: (v: string) => void): void {
		const ta = sec.createEl("textarea", { cls: `ct-lore-input ${cls}`, text: value });
		ta.addEventListener("input", () => {
			onInput(ta.value);
			this.body = joinSections(this.intro, this.sections);
		});
	}

	protected renderBody(parent: HTMLElement): void {
		const ov = this.section(parent, "Overview", "Shown next to At a glance. Each section below is a \"## \" heading in the note body; empty ones are left out. Markdown and [[links]] work.");
		this.textarea(ov, this.intro, "is-short", (v) => (this.intro = v));
		for (const s of this.sections) {
			const sec = this.section(parent, s.title, s.extra ? "Not in your section list in settings; kept as written." : undefined);
			this.textarea(sec, s.text, "is-compact", (v) => (s.text = v));
		}
	}
}
