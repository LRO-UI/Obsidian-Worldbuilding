import { App, TFile } from "obsidian";
import { fromIndex, parseDate, toIndex } from "./calendar";
import { setOrDelete } from "./editing";
import { collectEvents, linkBasename, resolveFirstLink, StoryEvent } from "./model";

/** Fields a pin and a border share. `index` is the position in the frontmatter list, -1 until saved. */
export interface MapItem {
	index: number;
	note: string; // usually a [[link]]
	label: string;
	color: string;
	from: number | null;
	to: number | null;
}

/** A marker. x and y are fractions of the image, so replacing the image with a larger export keeps it in place. */
export interface MapPin extends MapItem {
	x: number;
	y: number;
}

/** A filled area, such as a realm's borders in one era. */
export interface MapBorder extends MapItem {
	points: [number, number][];
}

export interface MapData {
	image: string;
	pins: MapPin[];
	borders: MapBorder[];
}

/** An item with its note resolved. `start` and `end` fall back to the note's own dates. */
export type Placed<T extends MapItem> = T & {
	file: TFile | null;
	name: string;
	start: number | null;
	end: number | null;
};

export interface MapStop {
	at: number;
	changes: string[];
}

export interface MapModel {
	pins: (Placed<MapPin> & { events: StoryEvent[] })[];
	borders: Placed<MapBorder>[];
	/** Every date on which something on this map changes, in order. */
	stops: MapStop[];
}

/** Note types offered first when adding a pin or a border. */
export const PLACE_TYPES = ["city", "region", "place", "location"];
export const REALM_TYPES = ["faction", "region", "realm", "kingdom", "nation"];

const str = (v: unknown): string => (v == null ? "" : String(v));
const list =(v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const round = (n: number) => Math.round(n * 10000) / 10000;
const date = (v: unknown): number | null => {
	const d = parseDate(v);
	return d ? toIndex(d) : null;
};

function parseItem(o: Record<string, unknown>, index: number): MapItem {
	return { index, note: str(o.note), label: str(o.label), color: str(o.color), from: date(o.from), to: date(o.to) };
}

/** "0.1,0.2 0.3,0.4 …", the same shape as an SVG polygon. Keeps a border to one line of frontmatter. */
function parsePoints(v: unknown): [number, number][] {
	return str(v)
		.split(/\s+/)
		.map((p) => p.split(",").map(Number) as [number, number])
		.filter((p) => p.length === 2 && p.every(Number.isFinite));
}

export function parseMap(fm: Record<string, unknown>): MapData {
	const pins: MapPin[] = [];
	list(fm.pins).forEach((raw, i) => {
		const o = (raw ?? {}) as Record<string, unknown>;
		const x = Number(o.x), y = Number(o.y);
		if (o.x != null && o.y != null && Number.isFinite(x) && Number.isFinite(y)) pins.push({ ...parseItem(o, i), x, y });
	});
	const borders: MapBorder[] = [];
	list(fm.borders).forEach((raw, i) => {
		const o = (raw ?? {}) as Record<string, unknown>;
		const points = parsePoints(o.points);
		if (points.length >= 3) borders.push({ ...parseItem(o, i), points });
	});
	return { image: str(fm.image), pins, borders };
}

function writeItem(raw: Record<string, unknown>, item: MapItem): void {
	setOrDelete(raw, "note", item.note);
	setOrDelete(raw, "label", item.label);
	setOrDelete(raw, "color", item.color);
	setOrDelete(raw, "from", item.from == null ? null : fromIndex(item.from));
	setOrDelete(raw, "to", item.to == null ? null : fromIndex(item.to));
}

/** Adds the item to the frontmatter list, or updates it in place, keeping keys the plugin doesn't manage. */
function upsert(fm: Record<string, unknown>, key: string, item: MapItem, write: (raw: Record<string, unknown>) => void): void {
	const items = list(fm[key]);
	if (item.index < 0) item.index = items.length;
	const raw = (items[item.index] ?? {}) as Record<string, unknown>;
	writeItem(raw, item);
	write(raw);
	items[item.index] = raw;
	fm[key] = items;
}

export function writePin(fm: Record<string, unknown>, pin: MapPin): void {
	upsert(fm, "pins", pin, (raw) => {
		raw.x = round(pin.x);
		raw.y = round(pin.y);
	});
}

export function writeBorder(fm: Record<string, unknown>, border: MapBorder): void {
	upsert(fm, "borders", border, (raw) => {
		raw.points = border.points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
	});
}

export function removeItem(fm: Record<string, unknown>, key: "pins" | "borders", index: number): void {
	const items = list(fm[key]);
	items.splice(index, 1);
	setOrDelete(fm, key, items);
}

/** Reduces a freehand outline to the corners that matter (Douglas-Peucker). `tolerance` is in the points' own units. */
export function simplifyPath(points: [number, number][], tolerance: number): [number, number][] {
	if (points.length < 3) return points;
	const keep = new Set([0, points.length - 1]);
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length) {
		const [a, b] = stack.pop()!;
		const [ax, ay] = points[a];
		const [bx, by] = points[b];
		const len = Math.hypot(bx - ax, by - ay);
		let far = -1, max = tolerance;
		for (let i = a + 1; i < b; i++) {
			const [x, y] = points[i];
			const d = len ? Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / len : Math.hypot(x - ax, y - ay);
			if (d > max) {
				max = d;
				far = i;
			}
		}
		if (far >= 0) {
			keep.add(far);
			stack.push([a, far], [far, b]);
		}
	}
	return points.filter((_, i) => keep.has(i));
}

