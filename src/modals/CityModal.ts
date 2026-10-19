import { App, Modal, Notice, normalizePath, setIcon, stringifyYaml, TFile } from "obsidian";
import { CalDate, parseDate } from "../calendar";
import { pathForName, renameToName, replaceBody, setOrDelete } from "../editing";
import type StoryPlugin from "../main";
import { ensureFolder, joinPath, safeFileName } from "../model";
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

/** Creates a city, or edits an existing city note in place when given a file. */
export class CityModal extends Modal {
	private name = "";
	private motto = "";
	private images: string[] = [];
	private glance: Record<string, GlanceValue> = {};
	private tables: Record<string, Record<string, unknown>[]> = {};
	private people: string[] = [];
	private body = "";
	private originalBody = "";
	private error = "";
	private footEl!: HTMLElement;

	constructor(app: App, private plugin: StoryPlugin, private onCreated?: (f: TFile) => void, private file: TFile | null = null) {
		super(app);
		for (const f of plugin.settings.cityFields) {
			this.glance[f.key] = { kind: DATE_KEY.test(f.key) ? "date" : "text", text: "", date: { month: 0, year: NaN } };
		}
		for (const t of plugin.settings.cityTables) this.tables[t.key] = [];
	}

	private get path(): string {
		if (this.file) return pathForName(this.file, this.name);
		return normalizePath(joinPath(this.plugin.settings.citiesFolder, `${safeFileName(this.name) || "<Name>"}.md`));
	}

	private footText(): string {
		if (!this.file) return `Saves to ${this.path}`;
		return this.path === this.file.path ? `Editing ${this.file.path}` : `Saves and renames to ${this.path}`;
	}

	private async load(file: TFile): Promise<void> {
		const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
		this.name = String(fm.name ?? "") || file.basename;
		this.motto = String(fm.motto ?? "");
		this.images = asList(fm.images ?? fm.image).map(String);
		for (const f of this.plugin.settings.cityFields) {
			const raw = fm[f.key];
			const g = this.glance[f.key];
			const d = raw && typeof raw === "object" && !Array.isArray(raw) ? parseDate(raw) : null;
			if (d) Object.assign(g, { kind: "date", date: d });
			else if (Array.isArray(raw)) Object.assign(g, { kind: "list", text: raw.map(String).join(", ") });
			else if (typeof raw === "number") Object.assign(g, { kind: "number", text: String(raw) });
			else if (raw != null && raw !== "") Object.assign(g, { kind: "text", text: String(raw) });
		}
		for (const t of this.plugin.settings.cityTables) {
			// Keep whole row objects so keys outside the configured columns survive a save.
			this.tables[t.key] = asList(fm[t.key]).map((r) => (r && typeof r === "object" && !Array.isArray(r) ? { ...(r as object) } : { [t.columns.split(",")[0].trim()]: r }));
		}
		this.people = asList(fm.notable_people).map(String);
		const text = await this.app.vault.cachedRead(file);
		const end = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
		this.body = this.originalBody = (end != null ? text.slice(end) : text).trim();
	}

	async onOpen(): Promise<void> {
		if (this.file) await this.load(this.file);
		this.modalEl.addClass("ct-city-editor-modal");
		this.setTitle(this.file ? "Edit city" : "New city");
		this.render();
	}

	private section(parent: HTMLElement, title: string, help?: string): HTMLElement {
		const sec = parent.createDiv({ cls: "ct-stack-8 ct-editor-section" });
		const head = sec.createDiv({ cls: "ct-stack-2" });
		head.createDiv({ cls: "ct-label", text: title });
		if (help) head.createDiv({ cls: "ct-faint ct-12", text: help });
		return sec;
	}

