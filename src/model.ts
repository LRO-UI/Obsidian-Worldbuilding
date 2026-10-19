import { App, TFile } from "obsidian";
import { CalDate, parseDate, toIndex } from "./calendar";

export const STAT_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_NAMES: Record<StatKey, string> = {
	str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intellect", wis: "Wisdom", cha: "Charisma",
};
export const STAT_HINTS: Record<StatKey, string> = {
	str: "Might, carrying", dex: "Agility, aim", con: "Endurance", int: "Reason, memory", wis: "Perception, insight", cha: "Presence, persuasion",
};

export interface Vital { name: string; cur: number; max: number }
export interface Goal { text: string; done: boolean }
export interface Relationship { who: string; kind: string; score: number }
export interface InventoryItem { item: string; tag: string; qty: string }
export interface DescValue { text: string; color?: string }

export interface Character {
	name: string;
	quote: string;
	portrait: string;
	status: string;
	role: string;
	ancestry: string;
	born: CalDate | null;
	affiliation: string;
	faction: string;
	factionTag: string;
	storyRole: string;
	vitals: Vital[];
	stats: Record<StatKey, number>;
	traits: string[];
	values: string[];
	weaknesses: string[];
	goals: Goal[];
	relationships: Relationship[];
	inventory: InventoryItem[];
	description: Record<string, Record<string, DescValue>>;
}

export interface StoryEvent {
	path: string;
	location: string; // raw frontmatter value, usually a [[link]] to a city
	title: string;
	start: number;
	end: number | null;
	lane: string; // basename of lane note, or "World"
	laneRaw: string;
	category: string;
}

const str = (v: unknown): string => (v == null ? "" : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

export function parseCharacter(fm: Record<string, unknown>, fallbackName: string): Character {
	const vitalsRaw = (fm.vitals ?? {}) as Record<string, unknown>;
	const vitals: Vital[] = Object.entries(vitalsRaw).map(([name, v]) => {
		const a = Array.isArray(v) ? v : [v, v];
		return { name, cur: Number(a[0]) || 0, max: Number(a[1]) || 0 };
	});
	const statsRaw = (fm.stats ?? {}) as Record<string, unknown>;
	const stats = {} as Record<StatKey, number>;
	for (const k of STAT_KEYS) stats[k] = Number(statsRaw[k] ?? statsRaw[k.toUpperCase()]) || 0;

	const descRaw = (fm.description ?? {}) as Record<string, unknown>;
	const description: Character["description"] = {};
	for (const [group, fields] of Object.entries(descRaw)) {
		description[group] = {};
		if (fields && typeof fields === "object") {
			for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
				if (v && typeof v === "object" && !Array.isArray(v)) {
					const o = v as Record<string, unknown>;
					description[group][k] = { text: str(o.text), color: o.color ? str(o.color) : undefined };
				} else description[group][k] = { text: str(v) };
			}
		}
	}

	return {
		name: str(fm.name) || fallbackName,
		quote: str(fm.quote),
		portrait: str(fm.portrait),
		status: str(fm.status),
		role: str(fm.role),
		ancestry: str(fm.ancestry),
		born: parseDate(fm.born),
		affiliation: str(fm.affiliation),
		faction: str(fm.faction),
		factionTag: str(fm.faction_tag),
		storyRole: str(fm.story_role),
		vitals,
		stats,
		traits: arr(fm.traits).map(str),
		values: arr(fm.values).map(str),
		weaknesses: arr(fm.weaknesses).map(str),
		goals: arr(fm.goals).map((g) =>
			typeof g === "object" && g ? { text: str((g as Goal).text), done: !!(g as Goal).done } : { text: str(g), done: false }
		),
		relationships: arr(fm.relationships).map((r) => {
			const o = (r ?? {}) as Record<string, unknown>;
			return { who: str(o.who), kind: str(o.kind), score: Number(o.score) || 0 };
		}),
		inventory: arr(fm.inventory).map((i) => {
			const o = (typeof i === "object" && i ? i : { item: i }) as Record<string, unknown>;
			return { item: str(o.item), tag: str(o.tag), qty: str(o.qty) };
		}),
		description,
	};
}

/** "[[Target|Alias]]" → { target, display }. Plain strings pass through as display with no target. */
export function parseLink(raw: string): { target: string | null; display: string } {
	const m = /^\s*!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]\s*$/.exec(raw ?? "");
	if (!m) return { target: null, display: raw ?? "" };
	const target = m[1].trim();
	return { target, display: (m[2] ?? target.split("/").pop() ?? target).trim() };
}

export function linkBasename(raw: string): string {
	const { target, display } = parseLink(raw);
	return target ? (target.split("/").pop() ?? target).replace(/\.md$/, "") : display;
}

export function initials(name: string): string {
	const parts = name.replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return "—";
	return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function isCharacter(app: App, file: TFile | null): boolean {
	if (!file || file.extension !== "md") return false;
	return app.metadataCache.getFileCache(file)?.frontmatter?.type === "character";
}

export function parseEvent(file: TFile, fm: Record<string, unknown>): StoryEvent | null {
	const s = parseDate(fm["tl-start"]);
	if (!s) return null;
	const e = parseDate(fm["tl-end"]);
	const laneRaw = str(fm.lane) || "World";
	return {
		path: file.path,
		title: str(fm.title) || file.basename,
		start: toIndex(s),
		end: e ? Math.max(toIndex(s) + 1, toIndex(e)) : null,
		lane: linkBasename(laneRaw) || "World",
		location: str(fm.location),
		laneRaw,
		category: str(fm.category),
	};
}

export function collectEvents(app: App): StoryEvent[] {
	const out: StoryEvent[] = [];
	for (const f of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		if (fm?.type !== "event") continue;
		const ev = parseEvent(f, fm);
		if (ev) out.push(ev);
	}
	return out;
}

export function safeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
}

export function joinPath(folder: string, name: string): string {
	const f = folder.replace(/^\/+|\/+$/g, "");
	return f ? `${f}/${name}` : name;
}

export async function ensureFolder(app: App, folder: string): Promise<void> {
	const f = folder.replace(/^\/+|\/+$/g, "");
	if (!f) return;
	let acc = "";
	for (const part of f.split("/")) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) await app.vault.createFolder(acc);
	}
}
