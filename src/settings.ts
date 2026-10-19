export type ThemeColor = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "pink";
export const THEME_COLORS: ThemeColor[] = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"];

export type DescGroupKey = "appearance" | "personality" | "narration";
export type FieldType = "text" | "color" | "enum" | "textarea";

export interface DescField {
	key: string;
	label: string;
	type: FieldType;
	/** Comma-separated options, only for `enum`. */
	options?: string;
}

export interface Category {
	key: string;
	label: string;
	color: ThemeColor;
}

export type SheetLayout = "full" | "dossier";

/** A row in the city's "At a glance" table. Values may be text, [[links]], lists or calendar dates. */
export interface CityField {
	key: string;
	label: string;
}

/** A frontmatter list of objects shown as a table, e.g. districts: [{ name, character, notes }]. */
export interface CityTable {
	key: string;
	title: string;
	/** Comma-separated object keys, in column order. */
	columns: string;
}

export interface PluginSettings {
	charactersFolder: string;
	eventsFolder: string;
	manuscriptFolder: string;
	citiesFolder: string;
	timelineName: string;
	eraName: string;
	eraAbbr: string;
	months: string[];
	currentYear: number;
	categories: Category[];
	descFields: Record<DescGroupKey, DescField[]>;
	cityFields: CityField[];
	cityTables: CityTable[];
	pointPool: number;
	statBase: number;
	statMin: number;
	statMax: number;
	defaultLayout: SheetLayout;
	openSheetByDefault: boolean;
	canvasReverseSync: boolean;
}

export const GROUP_TITLES: Record<DescGroupKey, string> = {
	appearance: "Appearance",
	personality: "Personality",
	narration: "POV & narration",
};

export const DEFAULT_SETTINGS: PluginSettings = {
	charactersFolder: "Characters",
	eventsFolder: "Timeline",
	manuscriptFolder: "Manuscript",
	citiesFolder: "Places",
	timelineName: "Saltreach Arc",
	eraName: "Third Age",
	eraAbbr: "TA",
	months: ["Frostmoot", "Thaw", "Seedfall", "Greening", "Highsun", "Emberwane", "Harvest", "Duskfall", "Mists", "Hollow", "Deepcold", "Yearsend"],
	currentYear: 1043,
	categories: [
		{ key: "conflict", label: "Conflict", color: "red" },
		{ key: "journey", label: "Journey", color: "cyan" },
		{ key: "politics", label: "Politics", color: "purple" },
		{ key: "personal", label: "Personal", color: "yellow" },
	],
	descFields: {
		appearance: [
			{ key: "eyes", label: "Eyes", type: "color" },
			{ key: "hair", label: "Hair", type: "color" },
			{ key: "skin", label: "Skin", type: "color" },
			{ key: "build", label: "Build", type: "text" },
			{ key: "marks", label: "Marks", type: "text" },
			{ key: "dress", label: "Dress", type: "text" },
			{ key: "mannerism", label: "Mannerism", type: "text" },
		],
		personality: [
			{ key: "core", label: "Core", type: "text" },
			{ key: "want", label: "Want", type: "text" },
			{ key: "need", label: "Need", type: "text" },
			{ key: "fear", label: "Fear", type: "text" },
			{ key: "secret", label: "Secret", type: "text" },
			{ key: "contradiction", label: "Contradiction", type: "text" },
			{ key: "speech", label: "Speech", type: "text" },
		],
		narration: [
			{ key: "pov", label: "POV", type: "enum", options: "First, Close third, Distant third, Omniscient, Second" },
			{ key: "tense", label: "Tense", type: "enum", options: "Past, Present" },
			{ key: "arc", label: "Arc", type: "text" },
			{ key: "notices_first", label: "Notices first", type: "text" },
			{ key: "never_describes", label: "Never describes", type: "text" },
			{ key: "voice_sample", label: "Voice sample", type: "textarea" },
		],
	},
	cityFields: [
		{ key: "region", label: "Region" },
		{ key: "founded", label: "Founded" },
		{ key: "population", label: "Population" },
		{ key: "government", label: "Government" },
		{ key: "ruler", label: "Ruler" },
		{ key: "factions", label: "Factions" },
		{ key: "languages", label: "Languages" },
		{ key: "religion", label: "Religion" },
		{ key: "exports", label: "Exports" },
		{ key: "climate", label: "Climate" },
	],
	cityTables: [
		{ key: "districts", title: "Districts", columns: "name, character, notes" },
		{ key: "landmarks", title: "Landmarks", columns: "name, kind, notes" },
	],
	pointPool: 26,
	statBase: 8,
	statMin: 3,
	statMax: 18,
	defaultLayout: "full",
	openSheetByDefault: true,
	canvasReverseSync: false,
};

export function cloneDefaults(): PluginSettings {
	return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}
