import { App, Modal, Notice, normalizePath, setIcon, stringifyYaml, TFile } from "obsidian";
import { CalDate, parseDate } from "../calendar";
import { pathForName, renameToName, replaceBody, setOrDelete } from "../editing";
import type StoryPlugin from "../main";
import { ensureFolder, joinPath, safeFileName } from "../model";
import { CityField, CityTable } from "../settings";
import { button, ImagePickerModal, NoteSuggest, tagInput } from "../ui/components";

const MAX_IMAGES = 5;
const DATE_KEY = /found|built|date|born|est/i;

type GlanceKind = "text" | "list" | "number" | "date";
interface GlanceValue {
	kind: GlanceKind;
	text: string;
	date: CalDate;
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

/** What differs between the gallery-sheet editors (city, species, faction, custom types). */
export interface SheetEditorConfig {
	/** Frontmatter `type`. */
	type: string;
	/** Lowercase noun for titles and buttons, e.g. "city". */
	noun: string;
	folder: string;
	fields: CityField[];
	tables: CityTable[];
	/** Frontmatter keys that get a note picker. */
	linkFields: string[];
	namePlaceholder: string;
	/** Short line shown in quotes under the name (motto, epithet…), if the type has one. */
	tagline?: { key: string; label: string; placeholder: string };
	people: { key: string; title: string; help: string };
}

/**
 * Creates a note with an image gallery, "At a glance" fields, tables and a people list,
 * or edits an existing one in place when given a file.
 */
export abstract class SheetEditorModal extends Modal {
	protected name = "";
	private tagline = "";
	private images: string[] = [];
	private glance: Record<string, GlanceValue> = {};
	private tables: Record<string, Record<string, unknown>[]> = {};
	private people: string[] = [];
	/** The note body as it will be written. */
	protected body = "";
	private originalBody = "";
	private error = "";
	private footEl!: HTMLElement;

	constructor(app: App, protected plugin: StoryPlugin, protected cfg: SheetEditorConfig, private onCreated?: (f: TFile) => void, protected file: TFile | null = null) {
		super(app);
		for (const f of cfg.fields) {
			this.glance[f.key] = { kind: DATE_KEY.test(f.key) ? "date" : "text", text: "", date: { month: 0, year: NaN } };
		}
		for (const t of cfg.tables) this.tables[t.key] = [];
	}

	/** Edits the note body. Subclasses update `this.body` as the user types. */
	protected abstract renderBody(parent: HTMLElement): void;
	/** Called once the existing note's body has been read into `this.body`. */
	protected onBodyLoaded(): void {}
	/** Reads subclass-owned frontmatter keys from the existing note. */
	protected loadExtra(_fm: Record<string, unknown>): void {}
	/** Editor sections for subclass-owned keys, shown after "At a glance". */
	protected renderExtra(_parent: HTMLElement): void {}
	/** Subclass-owned frontmatter keys as they should be written; empty values are removed. */
	protected buildExtra(): Record<string, unknown> {
		return {};
	}

	private get path(): string {
		if (this.file) return pathForName(this.file, this.name);
		return normalizePath(joinPath(this.cfg.folder, `${safeFileName(this.name) || "<Name>"}.md`));
	}

	private footText(): string {
		if (!this.file) return `Saves to ${this.path}`;
		return this.path === this.file.path ? `Editing ${this.file.path}` : `Saves and renames to ${this.path}`;
	}

	private async load(file: TFile): Promise<void> {
		const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
		this.name = String(fm.name ?? "") || file.basename;
		this.tagline = this.cfg.tagline ? String(fm[this.cfg.tagline.key] ?? "") : "";
		this.images = asList(fm.images ?? fm.image).map(String);
		for (const f of this.cfg.fields) {
			const raw = fm[f.key];
			const g = this.glance[f.key];
			const d = raw && typeof raw === "object" && !Array.isArray(raw) ? parseDate(raw) : null;
			if (d) Object.assign(g, { kind: "date", date: d });
			else if (Array.isArray(raw)) Object.assign(g, { kind: "list", text: raw.map(String).join(", ") });
			else if (typeof raw === "number") Object.assign(g, { kind: "number", text: String(raw) });
			else if (raw != null && raw !== "") Object.assign(g, { kind: "text", text: String(raw) });
		}
		for (const t of this.cfg.tables) {
			// Keep whole row objects so keys outside the configured columns survive a save.
			this.tables[t.key] = asList(fm[t.key]).map((r) => (r && typeof r === "object" && !Array.isArray(r) ? { ...(r as object) } : { [t.columns.split(",")[0].trim()]: r }));
		}
		this.people = asList(fm[this.cfg.people.key]).map(String);
		this.loadExtra(fm);
		const text = await this.app.vault.cachedRead(file);
		const end = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
		this.body = this.originalBody = (end != null ? text.slice(end) : text).trim();
		this.onBodyLoaded();
	}

