import { Notice, normalizePath, TFile } from "obsidian";
import { fromIndex } from "./calendar";
import type StoryPlugin from "./main";
import { collectEvents, ensureFolder, joinPath } from "./model";
import { ThemeColor } from "./settings";

/** Canvas sync on the open JSON Canvas format (jsoncanvas.org). Plugin-owned nodes have ids prefixed `ct-`. */

const PPM = 22 * 6; // Year zoom × 6
const CARD_W = 360;
const CARD_H = 180;
const AXIS_Y = 0;
const CANVAS_COLOR: Record<ThemeColor, string> = {
	red: "1", orange: "2", yellow: "3", green: "4", cyan: "5", purple: "6", blue: "#4f9dff", pink: "#fa99cd",
};

interface CanvasNode {
	id: string;
	type: "text" | "file" | "link" | "group";
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
	text?: string;
	file?: string;
	label?: string;
	[k: string]: unknown;
}
interface CanvasEdge {
	id: string;
	fromNode: string;
	toNode: string;
	fromSide?: string;
	toSide?: string;
	[k: string]: unknown;
}
interface CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	[k: string]: unknown;
}

export interface CanvasSyncRecord {
	origin: number;
	events: Record<string, { start: number; x: number }>;
}

function hash(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

export function canvasPath(plugin: StoryPlugin): string {
	const s = plugin.settings;
	return normalizePath(joinPath(s.eventsFolder, `${s.timelineName || "Timeline"}.canvas`));
}

export async function syncTimelineToCanvas(plugin: StoryPlugin): Promise<TFile | null> {
	const { app, settings } = plugin;
	const events = collectEvents(app).sort((a, b) => a.start - b.start);
	if (!events.length) {
		new Notice("No event notes found (notes with type: event and tl-start).");
		return null;
	}
	const path = canvasPath(plugin);
	const existingFile = app.vault.getAbstractFileByPath(path);
	let data: CanvasData = { nodes: [], edges: [] };
	if (existingFile instanceof TFile) {
		try {
			const parsed = JSON.parse(await app.vault.read(existingFile));
			data = { ...parsed, nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
		} catch {
			new Notice(`${path} isn't valid JSON; leaving it alone.`);
			return null;
		}
	}

	const prev = plugin.canvasRecord;
	const origin = Math.floor(events[0].start / 12) * 12;
	const last = Math.max(...events.map((e) => e.end ?? e.start + 1));
	const span = Math.ceil((last + 1) / 12) * 12 - origin;
	const xOf = (m: number) => (m - origin) * PPM;

	const userNodes = data.nodes.filter((n) => !n.id.startsWith("ct-"));
	const oldById = new Map(data.nodes.map((n) => [n.id, n]));
	const nodes: CanvasNode[] = [];
	const edges: CanvasEdge[] = data.edges.filter((e) => !e.id.startsWith("ct-"));
	const record: CanvasSyncRecord = { origin, events: {} };

	// Axis and year labels
	nodes.push({ id: "ct-axis", type: "text", text: "", x: 0, y: AXIS_Y - 4, width: span * PPM, height: 8 });
	for (let y = origin / 12; y <= (origin + span) / 12; y++) {
		nodes.push({ id: `ct-year-${y}`, type: "text", text: `**${y}**`, x: xOf(y * 12) - 40, y: AXIS_Y + 16, width: 80, height: 50 });
	}

	events.forEach((e, i) => {
		const h = hash(e.path);
		const cardId = `ct-ev-${h}`;
		const anchorId = `ct-anchor-${h}`;
		const above = i % 2 === 0;
		const level = Math.floor(i / 2) % 3;
		const old = oldById.get(cardId);
		const prevRec = prev?.events[e.path];
		const dateUnchanged = prevRec && prevRec.start === e.start && prev?.origin === origin;
		const x = old && dateUnchanged ? old.x : xOf(e.start) - CARD_W / 2;
		const y = old ? old.y : above ? AXIS_Y - 120 - CARD_H - level * (CARD_H + 40) : AXIS_Y + 120 + level * (CARD_H + 40);
		const cat = settings.categories.find((c) => c.key === e.category);
		nodes.push({
			id: cardId, type: "file", file: e.path, x, y, width: old?.width ?? CARD_W, height: old?.height ?? CARD_H,
			...(cat ? { color: CANVAS_COLOR[cat.color] } : {}),
		});
		nodes.push({ id: anchorId, type: "text", text: "", x: xOf(e.start) - 6, y: AXIS_Y - 6, width: 12, height: 12, ...(cat ? { color: CANVAS_COLOR[cat.color] } : {}) });
		const cardAbove = y + CARD_H / 2 < AXIS_Y;
		edges.push({ id: `ct-edge-${h}`, fromNode: cardId, fromSide: cardAbove ? "bottom" : "top", toNode: anchorId, toSide: cardAbove ? "top" : "bottom" });
		record.events[e.path] = { start: e.start, x };
	});

	// Group around everything we own
	const minX = Math.min(...nodes.map((n) => n.x)) - 80;
	const maxX = Math.max(...nodes.map((n) => n.x + n.width)) + 80;
	const minY = Math.min(...nodes.map((n) => n.y)) - 80;
	const maxY = Math.max(...nodes.map((n) => n.y + n.height)) + 80;
	const y0 = origin / 12;
	const y1 = (origin + span) / 12;
	nodes.unshift({
		id: "ct-group", type: "group", x: minX, y: minY, width: maxX - minX, height: maxY - minY, color: "6",
		label: `${settings.timelineName || "Timeline"} · ${y0}–${y1}${settings.eraAbbr ? " " + settings.eraAbbr : ""}`,
	});

	const out: CanvasData = { ...data, nodes: [...nodes, ...userNodes], edges };
	const json = JSON.stringify(out, null, "\t");
	plugin.canvasRecord = record;
	await plugin.saveSettings();
	let file: TFile;
	if (existingFile instanceof TFile) {
		await app.vault.modify(existingFile, json);
		file = existingFile;
	} else {
		await ensureFolder(app, settings.eventsFolder);
		file = await app.vault.create(path, json);
	}
	new Notice(`Timeline synced to ${path} (${events.length} events).`);
	return file;
}

/**
 * Reverse sync (feature-flagged): when the synced canvas file is saved and an event card moved
 * horizontally, recompute its month and write tl-start / tl-end. Uses only the file on disk.
 */
export async function reverseSyncFromCanvas(plugin: StoryPlugin, file: TFile): Promise<void> {
	const rec = plugin.canvasRecord;
	if (!rec || file.path !== canvasPath(plugin)) return;
	let data: CanvasData;
	try {
		data = JSON.parse(await plugin.app.vault.read(file));
	} catch {
		return;
	}
	let changed = 0;
	for (const n of data.nodes ?? []) {
		if (n.type !== "file" || !n.id.startsWith("ct-ev-") || !n.file) continue;
		const r = rec.events[n.file];
		if (!r || Math.abs(n.x - r.x) < PPM / 2) continue;
		const delta = Math.round((n.x - r.x) / PPM);
		const ev = plugin.app.vault.getAbstractFileByPath(n.file);
		if (!(ev instanceof TFile) || delta === 0) continue;
		const newStart = Math.max(0, r.start + delta);
		await plugin.app.fileManager.processFrontMatter(ev, (fm) => {
			const end = fm["tl-end"];
			fm["tl-start"] = fromIndex(newStart);
			if (end && typeof end === "object") {
				const oldEnd = Number(end.year) * 12 + Number(end.month ?? 0);
				fm["tl-end"] = fromIndex(oldEnd + (newStart - r.start));
			}
		});
		rec.events[n.file] = { start: newStart, x: n.x };
		changed++;
	}
	if (changed) {
		await plugin.saveSettings();
		new Notice(`Re-dated ${changed} event${changed === 1 ? "" : "s"} from the canvas.`);
	}
}
