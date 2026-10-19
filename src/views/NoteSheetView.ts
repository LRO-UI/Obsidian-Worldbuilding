import { Component, ItemView, MarkdownRenderer, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type StoryPlugin from "../main";

export interface NoteSheetState {
	file?: string;
}

/**
 * Base for views that render a single note (identified by its frontmatter `type`) as a sheet.
 * Handles file state, live refresh on metadata changes, renames/deletes, and the Edit round-trip.
 */
export abstract class NoteSheetView extends ItemView {
	file: TFile | null = null;
	private renderComp: Component | null = null;
	private renderToken = 0;

	constructor(leaf: WorkspaceLeaf, protected plugin: StoryPlugin) {
		super(leaf);
	}

	/** Frontmatter `type` this view renders. */
	protected abstract readonly noteType: string;
	protected abstract readonly fallbackTitle: string;
	protected abstract renderEmpty(root: HTMLElement): void;
	protected abstract renderSheet(root: HTMLElement, file: TFile, fm: Record<string, unknown>, body: string): void;
	/** Header actions specific to the subclass. */
	protected addViewActions(): void {}

	getDisplayText(): string {
		return this.file?.basename ?? this.fallbackTitle;
	}

	protected refreshTitle(): void {
		(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
		(this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText());
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("ct-view");
		this.addViewActions();
		this.addAction("pencil", "Edit note", () => this.editSource());
		this.registerEvent(
			this.app.metadataCache.on("changed", (f) => {
				if (f === this.file) this.render();
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (f) => {
				if (f === this.file) {
					this.refreshTitle();
					this.render();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (f) => {
				if (f === this.file) {
					this.file = null;
					this.render();
				}
			})
		);
		this.render();
	}

	getState(): Record<string, unknown> {
		return { file: this.file?.path };
	}

	async setState(state: NoteSheetState, result: ViewStateResult): Promise<void> {
		if (state.file) {
			const f = this.app.vault.getAbstractFileByPath(state.file);
			this.file = f instanceof TFile ? f : null;
		}
		this.refreshTitle();
		await this.render();
		return super.setState(state, result);
	}

	async editSource(): Promise<void> {
		if (!this.file) return;
		this.plugin.markEditing(this.leaf, this.file.path);
		await this.leaf.setViewState({ type: "markdown", state: { file: this.file.path, mode: "source" } });
	}

	protected async update(fn: (fm: Record<string, any>) => void): Promise<void> {
		if (this.file) await this.app.fileManager.processFrontMatter(this.file, fn);
	}

	async render(): Promise<void> {
		const token = ++this.renderToken;
		const root = this.contentEl;
		const scroll = root.scrollTop;
		if (this.renderComp) this.removeChild(this.renderComp);
		this.renderComp = this.addChild(new Component());
		root.empty();

		const file = this.file;
		const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
		if (!file || !fm || fm.type !== this.noteType) {
			this.renderEmpty(root);
			return;
		}
		const body = await this.readBody(file);
		if (token !== this.renderToken) return;
		this.renderSheet(root, file, fm, body);
		root.scrollTop = scroll;
	}

	private async readBody(file: TFile): Promise<string> {
		const text = await this.app.vault.cachedRead(file);
		const end = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
		return (end != null ? text.slice(end) : text).trim();
	}

	protected renderMarkdown(el: HTMLElement, body: string, file: TFile, emptyText: string): void {
		if (!body) {
			el.createDiv({ cls: "ct-faint", text: emptyText });
			return;
		}
		MarkdownRenderer.render(this.app, body, el, file.path, this.renderComp!);
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}
