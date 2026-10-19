import { App, normalizePath, TFile } from "obsidian";
import { safeFileName } from "./model";

/** Shared helpers for editors that write an existing note back in place. */

/** Path the note would have if its file name followed `name`, in the same folder. */
export function pathForName(file: TFile, name: string): string {
	const base = safeFileName(name) || file.basename;
	const folder = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
	return normalizePath(`${folder}${base}.${file.extension}`);
}

/** Renames the note to match `name` (Obsidian updates links). Returns the new path. */
export async function renameToName(app: App, file: TFile, name: string): Promise<string> {
	const target = pathForName(file, name);
	if (target !== file.path) await app.fileManager.renameFile(file, target);
	return file.path;
}

/** Replaces everything after the frontmatter block, keeping the frontmatter text untouched. */
export async function replaceBody(app: App, file: TFile, body: string): Promise<void> {
	await app.vault.process(file, (text) => {
		const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
		const head = m ? m[0] : "";
		return `${head}${head && !head.endsWith("\n") ? "\n" : ""}\n${body.trim()}\n`;
	});
}

/** Sets a frontmatter key, or removes it when the value is empty. */
export function setOrDelete(fm: Record<string, unknown>, key: string, value: unknown): void {
	const empty = value == null || value === "" || (Array.isArray(value) && !value.length) || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value as object).length);
	if (empty) delete fm[key];
	else fm[key] = value;
}