/** Whether something with this date range exists at `at`. Both ends are inclusive. */
export function isVisibleAt(item: { start: number | null; end: number | null }, at: number | null): boolean {
	if (at == null) return true;
	return (item.start == null || item.start <= at) && (item.end == null || at <= item.end);
}

/** Dates the map item left blank come from its note: when a city or faction was founded, or when an event happened. */
export function place<T extends MapItem>(app: App, item: T, sourcePath: string): Placed<T> {
	const file = resolveFirstLink(app, item.note, sourcePath);
	const fm = file ? app.metadataCache.getFileCache(file)?.frontmatter : null;
	const eventStart = date(fm?.["tl-start"]);
	return {
		...item,
		file,
		name: item.label || (item.note ? linkBasename(item.note) : ""),
		start: item.from ?? eventStart ?? date(fm?.founded),
		end: item.to ?? date(fm?.["tl-end"]) ?? eventStart,
	};
}

export function buildMapModel(app: App, sourcePath: string, data: MapData): MapModel {
	const events = collectEvents(app);
	const eventsAt = new Map<string, StoryEvent[]>();
	for (const e of events) {
		const f = resolveFirstLink(app, e.location, e.path);
		if (!f) continue;
		if (!eventsAt.has(f.path)) eventsAt.set(f.path, []);
		eventsAt.get(f.path)!.push(e);
	}

	const pins = data.pins.map((p) => {
		const placed = place(app, p, sourcePath);
		return { ...placed, events: placed.file ? eventsAt.get(placed.file.path) ?? [] : [] };
	});
	const borders = data.borders.map((b) => place(app, b, sourcePath));

	const stops = new Map<number, string[]>();
	const add = (at: number | null, text: string) => {
		if (at == null) return;
		if (!stops.has(at)) stops.set(at, []);
		if (!stops.get(at)!.includes(text)) stops.get(at)!.push(text);
	};
	for (const item of [...pins, ...borders]) {
		const name = item.name || "Unnamed";
		add(item.start, `${name} appears`);
		if (item.end != null) add(item.end + 1, `${name} ends`);
	}
	const placedEvents = new Set(pins.flatMap((p) => p.events));
	for (const e of placedEvents) {
		add(e.start, e.title);
		if (e.end != null) add(e.end + 1, `${e.title} ends`);
	}
	return {
		pins,
		borders,
		stops: [...stops.entries()].sort((a, b) => a[0] - b[0]).map(([at, changes]) => ({ at, changes })),
	};
}

export function collectMaps(app: App): TFile[] {
	return app.vault
		.getMarkdownFiles()
		.filter((f) => app.metadataCache.getFileCache(f)?.frontmatter?.type === "map")
		.sort((a, b) => a.basename.localeCompare(b.basename));
}

/** The maps with a pin linked to this note. */
export function mapsShowing(app: App, file: TFile): TFile[] {
	return collectMaps(app).filter((m) => {
		const fm = app.metadataCache.getFileCache(m)?.frontmatter;
		return !!fm && parseMap(fm).pins.some((p) => resolveFirstLink(app, p.note, m.path) === file);
	});
}
