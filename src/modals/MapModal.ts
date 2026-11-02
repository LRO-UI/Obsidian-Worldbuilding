import { App, Modal, normalizePath, Notice, stringifyYaml, TFile } from "obsidian";
import { renameToName } from "../editing";
import type StoryPlugin from "../main";
import { ensureFolder, joinPath, parseLink, safeFileName } from "../model";
import { button, ImagePickerModal } from "../ui/components";

/** Creates a map, or renames an existing one and changes its image. */
export class MapModal extends Modal {
	private name = "";
	private image: TFile | null = null;
	private error = "";

	constructor(app: App, private plugin: StoryPlugin, private file: TFile | null, image: TFile | null, private onDone?: (f: TFile) => void) {
		super(app);
		this.image = image;
		if (file) {
			const fm = app.metadataCache.getFileCache(file)?.frontmatter;
			this.name = String(fm?.name ?? file.basename);
			const { target, display } = parseLink(String(fm?.image ?? ""));
			this.image = app.metadataCache.getFirstLinkpathDest(target ?? display, file.path);
		} else if (image) {
			this.name = image.basename;
		}
	}

	onOpen(): void {
		this.modalEl.addClass("ct-event-modal");
		this.setTitle(this.file ? "Edit map" : "New map");
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const grid = el.createDiv({ cls: "ct-form-grid" });

		const n = grid.createDiv({ cls: "ct-field is-full" });
		n.createEl("label", { text: "Name *" });
		const ni = n.createEl("input", { type: "text", value: this.name, attr: { placeholder: "The Saltreach" } });
		ni.addEventListener("input", () => (this.name = ni.value));
		window.setTimeout(() => ni.focus(), 0);

		const img = grid.createDiv({ cls: "ct-field is-full" });
		img.createEl("label", { text: "Image *" });
		img.createDiv({ cls: this.image ? "ct-13" : "ct-faint ct-13", text: this.image?.path ?? "No image chosen" });
		const row = img.createDiv({ cls: "ct-row-8" });
		button(row, "Choose from vault", () =>
			new ImagePickerModal(this.app, (f) => {
				this.image = f;
				this.name = this.name || f.basename;
				this.render();
			}, "Pick a map image from the vault").open()
		);
		button(row, "Import from computer", () => this.importImage());
		if (this.error) grid.createDiv({ cls: "ct-field is-full ct-error", text: this.error });

		const foot = el.createDiv({ cls: "ct-wizard-foot" });
		foot.createDiv({ cls: "ct-faint ct-12", text: this.file ? "Pins and borders stay in place when the image changes." : `Saves to ${this.plugin.settings.mapsFolder || "/"}` });
		const btns = foot.createDiv({ cls: "ct-row-8" });
		button(btns, "Cancel", () => this.close());
		button(btns, this.file ? "Save" : "Create map", () => this.save(), "ct-btn mod-cta");
	}

	/** Copies an image into the vault, where Obsidian's attachment setting says it goes. */
	private importImage(): void {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.addEventListener("change", async () => {
			const picked = input.files?.[0];
			if (!picked) return;
			try {
				const path = await this.app.fileManager.getAvailablePathForAttachment(picked.name, this.file?.path ?? "");
				this.image = await this.app.vault.createBinary(path, await picked.arrayBuffer());
				this.name = this.name || this.image.basename;
				this.render();
			} catch (err) {
				new Notice(`Couldn't import the image: ${(err as Error).message}`);
			}
		});
		input.click();
	}

	private async save(): Promise<void> {
		const name = this.name.trim();
		const base = safeFileName(name);
		const path = normalizePath(joinPath(this.plugin.settings.mapsFolder, `${base}.md`));
		if (!base) this.error = "A name is required.";
		else if (!this.image) this.error = "Choose an image for the map.";
		else if (!this.file && this.app.vault.getAbstractFileByPath(path)) this.error = `${path} already exists.`;
		else this.error = "";
		if (this.error) return this.render();

		const source = this.file?.path ?? path;
		const image = `[[${this.app.metadataCache.fileToLinktext(this.image!, source, false)}]]`;
		try {
			let file = this.file;
			if (file) {
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					fm.name = name;
					fm.image = image;
				});
				await renameToName(this.app, file, name);
			} else {
				await ensureFolder(this.app, this.plugin.settings.mapsFolder);
				file = await this.app.vault.create(path, `---\n${stringifyYaml({ type: "map", name, image })}---\n\n`);
			}
			this.close();
			this.onDone?.(file);
		} catch (err) {
			new Notice(`Couldn't save the map: ${(err as Error).message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
