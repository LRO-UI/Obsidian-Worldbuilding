import { TFile, setIcon } from "obsidian";
import { parseDate } from "../calendar";
import { collectEvents, initials, isCharacter, linkBasename, parseLink } from "../model";
import { button, ImageLightbox, ImagePickerModal, renderInline, renderLinkish, resolveImage, sectionLabel } from "../ui/components";
import { NoteSheetView } from "./NoteSheetView";

export const VIEW_CITY = "city-sheet";

const MIN_SLOTS = 3;
const MAX_SLOTS = 5;

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

export class CityView extends NoteSheetView {
	protected readonly noteType = "city";
	protected readonly fallbackTitle = "City";

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

		const header = page.createDiv({ cls: "ct-sheet-header" });
		const titles = header.createDiv({ cls: "ct-stack-6" });
		titles.createDiv({ cls: "ct-breadcrumb", text: (file.parent?.path ?? "").split("/").filter(Boolean).join(" / ") || "Vault" });
		titles.createDiv({ cls: "ct-name", text: String(fm.name ?? "") || file.basename });
		if (fm.motto) titles.createDiv({ cls: "ct-quote", text: `“${String(fm.motto).replace(/^["“]|["”]$/g, "")}”` });
		const btns = header.createDiv({ cls: "ct-header-btns" });
		this.editButtons(btns);
		button(btns, "Add image", () => this.pickImage());

		this.renderGallery(page, file, fm);

		const grid = page.createDiv({ cls: "ct-city-grid" });
		const desc = grid.createDiv({ cls: "ct-stack-8" });
		desc.createDiv({ cls: "ct-h16", text: "Description" });
		this.renderMarkdown(desc.createDiv({ cls: "ct-body markdown-rendered" }), body, file, "Nothing written yet. Use Edit to describe the city in the note body.");
		this.renderGlance(grid.createDiv({ cls: "ct-stack-8" }), file, fm);

		for (const t of this.plugin.settings.cityTables) this.renderTable(page, file, fm, t.key, t.title, t.columns);

