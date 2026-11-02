import { MarkdownView, Plugin, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { Calendar } from "./calendar";
import { CanvasSyncRecord, canvasPath, reverseSyncFromCanvas, syncTimelineToCanvas } from "./canvas";
import { isCharacter, isScene } from "./model";
import { CityModal } from "./modals/CityModal";
import { CharacterWizard } from "./modals/CharacterWizard";
import { CustomTypeModal, CustomTypePicker } from "./modals/CustomTypeModal";
import { EventModal } from "./modals/EventModal";
import { FactionModal } from "./modals/FactionModal";
import { SceneModal } from "./modals/SceneModal";
import { SpeciesModal } from "./modals/SpeciesModal";
import { cloneDefaults, CustomType, DescGroupKey, PluginSettings } from "./settings";
import { StorySettingTab } from "./SettingsTab";
import { CharacterView, VIEW_CHARACTER } from "./views/CharacterView";
import { CityView, VIEW_CITY } from "./views/CityView";
import { CustomSheetView, VIEW_CUSTOM } from "./views/CustomSheetView";
import { FactionView, VIEW_FACTION } from "./views/FactionView";
import { GallerySheetView } from "./views/GallerySheetView";
import { ManuscriptView, VIEW_MANUSCRIPT } from "./views/ManuscriptView";
import { RelationshipGraphView, VIEW_RELATIONS } from "./views/RelationshipGraphView";
import { SpeciesView, VIEW_SPECIES } from "./views/SpeciesView";
import { TimelineView, VIEW_TIMELINE } from "./views/TimelineView";

interface SheetInfo {
	view: string;
	icon: string;
	label: string;
}

/** Frontmatter type → the sheet view that renders it. Custom types from settings all use VIEW_CUSTOM. */
const SHEETS: Record<string, SheetInfo> = {
	character: { view: VIEW_CHARACTER, icon: "user-round", label: "character sheet" },
	city: { view: VIEW_CITY, icon: "castle", label: "city sheet" },
	species: { view: VIEW_SPECIES, icon: "paw-print", label: "species sheet" },
	faction: { view: VIEW_FACTION, icon: "flag", label: "faction sheet" },
};

interface StoredData extends Partial<PluginSettings> {
	canvasRecord?: CanvasSyncRecord | null;
}

export default class StoryPlugin extends Plugin {
	settings!: PluginSettings;
	calendar!: Calendar;
	canvasRecord: CanvasSyncRecord | null = null;

	/** Leaves where the user pressed Edit, so we don't bounce them back to the sheet. */
	private editing = new WeakMap<WorkspaceLeaf, string>();
	private sheetActions = new WeakMap<MarkdownView, HTMLElement>();
	private wizardActions = new WeakMap<MarkdownView, HTMLElement>();
	/** Custom types that already have a "Create new …" command. */
	private customCommands = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.calendar = new Calendar(this.settings);

		this.registerView(VIEW_CHARACTER, (leaf) => new CharacterView(leaf, this));
		this.registerView(VIEW_TIMELINE, (leaf) => new TimelineView(leaf, this));
		this.registerView(VIEW_CITY, (leaf) => new CityView(leaf, this));
		this.registerView(VIEW_SPECIES, (leaf) => new SpeciesView(leaf, this));
		this.registerView(VIEW_FACTION, (leaf) => new FactionView(leaf, this));
		this.registerView(VIEW_MANUSCRIPT, (leaf) => new ManuscriptView(leaf, this));
		this.registerView(VIEW_CUSTOM, (leaf) => new CustomSheetView(leaf, this));
		this.registerView(VIEW_RELATIONS, (leaf) => new RelationshipGraphView(leaf, this));

		this.addRibbonIcon("user-round", "Create new character", () => this.openWizard());
		this.addRibbonIcon("castle", "Create new city", () => this.openCityModal());
		this.addRibbonIcon("paw-print", "Create new species", () => this.openSpeciesModal());
		this.addRibbonIcon("flag", "Create new faction", () => this.openFactionModal());
		this.addRibbonIcon("git-commit-horizontal", "Open story timeline", () => this.openTimeline());
		this.addRibbonIcon("book-open-text", "Open manuscript corkboard", () => this.openManuscript());
		this.addRibbonIcon("waypoints", "Open relationship graph", () => this.openRelations());

		this.addCommand({ id: "create-character", name: "Create new character", callback: () => this.openWizard() });
		this.addCommand({
			id: "edit-in-wizard",
			name: "Edit current note in wizard",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.hasEditor(file)) return false;
				if (!checking) this.editInWizard(file);
				return true;
			},
		});
		this.addCommand({ id: "create-city", name: "Create new city", callback: () => this.openCityModal() });
		this.addCommand({ id: "create-species", name: "Create new species", callback: () => this.openSpeciesModal() });
		this.addCommand({ id: "create-faction", name: "Create new faction", callback: () => this.openFactionModal() });
		this.addCommand({
			id: "create-custom",
			name: "Create new note of a custom type",
			checkCallback: (checking) => {
				const types = this.settings.customTypes;
				if (!types.length) return false;
				if (!checking) new CustomTypePicker(this.app, types, (t) => this.openCustomModal(t)).open();
				return true;
			},
		});
		this.syncCustomCommands();
		this.addCommand({ id: "open-timeline", name: "Open story timeline", callback: () => this.openTimeline() });
		this.addCommand({ id: "create-event", name: "Create new timeline event", callback: () => new EventModal(this.app, this).open() });
		this.addCommand({ id: "open-manuscript", name: "Open manuscript corkboard", callback: () => this.openManuscript() });
		this.addCommand({ id: "open-relations", name: "Open relationship graph", callback: () => this.openRelations() });
		this.addCommand({ id: "open-family-tree", name: "Open family tree", callback: () => this.openRelations({ mode: "tree" }) });
		this.addCommand({ id: "create-scene", name: "Create new scene", callback: () => this.openSceneModal() });
		this.addCommand({ id: "sync-canvas", name: "Sync timeline to canvas", callback: () => this.syncCanvas() });
		this.addCommand({
			id: "open-character-sheet",
			name: "Open current note as sheet",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file || !this.sheetFor(view.file)) return false;
				if (!checking) this.showSheet(view.leaf, view.file);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				const sheet = file instanceof TFile ? this.sheetFor(file) : null;
				if (file instanceof TFile && sheet) {
					menu.addItem((i) => i.setTitle(`Open as ${sheet.label}`).setIcon(sheet.icon).onClick(() => this.openSheet(file)));
					menu.addItem((i) => i.setTitle("Edit in wizard").setIcon("wand-sparkles").onClick(() => this.editInWizard(file)));
				}
				if (file instanceof TFile && isCharacter(this.app, file)) {
					menu.addItem((i) =>
						i.setTitle("Show on timeline").setIcon("git-commit-horizontal").onClick(() => this.openTimeline({ focusLane: file.basename }))
					);
					menu.addItem((i) => i.setTitle("Show in relationship graph").setIcon("waypoints").onClick(() => this.openRelations({ focus: file.path })));
				}
				if (file instanceof TFile && isScene(this.app, file)) {
					menu.addItem((i) => i.setTitle("Edit scene details").setIcon("wand-sparkles").onClick(() => this.openSceneModal(file)));
					menu.addItem((i) => i.setTitle("Show on corkboard").setIcon("book-open-text").onClick(() => this.openManuscript({ focus: file.path })));
				}
			})
		);

		this.registerEvent(this.app.workspace.on("file-open", () => this.onFileOpen()));
		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (this.settings.canvasReverseSync && f instanceof TFile && f.path === canvasPath(this)) reverseSyncFromCanvas(this, f);
			})
		);

		this.addSettingTab(new StorySettingTab(this.app, this));
	}

	// ---------- settings ----------

	async loadSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as StoredData;
		const defaults = cloneDefaults();
		const { canvasRecord, ...rest } = data;
		this.settings = { ...defaults, ...rest };
		this.settings.descFields = { ...defaults.descFields, ...(rest.descFields ?? {}) } as Record<DescGroupKey, never>;
		if (!Array.isArray(this.settings.months) || this.settings.months.length !== 12) this.settings.months = defaults.months;
		this.canvasRecord = canvasRecord ?? null;
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ ...this.settings, canvasRecord: this.canvasRecord });
	}

	refreshViews(): void {
		for (const type of [VIEW_CHARACTER, VIEW_CITY, VIEW_SPECIES, VIEW_FACTION, VIEW_CUSTOM, VIEW_TIMELINE, VIEW_MANUSCRIPT]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				const v = leaf.view;
				if (v instanceof TimelineView) {
					v.reload();
					v.render();
				} else if (v instanceof ManuscriptView) v.reload();
				else if (v instanceof CharacterView || v instanceof GallerySheetView) v.render();
			}
		}
	}

	// ---------- character sheet routing ----------

	markEditing(leaf: WorkspaceLeaf, path: string): void {
		this.editing.set(leaf, path);
	}

	private onFileOpen(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const file = view.file;
		const leaf = view.leaf;
		if (this.editing.has(leaf) && this.editing.get(leaf) !== file?.path) this.editing.delete(leaf);

		const sheet = file ? this.sheetFor(file) : null;
		this.updateSheetAction(view, sheet, !!file && isScene(this.app, file));
		if (!file || !sheet || !this.settings.openSheetByDefault) return;
		if (this.editing.get(leaf) === file.path) return;
		this.showSheet(leaf, file);
	}

	private sheetFor(file: TFile): SheetInfo | null {
		if (file.extension !== "md") return null;
		const type = this.app.metadataCache.getFileCache(file)?.frontmatter?.type;
		if (typeof type !== "string") return null;
		if (SHEETS[type]) return SHEETS[type];
		const custom = this.customType(type);
		return custom ? { view: VIEW_CUSTOM, icon: custom.icon || "file-text", label: `${custom.label.toLowerCase()} sheet` } : null;
	}

	/** The custom type from settings with this frontmatter `type`, if any. */
	customType(type: unknown): CustomType | null {
		if (typeof type !== "string" || !type) return null;
		return this.settings.customTypes.find((t) => t.type === type) ?? null;
	}

	/** Adds a "Create new …" command for each custom type that doesn't have one yet. Commands for removed types hide themselves. */
	syncCustomCommands(): void {
		for (const t of this.settings.customTypes) {
			const type = t.type;
			if (!type || this.customCommands.has(type)) continue;
			this.customCommands.add(type);
			this.addCommand({
				id: `create-custom-${type}`,
				name: `Create new ${t.label.toLowerCase()}`,
				checkCallback: (checking) => {
					const def = this.customType(type);
					if (!def) return false;
					if (!checking) this.openCustomModal(def);
					return true;
				},
			});
		}
	}

	/** A header button on the Markdown view to jump back to the sheet. */
	private updateSheetAction(view: MarkdownView, sheet: SheetInfo | null, scene: boolean): void {
		let el = this.sheetActions.get(view);
		if (sheet && !el) {
			el = view.addAction(sheet.icon, `Open ${sheet.label}`, () => {
				if (view.file) this.showSheet(view.leaf, view.file);
			});
			this.sheetActions.set(view, el);
		}
		if (el && sheet) {
			setIcon(el, sheet.icon);
			el.setAttr("aria-label", `Open ${sheet.label}`);
		}
		el?.toggle(!!sheet);

		let wand = this.wizardActions.get(view);
		if ((sheet || scene) && !wand) {
			wand = view.addAction("wand-sparkles", "Edit in wizard", () => {
				if (view.file) this.editInWizard(view.file);
			});
			this.wizardActions.set(view, wand);
		}
		wand?.toggle(!!sheet || scene);
	}

	private async showSheet(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
		const sheet = this.sheetFor(file);
		if (!sheet) return;
		this.editing.delete(leaf);
		await leaf.setViewState({ type: sheet.view, state: { file: file.path }, active: true });
	}

	async openSheet(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await this.showSheet(leaf, file);
		this.app.workspace.revealLeaf(leaf);
	}

	/** New city, or edit `file` in place. */
	openCityModal(file?: TFile): void {
		new CityModal(this.app, this, (f) => this.openSheet(f), file ?? null).open();
	}

	/** New species, or edit `file` in place. */
	openSpeciesModal(file?: TFile): void {
		new SpeciesModal(this.app, this, (f) => this.openSheet(f), file ?? null).open();
	}

	/** New faction, or edit `file` in place. */
	openFactionModal(file?: TFile): void {
		new FactionModal(this.app, this, (f) => this.openSheet(f), file ?? null).open();
	}

	/** New note of a custom type, or edit `file` in place. */
	openCustomModal(def: CustomType, file?: TFile): void {
		new CustomTypeModal(this.app, this, def, (f) => this.openSheet(f), file ?? null).open();
	}

	/** New scene, or edit `file`'s scene details in place. */
	openSceneModal(file?: TFile): void {
		new SceneModal(this.app, this, {}, (f) => this.app.workspace.getLeaf(false).openFile(f), file ?? null).open();
	}

	/** New character, or edit `file` in place. */
	openWizard(file?: TFile): void {
		new CharacterWizard(this.app, this, file ?? null).open();
	}

	private hasEditor(file: TFile): boolean {
		return !!this.sheetFor(file) || isScene(this.app, file);
	}

	/** Opens the right form editor for a character, city, species, faction, scene or custom-type note. Returns false for other notes. */
	editInWizard(file: TFile): boolean {
		const type = this.app.metadataCache.getFileCache(file)?.frontmatter?.type;
		if (type === "character") this.openWizard(file);
		else if (type === "city") this.openCityModal(file);
		else if (type === "species") this.openSpeciesModal(file);
		else if (type === "faction") this.openFactionModal(file);
		else if (type === "scene") this.openSceneModal(file);
		else if (this.customType(type)) this.openCustomModal(this.customType(type)!, file);
		else return false;
		return true;
	}

	// ---------- timeline ----------

	async openTimeline(opts: { focusLane?: string } = {}): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TIMELINE)[0];
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			if (opts.focusLane && existing.view instanceof TimelineView) existing.view.focusLane(opts.focusLane);
			return;
		}
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TIMELINE, active: true, state: opts.focusLane ? { focusLane: opts.focusLane } : {} });
		this.app.workspace.revealLeaf(leaf);
	}

	// ---------- manuscript ----------

	async openManuscript(opts: { focus?: string } = {}): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_MANUSCRIPT)[0];
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			if (opts.focus && existing.view instanceof ManuscriptView) existing.view.focusScene(opts.focus);
			return;
		}
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_MANUSCRIPT, active: true, state: opts.focus ? { focus: opts.focus } : {} });
		this.app.workspace.revealLeaf(leaf);
	}

	// ---------- relationship graph ----------

	async openRelations(opts: { focus?: string; mode?: "web" | "tree" } = {}): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_RELATIONS)[0];
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			if (existing.view instanceof RelationshipGraphView) {
				if (opts.mode) await existing.setViewState({ type: VIEW_RELATIONS, state: { ...existing.view.getState(), mode: opts.mode } });
				if (opts.focus) existing.view.focusNode(opts.focus);
			}
			return;
		}
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_RELATIONS, active: true, state: opts });
		this.app.workspace.revealLeaf(leaf);
	}

	async syncCanvas(): Promise<void> {
		const file = await syncTimelineToCanvas(this);
		if (file) await this.app.workspace.getLeaf("tab").openFile(file);
	}
}
