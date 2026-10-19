import { MarkdownView, Plugin, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { Calendar } from "./calendar";
import { CanvasSyncRecord, canvasPath, reverseSyncFromCanvas, syncTimelineToCanvas } from "./canvas";
import { isCharacter } from "./model";
import { CityModal } from "./modals/CityModal";
import { CharacterWizard } from "./modals/CharacterWizard";
import { EventModal } from "./modals/EventModal";
import { cloneDefaults, DescGroupKey, PluginSettings } from "./settings";
import { StorySettingTab } from "./SettingsTab";
import { CharacterView, VIEW_CHARACTER } from "./views/CharacterView";
import { CityView, VIEW_CITY } from "./views/CityView";
import { TimelineView, VIEW_TIMELINE } from "./views/TimelineView";

/** Frontmatter type → the sheet view that renders it. */
const SHEETS: Record<string, { view: string; icon: string; label: string }> = {
	character: { view: VIEW_CHARACTER, icon: "user-round", label: "character sheet" },
	city: { view: VIEW_CITY, icon: "castle", label: "city sheet" },
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

	async onload(): Promise<void> {
		await this.loadSettings();
		this.calendar = new Calendar(this.settings);

		this.registerView(VIEW_CHARACTER, (leaf) => new CharacterView(leaf, this));
		this.registerView(VIEW_TIMELINE, (leaf) => new TimelineView(leaf, this));
		this.registerView(VIEW_CITY, (leaf) => new CityView(leaf, this));

		this.addRibbonIcon("user-round", "Create new character", () => this.openWizard());
		this.addRibbonIcon("castle", "Create new city", () => this.openCityModal());
		this.addRibbonIcon("git-commit-horizontal", "Open story timeline", () => this.openTimeline());

		this.addCommand({ id: "create-character", name: "Create new character", callback: () => this.openWizard() });
		this.addCommand({
			id: "edit-in-wizard",
			name: "Edit current note in wizard",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.sheetFor(file)) return false;
				if (!checking) this.editInWizard(file);
				return true;
			},
		});
		this.addCommand({ id: "create-city", name: "Create new city", callback: () => this.openCityModal() });
		this.addCommand({ id: "open-timeline", name: "Open story timeline", callback: () => this.openTimeline() });
		this.addCommand({ id: "create-event", name: "Create new timeline event", callback: () => new EventModal(this.app, this).open() });
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
		for (const type of [VIEW_CHARACTER, VIEW_CITY, VIEW_TIMELINE]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				const v = leaf.view;
				if (v instanceof TimelineView) {
					v.reload();
					v.render();
				} else if (v instanceof CharacterView || v instanceof CityView) v.render();
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
		this.updateSheetAction(view, sheet);
		if (!file || !sheet || !this.settings.openSheetByDefault) return;
		if (this.editing.get(leaf) === file.path) return;
		this.showSheet(leaf, file);
	}

	private sheetFor(file: TFile): (typeof SHEETS)[string] | null {
		if (file.extension !== "md") return null;
		const type = this.app.metadataCache.getFileCache(file)?.frontmatter?.type;
		return typeof type === "string" ? SHEETS[type] ?? null : null;
	}

	/** A header button on the Markdown view to jump back to the sheet. */
	private updateSheetAction(view: MarkdownView, sheet: (typeof SHEETS)[string] | null): void {
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
		if (sheet && !wand) {
			wand = view.addAction("wand-sparkles", "Edit in wizard", () => {
				if (view.file) this.editInWizard(view.file);
			});
			this.wizardActions.set(view, wand);
		}
		wand?.toggle(!!sheet);
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

	/** New character, or edit `file` in place. */
	openWizard(file?: TFile): void {
		new CharacterWizard(this.app, this, file ?? null).open();
	}

	/** Opens the right form editor for a character or city note. Returns false for other notes. */
	editInWizard(file: TFile): boolean {
		const type = this.app.metadataCache.getFileCache(file)?.frontmatter?.type;
		if (type === "character") this.openWizard(file);
		else if (type === "city") this.openCityModal(file);
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

	async syncCanvas(): Promise<void> {
		const file = await syncTimelineToCanvas(this);
		if (file) await this.app.workspace.getLeaf("tab").openFile(file);
	}
}