		const bottom = page.createDiv({ cls: "ct-city-bottom" });
		this.renderPeople(bottom.createDiv({ cls: "ct-stack-8" }), file, fm);
		this.renderEvents(bottom.createDiv({ cls: "ct-stack-8" }), file);
	}

	// ---------- gallery ----------

	private images(fm: Record<string, unknown>): string[] {
		return asList(fm.images ?? fm.image).map(String).filter(Boolean);
	}

	private pickImage(): void {
		new ImagePickerModal(this.app, (img) =>
			this.update((fm) => {
				const list = asList(fm.images ?? fm.image).map(String);
				delete fm.image;
				fm.images = [...list, `[[${img.name}]]`];
			})
		).open();
	}

	private removeImage(index: number): Promise<void> {
		return this.update((fm) => {
			const list = asList(fm.images ?? fm.image).map(String);
			list.splice(index, 1);
			delete fm.image;
			fm.images = list;
		});
	}

	private renderGallery(page: HTMLElement, file: TFile, fm: Record<string, unknown>): void {
		const raw = this.images(fm);
		const all = raw.map((r) => ({ raw: r, src: resolveImage(this.app, r, file.path), name: parseLink(r).display }));
		const viewable = all.filter((i) => i.src).map((i) => ({ src: i.src!, name: i.name }));
		const shown = all.slice(0, MAX_SLOTS);
		// Pad to 3 slots, and offer one "add" slot while there's room for more.
		const slots = Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, shown.length + (shown.length < MAX_SLOTS ? 1 : 0)));

		const gallery = page.createDiv({ cls: "ct-gallery" });
		gallery.style.setProperty("--ct-slots", String(slots - 1));
		for (let i = 0; i < slots; i++) {
			const img = shown[i];
			const slot = gallery.createDiv({ cls: `ct-gallery-slot ${i === 0 ? "is-hero" : ""}` });
			if (!img) {
				slot.addClass("is-empty");
				slot.setAttr("aria-label", "Add image");
				setIcon(slot.createSpan({ cls: "ct-gallery-add" }), "image-plus");
				slot.addEventListener("click", () => this.pickImage());
				continue;
			}
			if (img.src) slot.createEl("img", { attr: { src: img.src, alt: img.name, loading: "lazy" } });
			else {
				slot.addClass("is-missing");
				slot.createSpan({ cls: "ct-mono ct-12", text: `missing: ${img.name}` });
			}
			const extra = all.length - MAX_SLOTS;
			if (i === MAX_SLOTS - 1 && extra > 0) slot.createDiv({ cls: "ct-gallery-more", text: `+${extra}` });
			const rm = slot.createEl("button", { cls: "ct-gallery-remove", attr: { "aria-label": "Remove image from city" } });
			setIcon(rm, "x");
			rm.addEventListener("click", (e) => {
				e.stopPropagation();
				this.removeImage(i);
			});
			if (img.src) {
				const at = viewable.findIndex((v) => v.src === img.src);
				slot.addEventListener("click", () => new ImageLightbox(this.app, viewable, Math.max(0, at)).open());
			}
		}
	}

	// ---------- tables ----------

	/** Renders any frontmatter value: lists, calendar dates, numbers, or text with [[links]]. */
	private renderValue(el: HTMLElement, raw: unknown, sourcePath: string): void {
		if (raw == null || raw === "") {
			el.createSpan({ cls: "ct-faint", text: "—" });
			return;
		}
		if (Array.isArray(raw)) {
			raw.forEach((v, i) => {
				if (i) el.appendText(", ");
				this.renderValue(el, v, sourcePath);
			});
			return;
		}
		if (typeof raw === "object") {
			const d = parseDate(raw);
			if (d) {
				const abbr = this.plugin.settings.eraAbbr;
				const years = this.plugin.settings.currentYear - d.year;
				el.appendText(`${this.plugin.calendar.format(d)}${abbr ? " " + abbr : ""}${years > 0 ? ` · ${years} years ago` : ""}`);
			} else el.appendText(JSON.stringify(raw));
			return;
		}
		if (typeof raw === "number") {
			el.appendText(raw.toLocaleString());
			return;
		}
		renderInline(this.app, el, String(raw), sourcePath);
	}

	private renderGlance(col: HTMLElement, file: TFile, fm: Record<string, unknown>): void {
		sectionLabel(col, "At a glance");
		const props = col.createDiv({ cls: "ct-props" });
		const fields = this.plugin.settings.cityFields.filter((f) => fm[f.key] != null && fm[f.key] !== "");
		if (!fields.length) props.createDiv({ cls: "ct-faint ct-13 ct-pad-6", text: "Add fields like region or population to the frontmatter." });
		for (const f of fields) {
			const row = props.createDiv({ cls: "ct-prop is-narrow" });
			row.createSpan({ cls: "ct-prop-key", text: f.label });
			this.renderValue(row.createDiv({ cls: "ct-prop-val" }), fm[f.key], file.path);
		}
	}

	private renderTable(page: HTMLElement, file: TFile, fm: Record<string, unknown>, key: string, title: string, columns: string): void {
		const rows = asList(fm[key]);
		if (!rows.length) return;
		const cols = columns.split(",").map((c) => c.trim()).filter(Boolean);
		const sec = page.createDiv({ cls: "ct-stack-8" });
		const head = sec.createDiv({ cls: "ct-row-8" });
		head.createSpan({ cls: "ct-h16", text: title });
		head.createSpan({ cls: "ct-faint ct-12", text: String(rows.length) });
		const wrap = sec.createDiv({ cls: "ct-table-wrap" });
		const table = wrap.createEl("table", { cls: "ct-table" });
		const tr = table.createEl("thead").createEl("tr");
		for (const c of cols) tr.createEl("th", { text: c.replace(/_/g, " ") });
		const tbody = table.createEl("tbody");
		for (const r of rows) {
			const row = tbody.createEl("tr");
			const obj = (r && typeof r === "object" && !Array.isArray(r) ? r : { [cols[0]]: r }) as Record<string, unknown>;
			cols.forEach((c, i) => this.renderValue(row.createEl("td", { cls: i === 0 ? "is-first" : "" }), obj[c], file.path));
		}
	}

	private renderPeople(col: HTMLElement, file: TFile, fm: Record<string, unknown>): void {
		// Characters whose notes link here, plus anyone listed under notable_people.
		const people = new Map<string, TFile | null>();
		const resolved = this.app.metadataCache.resolvedLinks;
		for (const src in resolved) {
			if (!resolved[src][file.path]) continue;
			const f = this.app.vault.getAbstractFileByPath(src);
			if (f instanceof TFile && isCharacter(this.app, f)) people.set(f.path, f);
		}
		for (const raw of asList(fm.notable_people).map(String)) {
			const dest = this.app.metadataCache.getFirstLinkpathDest(linkBasename(raw), file.path);
			if (dest) people.set(dest.path, dest);
			else people.set(raw, null);
		}

		sectionLabel(col, `Notable people · ${people.size}`);
		if (!people.size) col.createSpan({ cls: "ct-faint ct-13", text: "No characters link here yet." });
		for (const [key, f] of people) {
			const name = f?.basename ?? parseLink(key).display;
			const row = col.createDiv({ cls: "ct-rel" });
			row.createSpan({ cls: "ct-avatar", text: initials(name) });
			const mid = row.createDiv({ cls: "ct-rel-mid" });
			renderLinkish(this.app, mid, f ? `[[${f.path.replace(/\.md$/, "")}|${f.basename}]]` : key, file.path, "ct-rel-name");
			const role = f ? this.app.metadataCache.getFileCache(f)?.frontmatter?.role : null;
			if (role) mid.createSpan({ cls: "ct-rel-kind", text: String(role) });
			row.createSpan();
		}
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