	private render(): void {
		const el = this.contentEl;
		const scroll = el.querySelector(".ct-editor-body")?.scrollTop ?? 0;
		el.empty();
		const body = el.createDiv({ cls: "ct-editor-body" });

		// Identity
		const id = this.section(body, "City");
		const grid = id.createDiv({ cls: "ct-form-grid" });
		const n = grid.createDiv({ cls: "ct-field" });
		n.createEl("label", { text: "Name *" });
		const ni = n.createEl("input", { type: "text", value: this.name, attr: { placeholder: "Kesthaven" } });
		ni.addEventListener("input", () => {
			this.name = ni.value;
			this.footEl?.setText(this.footText());
		});
		if (this.error) n.createDiv({ cls: "ct-error", text: this.error });
		if (!this.file) window.setTimeout(() => ni.focus(), 0);
		const m = grid.createDiv({ cls: "ct-field" });
		m.createEl("label", { text: "Motto" });
		const mi = m.createEl("input", { type: "text", value: this.motto, attr: { placeholder: "The tide keeps no ledger" } });
		mi.addEventListener("input", () => (this.motto = mi.value));

		this.renderImages(this.section(body, "Images", `${this.images.length} / ${MAX_IMAGES} · the first one is shown largest`));
		this.renderGlance(this.section(body, "At a glance"));
		for (const t of this.plugin.settings.cityTables) this.renderTable(this.section(body, t.title), t.key, t.columns);

		const ppl = this.section(body, "Notable people", "Characters whose notes link to this city are added automatically; list anyone else here.");
		tagInput(this.app, ppl, "", this.people, "purple", { suggestNotes: true });

		const desc = this.section(body, "Description", "The note body. Markdown and [[links]] work.");
		const ta = desc.createEl("textarea", { cls: "ct-lore-input is-short", text: this.body });
		ta.addEventListener("input", () => (this.body = ta.value));

		const footer = el.createDiv({ cls: "ct-wizard-foot" });
		this.footEl = footer.createDiv({ cls: "ct-faint ct-12", text: this.footText() });
		const btns = footer.createDiv({ cls: "ct-row-8" });
		button(btns, "Cancel", () => this.close());
		button(btns, this.file ? "Save changes" : "Create city", () => this.submit(), "ct-btn mod-cta");
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
		for (const f of s.cityFields) {
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
				if (f.key === "region" || f.key === "ruler") new NoteSuggest(this.app, input);
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
		const out: Record<string, unknown> = { name: this.name.trim(), motto: this.motto.trim(), images: [...this.images] };
		for (const f of this.plugin.settings.cityFields) {
			const g = this.glance[f.key];
			if (g.kind === "date") out[f.key] = Number.isFinite(g.date.year) ? { month: g.date.month, year: g.date.year } : "";
			else if (g.kind === "list") out[f.key] = g.text.split(",").map((x) => x.trim()).filter(Boolean);
			else if (g.kind === "number" && g.text.trim() !== "" && Number.isFinite(Number(g.text))) out[f.key] = Number(g.text);
			else out[f.key] = g.text.trim();
		}
		for (const t of this.plugin.settings.cityTables) {
			const cols = t.columns.split(",").map((c) => c.trim()).filter(Boolean);
			out[t.key] = this.tables[t.key]
				.map((r) => {
					const row = { ...r };
					for (const c of cols) if (row[c] === "") delete row[c];
					return row;
				})
				.filter((r) => Object.keys(r).length);
		}
		out.notable_people = [...this.people];
		return out;
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
			const fm: Record<string, unknown> = { type: "city" };
			for (const [k, v] of Object.entries(next)) setOrDelete(fm, k, v);
			// Seed empty "At a glance" keys so they show up in the Properties editor.
			for (const f of this.plugin.settings.cityFields) if (!(f.key in fm)) fm[f.key] = "";
			await ensureFolder(this.app, this.plugin.settings.citiesFolder);
			const created = await this.app.vault.create(this.path, `---\n${stringifyYaml(fm)}---\n\n${this.body.trim()}\n`);
			this.close();
			this.onCreated?.(created);
		} catch (e) {
			console.error(e);
			new Notice(`Couldn't save city: ${(e as Error).message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
