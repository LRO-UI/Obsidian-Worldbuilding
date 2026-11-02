import { TFile, setIcon } from "obsidian";
import { parseDate } from "../calendar";
import { initials, isCharacter, linkBasename, NoteSection, parseLink } from "../model";
import { CityField, CityTable } from "../settings";
import { button, ImageLightbox, ImagePickerModal, renderInline, renderLinkish, sectionLabel, resolveImage } from "../ui/components";
import { NoteSheetView } from "./NoteSheetView";

const MIN_SLOTS = 3;
const MAX_SLOTS = 5;

export const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

/**
 * Base for sheets with an image gallery, an "At a glance" table, frontmatter tables and a people list
 * (cities, species, factions, custom types).
 */
export abstract class GallerySheetView extends NoteSheetView {
	/** Noun used in labels, e.g. "city". */
	protected abstract readonly noun: string;

	/** Name, tagline (motto, epithet…) and the Edit / Add image buttons. */
	protected renderHeader(page: HTMLElement, file: TFile, fm: Record<string, unknown>, tagline: unknown): void {
		const header = page.createDiv({ cls: "ct-sheet-header" });
		const titles = header.createDiv({ cls: "ct-stack-6" });
		titles.createDiv({ cls: "ct-breadcrumb", text: (file.parent?.path ?? "").split("/").filter(Boolean).join(" / ") || "Vault" });
		titles.createDiv({ cls: "ct-name", text: String(fm.name ?? "") || file.basename });
		if (tagline) titles.createDiv({ cls: "ct-quote", text: `“${String(tagline).replace(/^["“]|["”]$/g, "")}”` });
		const btns = header.createDiv({ cls: "ct-header-btns" });
		this.editButtons(btns);
		button(btns, "Add image", () => this.pickImage());
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

	protected renderGallery(page: HTMLElement, file: TFile, fm: Record<string, unknown>): void {
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
			const rm = slot.createEl("button", { cls: "ct-gallery-remove", attr: { "aria-label": `Remove image from ${this.noun}` } });
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
	protected renderValue(el: HTMLElement, raw: unknown, sourcePath: string): void {
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

	protected renderGlance(col: HTMLElement, file: TFile, fm: Record<string, unknown>, fieldDefs: CityField[], emptyText: string): void {
		sectionLabel(col, "At a glance");
		const props = col.createDiv({ cls: "ct-props" });
		const fields = fieldDefs.filter((f) => fm[f.key] != null && fm[f.key] !== "");
		if (!fields.length) props.createDiv({ cls: "ct-faint ct-13 ct-pad-6", text: emptyText });
		for (const f of fields) {
			const row = props.createDiv({ cls: "ct-prop is-narrow" });
			row.createSpan({ cls: "ct-prop-key", text: f.label });
			this.renderValue(row.createDiv({ cls: "ct-prop-val" }), fm[f.key], file.path);
		}
	}

	protected renderTables(page: HTMLElement, file: TFile, fm: Record<string, unknown>, tables: CityTable[]): void {
		for (const t of tables) this.renderTable(page, file, fm, t.key, t.title, t.columns);
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

	/** "## " sections of the body as cards: configured titles first, in `order`, then any others. */
	protected renderSections(page: HTMLElement, file: TFile, sections: NoteSection[], order: string[]): void {
		const lower = order.map((t) => t.toLowerCase());
		const rank = (title: string) => {
			const i = lower.indexOf(title.toLowerCase());
			return i < 0 ? lower.length : i;
		};
		const filled = sections.filter((x) => x.text).sort((a, b) => rank(a.title) - rank(b.title));
		if (!filled.length) {
			const hint = page.createDiv({ cls: "ct-faint ct-13" });
			hint.setText(order.length ? `No sections yet. Add ${order.slice(0, 3).join(", ")}… with the wand, or as "## " headings in the note.` : `No sections yet. Add "## " headings in the note.`);
			return;
		}
		const cards = page.createDiv({ cls: "ct-species-sections" });
		for (const sec of filled) {
			const card = cards.createDiv({ cls: "ct-species-section ct-stack-8" });
			card.createDiv({ cls: "ct-h16", text: sec.title });
			this.renderMarkdown(card.createDiv({ cls: "ct-body markdown-rendered" }), sec.text, file, "");
		}
	}

	/** Non-character notes that link here: places, factions, chapters, events. */
	protected renderRelated(col: HTMLElement, file: TFile): void {
		const resolved = this.app.metadataCache.resolvedLinks;
		const notes: TFile[] = [];
		for (const src in resolved) {
			if (src === file.path || !resolved[src][file.path]) continue;
			const f = this.app.vault.getAbstractFileByPath(src);
			if (f instanceof TFile && f.extension === "md" && !isCharacter(this.app, f)) notes.push(f);
		}
		notes.sort((a, b) => a.basename.localeCompare(b.basename));
		sectionLabel(col, `Mentioned in · ${notes.length}`);
		if (!notes.length) {
			col.createSpan({ cls: "ct-faint ct-13", text: `Notes that link to [[${file.basename}]] are listed here.` });
			return;
		}
		for (const f of notes) {
			const row = col.createDiv({ cls: "ct-city-event" });
			const type = this.app.metadataCache.getFileCache(f)?.frontmatter?.type;
			row.createSpan({ cls: "ct-dot" }).style.background = "var(--text-muted)";
			renderLinkish(this.app, row, `[[${f.path.replace(/\.md$/, "")}|${f.basename}]]`, file.path, "ct-13");
			row.createSpan({ cls: "ct-mono ct-faint ct-11 ct-city-event-date", text: typeof type === "string" ? type : "" });
		}
	}

	/** Characters whose notes link here, plus anyone listed under `listKey`. */
	protected renderPeople(col: HTMLElement, file: TFile, fm: Record<string, unknown>, title: string, listKey: string): void {
		const people = new Map<string, TFile | null>();
		const resolved = this.app.metadataCache.resolvedLinks;
		for (const src in resolved) {
			if (!resolved[src][file.path]) continue;
			const f = this.app.vault.getAbstractFileByPath(src);
			if (f instanceof TFile && isCharacter(this.app, f)) people.set(f.path, f);
		}
		for (const raw of asList(fm[listKey]).map(String)) {
			const dest = this.app.metadataCache.getFirstLinkpathDest(linkBasename(raw), file.path);
			if (dest) people.set(dest.path, dest);
			else people.set(raw, null);
		}

		sectionLabel(col, `${title} · ${people.size}`);
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
}
