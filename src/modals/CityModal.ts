import { App, Modal, Notice, normalizePath, setIcon, stringifyYaml, TFile } from "obsidian";
import type StoryPlugin from "../main";
import { ensureFolder, joinPath, safeFileName } from "../model";
import { button, ImagePickerModal, NoteSuggest } from "../ui/components";

const MAX_IMAGES = 5;

export class CityModal extends Modal {
	private name = "";
	private motto = "";
	private region = "";
	private images: string[] = [];
	private error = "";

	constructor(app: App, private plugin: StoryPlugin, private onCreated?: (f: TFile) => void) {
		super(app);
	}

	private get path(): string {
		return normalizePath(joinPath(this.plugin.settings.citiesFolder, `${safeFileName(this.name) || "<Name>"}.md`));
	}

	onOpen(): void {
		this.modalEl.addClass("ct-event-modal");
		this.setTitle("New city");
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const grid = el.createDiv({ cls: "ct-form-grid" });

		const n = grid.createDiv({ cls: "ct-field is-full" });
		n.createEl("label", { text: "Name *" });
		const ni = n.createEl("input", { type: "text", value: this.name, attr: { placeholder: "Kesthaven" } });
		ni.addEventListener("input", () => {
			this.name = ni.value;
			foot.setText(`Saves to ${this.path}`);
		});
		if (this.error) n.createDiv({ cls: "ct-error", text: this.error });
		window.setTimeout(() => ni.focus(), 0);

		const m = grid.createDiv({ cls: "ct-field" });
		m.createEl("label", { text: "Motto" });
		const mi = m.createEl("input", { type: "text", value: this.motto, attr: { placeholder: "The tide keeps no ledger" } });
		mi.addEventListener("input", () => (this.motto = mi.value));

		const r = grid.createDiv({ cls: "ct-field" });
		r.createEl("label", { text: "Region" });
		const ri = r.createEl("input", { type: "text", value: this.region, attr: { placeholder: "[[Saltreach]]" } });
		ri.addEventListener("input", () => (this.region = ri.value));
		new NoteSuggest(this.app, ri);

		const im = grid.createDiv({ cls: "ct-field is-full" });
		im.createEl("label", { text: `Images (${this.images.length} / ${MAX_IMAGES}; 3–5 recommended)` });
		const list = im.createDiv({ cls: "ct-pills" });
		this.images.forEach((img, i) => {
			const p = list.createSpan({ cls: "ct-pill", text: img.replace(/^\[\[|\]\]$/g, "") });
			const x = p.createSpan({ cls: "ct-pill-x", text: "×", attr: { "aria-label": "Remove" } });
			x.addEventListener("click", () => {
				this.images.splice(i, 1);
				this.render();
			});
		});
		if (this.images.length < MAX_IMAGES) {
			const add = button(list, "Add image", () =>
				new ImagePickerModal(this.app, (f) => {
					this.images.push(`[[${f.name}]]`);
					this.render();
				}).open()
			);
			setIcon(add.createSpan({ cls: "ct-btn-icon" }), "image-plus");
		}

		const footer = el.createDiv({ cls: "ct-wizard-foot" });
		const foot = footer.createDiv({ cls: "ct-faint ct-12", text: `Saves to ${this.path}` });
		const btns = footer.createDiv({ cls: "ct-row-8" });
		button(btns, "Cancel", () => this.close());
		button(btns, "Create city", () => this.create(), "ct-btn mod-cta");
	}

	private async create(): Promise<void> {
		if (!safeFileName(this.name)) this.error = "A name is required.";
		else if (this.app.vault.getAbstractFileByPath(this.path)) this.error = `${this.path} already exists.`;
		else this.error = "";
		if (this.error) return this.render();

		const fm: Record<string, unknown> = { type: "city", name: this.name.trim() };
		if (this.motto.trim()) fm.motto = this.motto.trim();
		if (this.images.length) fm.images = this.images;
		// Seed the configured "At a glance" fields so they show up in the Properties editor.
		for (const f of this.plugin.settings.cityFields) fm[f.key] = f.key === "region" ? this.region.trim() : "";
		try {
			await ensureFolder(this.app, this.plugin.settings.citiesFolder);
			const file = await this.app.vault.create(this.path, `---\n${stringifyYaml(fm)}---\n\n`);
			this.close();
			this.onCreated?.(file);
		} catch (e) {
			new Notice(`Couldn't create city: ${(e as Error).message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