	async onOpen(): Promise<void> {
		if (this.file) await this.load(this.file);
		this.modalEl.addClass("ct-city-editor-modal");
		this.setTitle(`${this.file ? "Edit" : "New"} ${this.cfg.noun}`);
		this.render();
	}

	protected section(parent: HTMLElement, title: string, help?: string): HTMLElement {
		const sec = parent.createDiv({ cls: "ct-stack-8 ct-editor-section" });
		const head = sec.createDiv({ cls: "ct-stack-2" });
		head.createDiv({ cls: "ct-label", text: title });
		if (help) head.createDiv({ cls: "ct-faint ct-12", text: help });
		return sec;
	}

	protected render(): void {
		const el = this.contentEl;
		const scroll = el.querySelector(".ct-editor-body")?.scrollTop ?? 0;
		el.empty();
		const body = el.createDiv({ cls: "ct-editor-body" });
		const noun = this.cfg.noun;

		// Identity
		const id = this.section(body, noun.charAt(0).toUpperCase() + noun.slice(1));
		const grid = id.createDiv({ cls: "ct-form-grid" });
		const n = grid.createDiv({ cls: "ct-field" });
		n.createEl("label", { text: "Name *" });
		const ni = n.createEl("input", { type: "text", value: this.name, attr: { placeholder: this.cfg.namePlaceholder } });
		ni.addEventListener("input", () => {
			this.name = ni.value;
			this.footEl?.setText(this.footText());
		});
		if (this.error) n.createDiv({ cls: "ct-error", text: this.error });
		if (!this.file) window.setTimeout(() => ni.focus(), 0);
		const tagline = this.cfg.tagline;
		if (tagline) {
			const m = grid.createDiv({ cls: "ct-field" });
			m.createEl("label", { text: tagline.label });
			const mi = m.createEl("input", { type: "text", value: this.tagline, attr: { placeholder: tagline.placeholder } });
			mi.addEventListener("input", () => (this.tagline = mi.value));
		}

		this.renderImages(this.section(body, "Images", `${this.images.length} / ${MAX_IMAGES} · the first one is shown largest`));
		this.renderGlance(this.section(body, "At a glance"));
		this.renderExtra(body);
		for (const t of this.cfg.tables) this.renderTable(this.section(body, t.title), t.key, t.columns);

		const ppl = this.section(body, this.cfg.people.title, this.cfg.people.help);
		tagInput(this.app, ppl, "", this.people, "purple", { suggestNotes: true });
		this.renderBody(body);

		const footer = el.createDiv({ cls: "ct-wizard-foot" });
		this.footEl = footer.createDiv({ cls: "ct-faint ct-12", text: this.footText() });
		const btns = footer.createDiv({ cls: "ct-row-8" });
		button(btns, "Cancel", () => this.close());
		button(btns, this.file ? "Save changes" : `Create ${noun}`, () => this.submit(), "ct-btn mod-cta");
		body.scrollTop = scroll;
	}

	private renderImages(sec: HTMLElement): void {
		const list = sec.createDiv({ cls: "ct-image-list" });
		this.images.forEach((img, i) => {
			const row = list.createDiv({ cls: "ct-image-row" });
			row.createSpan({ cls: "ct-mono ct-faint ct-11", text: String(i + 1) });
			row.createSpan({ cls: "ct-13 ct-image-name", text: img.replace(/^\[\[|\]\]$/g, "") });
			const move = (d: number, icon: string, label: string, disabled: boolean) => {
				const b = row.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": label } });
				setIcon(b, icon);
				b.disabled = disabled;
				b.addEventListener("click", () => {
					[this.images[i], this.images[i + d]] = [this.images[i + d], this.images[i]];
					this.render();
				});
			};
			move(-1, "arrow-up", "Move up", i === 0);
			move(1, "arrow-down", "Move down", i === this.images.length - 1);
			const rm = row.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": "Remove" } });
			setIcon(rm, "x");
			rm.addEventListener("click", () => {
				this.images.splice(i, 1);
				this.render();
			});
		});
		if (this.images.length < MAX_IMAGES) {
			const add = button(sec, "Add image", () =>
				new ImagePickerModal(this.app, (f) => {
					this.images.push(`[[${f.name}]]`);
					this.render();
				}).open()
			);
			add.addClass("ct-self-start");
			setIcon(add.createSpan({ cls: "ct-btn-icon" }), "image-plus");
		}
	}

