import { App, Modal, Notice, normalizePath, stringifyYaml, TFile } from "obsidian";
import { pathForName, renameToName, setOrDelete } from "../editing";
import type StoryPlugin from "../main";
import { collectScenes, ensureFolder, isCharacter, joinPath, parseScene, SCENE_STATUSES, SceneStatus, safeFileName } from "../model";
import { button, NoteSuggest } from "../ui/components";

export interface ScenePrefill {
	chapter?: number | null;
}

/** Creates a scene, or edits an existing scene's details in place when given a file. The prose is left alone. */
export class SceneModal extends Modal {
	private title = "";
	private chapter = "";
	private order = "";
	private status: SceneStatus = "draft";
	private pov = "";
	private location = "";
	private event = "";
	private summary = "";
	private error = "";
	private footEl!: HTMLElement;

	constructor(app: App, private plugin: StoryPlugin, prefill: ScenePrefill = {}, private onCreated?: (f: TFile) => void, private file: TFile | null = null) {
		super(app);
		if (file) {
			const sc = parseScene(file, (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>);
			this.title = file.basename;
			this.chapter = sc.chapter == null ? "" : String(sc.chapter);
			this.order = sc.order ? String(sc.order) : "";
			Object.assign(this, { status: sc.status, pov: sc.pov, location: sc.location, event: sc.event, summary: sc.summary });
		} else {
			const scenes = collectScenes(app);
			const ch = prefill.chapter !== undefined ? prefill.chapter : scenes.filter((s) => s.chapter != null).pop()?.chapter ?? 1;
			this.chapter = ch == null ? "" : String(ch);
			const inChapter = scenes.filter((s) => s.chapter === ch);
			this.order = String(Math.max(0, ...inChapter.map((s) => s.order)) + 1);
		}
	}

	private get path(): string {
		if (this.file) return pathForName(this.file, this.title);
		return normalizePath(joinPath(this.plugin.settings.manuscriptFolder, `${safeFileName(this.title) || "<Title>"}.md`));
	}

	private footText(): string {
		if (!this.file) return `Saves to ${this.path}`;
		return this.path === this.file.path ? `Editing ${this.file.path}` : `Saves and renames to ${this.path}`;
	}

	onOpen(): void {
		this.modalEl.addClass("ct-event-modal");
		this.setTitle(this.file ? "Edit scene" : "New scene");
		this.render();
	}

	private text(grid: HTMLElement, label: string, value: string, placeholder: string, set: (v: string) => void, full = false, type = "text"): HTMLInputElement {
		const f = grid.createDiv({ cls: `ct-field ${full ? "is-full" : ""}` });
		f.createEl("label", { text: label });
		const input = f.createEl("input", { type, value, attr: { placeholder } });
		input.addEventListener("input", () => set(input.value));
		return input;
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const grid = el.createDiv({ cls: "ct-form-grid" });
		const typeOf = (f: TFile) => this.app.metadataCache.getFileCache(f)?.frontmatter?.type;

		const ti = this.text(grid, "Title *", this.title, "The drowned bell", (v) => {
			this.title = v;
			this.footEl?.setText(this.footText());
		}, true);
		if (this.error) ti.parentElement!.createDiv({ cls: "ct-error", text: this.error });
		if (!this.file) window.setTimeout(() => ti.focus(), 0);

		this.text(grid, "Chapter", this.chapter, "1", (v) => (this.chapter = v), false, "number");
		this.text(grid, "Order in chapter", this.order, "1", (v) => (this.order = v), false, "number");

		const st = grid.createDiv({ cls: "ct-field" });
		st.createEl("label", { text: "Status" });
		const sel = st.createEl("select", { cls: "dropdown" });
		for (const s of SCENE_STATUSES) sel.createEl("option", { text: s.charAt(0).toUpperCase() + s.slice(1), value: s });
		sel.value = this.status;
		sel.addEventListener("change", () => (this.status = sel.value as SceneStatus));

		const pi = this.text(grid, "POV character", this.pov, "[[Maren Voss]]", (v) => (this.pov = v));
		new NoteSuggest(this.app, pi, undefined, (f) => isCharacter(this.app, f));
		const li = this.text(grid, "Location", this.location, "[[Kesthaven]]", (v) => (this.location = v));
		new NoteSuggest(this.app, li, undefined, (f) => ["city", "region"].includes(typeOf(f)));
		const ei = this.text(grid, "Timeline event", this.event, "[[Fall of Kesthaven]]", (v) => (this.event = v));
		new NoteSuggest(this.app, ei, undefined, (f) => typeOf(f) === "event");

		const sm = grid.createDiv({ cls: "ct-field is-full" });
		sm.createEl("label", { text: "Summary (shown on the corkboard card)" });
		const ta = sm.createEl("textarea", { text: this.summary, attr: { rows: 3, placeholder: "What happens, and what changes." } });
		ta.addEventListener("input", () => (this.summary = ta.value));

		const foot = el.createDiv({ cls: "ct-wizard-foot" });
		this.footEl = foot.createDiv({ cls: "ct-faint ct-12", text: this.footText() });
		const btns = foot.createDiv({ cls: "ct-row-8" });
		button(btns, "Cancel", () => this.close());
		button(btns, this.file ? "Save changes" : "Create scene", () => this.submit(), "ct-btn mod-cta");
	}

	/** The frontmatter keys this editor owns. */
	private build(): Record<string, unknown> {
		const num = (v: string) => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : "");
		return {
			chapter: num(this.chapter),
			order: num(this.order),
			status: this.status,
			pov: this.pov.trim(),
			location: this.location.trim(),
			event: this.event.trim(),
			summary: this.summary.trim(),
		};
	}

	private async submit(): Promise<void> {
		if (!safeFileName(this.title)) this.error = "A title is required.";
		else if (this.path !== this.file?.path && this.app.vault.getAbstractFileByPath(this.path)) this.error = `${this.path} already exists.`;
		else this.error = "";
		if (this.error) return this.render();

		const next = this.build();
		try {
			if (this.file) {
				const file = this.file;
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					for (const [k, v] of Object.entries(next)) setOrDelete(fm, k, v);
					delete fm.title; // the file name is the title
				});
				const renamed = this.path !== file.path;
				await renameToName(this.app, file, this.title);
				this.close();
				new Notice(renamed ? `Saved and renamed to ${file.basename}.` : `Saved ${file.basename}.`);
				return;
			}
			const fm: Record<string, unknown> = { type: "scene" };
			for (const [k, v] of Object.entries(next)) setOrDelete(fm, k, v);
			await ensureFolder(this.app, this.plugin.settings.manuscriptFolder);
			const created = await this.app.vault.create(this.path, `---\n${stringifyYaml(fm)}---\n\n`);
			this.close();
			this.onCreated?.(created);
		} catch (e) {
			console.error(e);
			new Notice(`Couldn't save scene: ${(e as Error).message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
