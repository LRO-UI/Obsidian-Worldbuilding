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

/**
 * A user-defined note type (artifact, religion, language…) rendered by the generic custom sheet:
 * gallery, overview, "At a glance", "## " sections and tables.
 */
export interface CustomType {
	/** Frontmatter `type`, lowercase, e.g. "artifact". */
	type: string;
	/** Singular display name, e.g. "Artifact". */
	label: string;
	/** Lucide icon name. */
	icon: string;
	folder: string;
	/** Frontmatter key shown in quotes under the name, e.g. "epithet". Empty for none. */
	tagline: string;
	fields: CityField[];
	tables: CityTable[];
	/** "## " headings in the note body, shown as sections in this order. */
	sections: string[];
}

/** Frontmatter types with a dedicated view; custom types can't reuse them. */
export const BUILT_IN_TYPES = ["character", "city", "species", "faction", "scene", "event", "map"];

/** Starting points offered by "Add type" in settings. */
export const CUSTOM_TYPE_PRESETS: CustomType[] = [
	{
		type: "artifact",
		label: "Artifact",
		icon: "gem",
		folder: "Artifacts",
		tagline: "epithet",
		fields: [
			{ key: "kind", label: "Kind" },
			{ key: "maker", label: "Maker" },
			{ key: "made", label: "Made" },
			{ key: "material", label: "Material" },
			{ key: "owner", label: "Current owner" },
			{ key: "location", label: "Location" },
			{ key: "status", label: "Status" },
		],
		tables: [
			{ key: "owners", title: "Past owners", columns: "name, from, notes" },
			{ key: "powers", title: "Powers", columns: "name, cost, notes" },
		],
		sections: ["Appearance", "History", "Powers", "Legends"],
	},
	{
		type: "religion",
		label: "Religion",
		icon: "sun",
		folder: "Religions",
		tagline: "creed",
		fields: [
			{ key: "deities", label: "Deities" },
			{ key: "founded", label: "Founded" },
			{ key: "founder", label: "Founder" },
			{ key: "seat", label: "Holy seat" },
			{ key: "clergy", label: "Clergy" },
			{ key: "followers", label: "Followers" },
			{ key: "symbol", label: "Symbol" },
		],
		tables: [
			{ key: "holy_days", title: "Holy days", columns: "name, when, notes" },
			{ key: "sects", title: "Sects", columns: "name, belief, notes" },
		],
		sections: ["Beliefs", "Practices", "Clergy", "History", "Heresies"],
	},
	{
		type: "language",
		label: "Language",
		icon: "languages",
		folder: "Languages",
		tagline: "",
		fields: [
			{ key: "family", label: "Family" },
			{ key: "speakers", label: "Speakers" },
			{ key: "regions", label: "Regions" },
			{ key: "script", label: "Script" },
			{ key: "status", label: "Status" },
		],
		tables: [
			{ key: "lexicon", title: "Lexicon", columns: "word, meaning, notes" },
			{ key: "dialects", title: "Dialects", columns: "name, region, notes" },
		],
		sections: ["Sound", "Grammar", "Writing", "Naming", "History"],
	},
];

export const blankCustomType = (n: number): CustomType => ({
	type: `type${n}`,
	label: "New type",
	icon: "file-text",
	folder: "",
	tagline: "",
	fields: [{ key: "kind", label: "Kind" }],
	tables: [],
	sections: ["Description", "History"],
});

export interface PluginSettings {
	charactersFolder: string;
	eventsFolder: string;
	manuscriptFolder: string;
	citiesFolder: string;
	speciesFolder: string;
	factionsFolder: string;
	mapsFolder: string;
	timelineName: string;
	eraName: string;
	eraAbbr: string;
	months: string[];
	currentYear: number;
	categories: Category[];
	descFields: Record<DescGroupKey, DescField[]>;
	cityFields: CityField[];
	cityTables: CityTable[];
	speciesFields: CityField[];
	speciesTables: CityTable[];
	/** "## " headings in a species note's body, shown as sections in this order. */
	speciesSections: string[];
	factionFields: CityField[];
	factionTables: CityTable[];
	customTypes: CustomType[];
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
	speciesFolder: "Species",
	factionsFolder: "Factions",
	mapsFolder: "Maps",
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
	speciesFields: [
		{ key: "classification", label: "Classification" },
		{ key: "sapience", label: "Sapience" },
		{ key: "habitat", label: "Habitat" },
		{ key: "range", label: "Range" },
		{ key: "lifespan", label: "Lifespan" },
		{ key: "size", label: "Size" },
		{ key: "diet", label: "Diet" },
		{ key: "population", label: "Population" },
		{ key: "languages", label: "Languages" },
		{ key: "status", label: "Status" },
	],
	speciesTables: [
		{ key: "variants", title: "Variants", columns: "name, range, traits" },
		{ key: "abilities", title: "Abilities", columns: "name, kind, notes" },
	],
	speciesSections: ["Appearance", "Biology", "Behaviour", "Culture", "Society", "Ecology", "History"],
	factionFields: [
		{ key: "leader", label: "Leader" },
		{ key: "kind", label: "Type" },
		{ key: "founded", label: "Founded" },
		{ key: "seat", label: "Seat" },
		{ key: "ideology", label: "Ideology" },
		{ key: "size", label: "Size" },
		{ key: "symbol", label: "Symbol" },
		{ key: "status", label: "Status" },
	],
	factionTables: [
		{ key: "resources", title: "Resources", columns: "name, kind, notes" },
		{ key: "ranks", title: "Ranks", columns: "rank, notes" },
	],
	customTypes: [],
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