	private renderGlance(sec: HTMLElement): void {
		const grid = sec.createDiv({ cls: "ct-form-grid" });
		const s = this.plugin.settings;
		for (const f of this.cfg.fields) {
			const g = this.glance[f.key];
			const wrap = grid.createDiv({ cls: "ct-field" });
			wrap.createEl("label", { text: g.kind === "list" ? `${f.label} (comma-separated)` : f.label });
			if (g.kind === "date") {
				const row = wrap.createDiv({ cls: "ct-row-8" });
				const sel = row.createEl("select", { cls: "dropdown" });
				s.months.forEach((mo, i) => sel.createEl("option", { text: mo, value: String(i) }));
				sel.value = String(g.date.month);
				sel.addEventListener("change", () => (g.date.month = Number(sel.value)));
				const yr = row.createEl("input", { type: "number", cls: "ct-year", value: Number.isFinite(g.date.year) ? String(g.date.year) : "", attr: { placeholder: "Year" } });
				yr.addEventListener("input", () => (g.date.year = yr.value === "" ? NaN : Number(yr.value)));
			} else {
				const input = wrap.createEl("input", { type: g.kind === "number" ? "number" : "text", value: g.text });
				input.addEventListener("input", () => (g.text = input.value));
				if (this.cfg.linkFields.includes(f.key)) new NoteSuggest(this.app, input);
			}
		}
	}

	private renderTable(sec: HTMLElement, key: string, columns: string): void {
		const cols = columns.split(",").map((c) => c.trim()).filter(Boolean);
		const rows = this.tables[key];
		const tbl = sec.createDiv({ cls: "ct-edit-table" });
		tbl.style.setProperty("--ct-cols", String(cols.length));
		const head = tbl.createDiv({ cls: "ct-edit-table-row is-head" });
		cols.forEach((c) => head.createSpan({ cls: "ct-faint ct-11", text: c.replace(/_/g, " ") }));
		head.createSpan();
		rows.forEach((r, i) => {
			const row = tbl.createDiv({ cls: "ct-edit-table-row" });
			for (const c of cols) {
				const input = row.createEl("input", { type: "text", value: r[c] == null ? "" : String(r[c]) });
				input.addEventListener("input", () => (r[c] = input.value));
			}
			const rm = row.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": "Remove row" } });
			setIcon(rm, "x");
			rm.addEventListener("click", () => {
				rows.splice(i, 1);
				this.render();
			});
		});
		button(sec, "+ Add row", () => {
			rows.push({});
			this.render();
		}).addClass("ct-self-start");
	}

	/** The frontmatter keys this editor owns, as they should be written. */
	private build(): Record<string, unknown> {
		const out: Record<string, unknown> = { name: this.name.trim(), images: [...this.images] };
		if (this.cfg.tagline) out[this.cfg.tagline.key] = this.tagline.trim();
		for (const f of this.cfg.fields) {
			const g = this.glance[f.key];
			if (g.kind === "date") out[f.key] = Number.isFinite(g.date.year) ? { month: g.date.month, year: g.date.year } : "";
			else if (g.kind === "list") out[f.key] = g.text.split(",").map((x) => x.trim()).filter(Boolean);
			else if (g.kind === "number" && g.text.trim() !== "" && Number.isFinite(Number(g.text))) out[f.key] = Number(g.text);
			else out[f.key] = g.text.trim();
		}
		for (const t of this.cfg.tables) {
			const cols = t.columns.split(",").map((c) => c.trim()).filter(Boolean);
			out[t.key] = this.tables[t.key]
				.map((r) => {
					const row = { ...r };
					for (const c of cols) if (row[c] === "") delete row[c];
					return row;
				})
				.filter((r) => Object.keys(r).length);
		}
		out[this.cfg.people.key] = [...this.people];
		return { ...out, ...this.buildExtra() };
	}

	private async submit(): Promise<void> {
		if (!safeFileName(this.name)) this.error = "A name is required.";
		else if (this.path !== this.file?.path && this.app.vault.getAbstractFileByPath(this.path)) this.error = `${this.path} already exists.`;
		else this.error = "";
		if (this.error) return this.render();

		const next = this.build();
		try {
			if (this.file) {
				const file = this.file;
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					for (const [k, v] of Object.entries(next)) setOrDelete(fm, k, v);
					delete fm.image;
				});
				if (this.body.trim() !== this.originalBody) await replaceBody(this.app, file, this.body);
				const renamed = this.path !== file.path;
				await renameToName(this.app, file, this.name);
				this.close();
				new Notice(renamed ? `Saved and renamed to ${file.basename}.` : `Saved ${file.basename}.`);
				return;
			}
			const fm: Record<string, unknown> = { type: this.cfg.type };
			for (const [k, v] of Object.entries(next)) setOrDelete(fm, k, v);
			// Seed empty "At a glance" keys so they show up in the Properties editor.
			for (const f of this.cfg.fields) if (!(f.key in fm)) fm[f.key] = "";
			await ensureFolder(this.app, this.cfg.folder);
			const created = await this.app.vault.create(this.path, `---\n${stringifyYaml(fm)}---\n\n${this.body.trim()}\n`);
			this.close();
			this.onCreated?.(created);
		} catch (e) {
			console.error(e);
			new Notice(`Couldn't save ${this.cfg.noun}: ${(e as Error).message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
