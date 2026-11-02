import { App, TFile } from "obsidian";
import { parseCharacter, parseLink } from "./model";

// ---------- kinds ----------

export interface RelCategory {
	key: string;
	label: string;
	/** Obsidian colour name, used as var(--color-<name>). */
	color: string;
	/** Word stems; a kind belongs to the category whose stem appears earliest in it. */
	stems: string[];
}

export const REL_CATEGORIES: RelCategory[] = [
	{ key: "family", label: "Family", color: "orange", stems: ["parent", "father", "mother", "mum", "mom", "dad", "son", "daughter", "child", "sibling", "brother", "sister", "twin", "uncle", "aunt", "cousin", "niece", "nephew", "grand", "ancest", "descend", "kinsm", "kinsw", "heir", "ward", "step", "half-"] },
	{ key: "romance", label: "Romance", color: "pink", stems: ["partner", "lover", "spouse", "husband", "wife", "betroth", "fianc", "consort", "sweetheart", "beloved", "widow", "ex-", "crush"] },
	{ key: "ally", label: "Ally", color: "green", stems: ["ally", "allies", "friend", "comrade", "companion", "crew", "confidant", "sworn", "shipmate", "bodyguard", "protector", "loyal"] },
	{ key: "mentor", label: "Mentor", color: "cyan", stems: ["mentor", "teacher", "master", "apprentice", "student", "pupil", "tutor", "protégé", "protege", "disciple", "trainer"] },
	{ key: "rival", label: "Rival", color: "red", stems: ["rival", "enem", "nemesis", "foe", "adversar", "betray", "traitor", "feud", "hate", "hunt"] },
	{ key: "business", label: "Business", color: "yellow", stems: ["creditor", "debtor", "debt", "employ", "patron", "client", "captain", "boss", "servant", "liege", "lord", "vassal", "contact", "informant", "handler", "agent", "associate", "business", "buyer", "seller"] },
];
export const OTHER_CATEGORY: RelCategory = { key: "other", label: "Other", color: "purple", stems: [] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CATEGORY_RES = REL_CATEGORIES.map((c) => ({ cat: c, re: new RegExp(`(?:^|[^\\p{L}])(?:${c.stems.map(escapeRe).join("|")})`, "iu") }));

/** "Debtor, rival" → Business (debtor comes first). Unknown or empty kinds are Other. */
export function categorize(kind: string): RelCategory {
	let best: RelCategory = OTHER_CATEGORY;
	let at = Infinity;
	for (const { cat, re } of CATEGORY_RES) {
		const m = re.exec(kind);
		if (m && m.index < at) {
			at = m.index;
			best = cat;
		}
	}
	return best;
}

/**
 * What `who` is to the note's owner, for the family tree. A kind of "Father" on Corvin's note
 * means `who` is Corvin's parent.
 */
export type KinRole = "parent" | "child" | "spouse" | "sibling";
const KIN_RES: [KinRole, RegExp][] = [
	["parent", /\b(?:parent|father|mother|mum|mom|dad|stepfather|stepmother|step-father|step-mother)s?\b/i],
	["child", /\b(?:child|children|son|daughter|stepson|stepdaughter|step-son|step-daughter)s?\b/i],
	["spouse", /\b(?:spouse|husband|wife|consort|widow|widower)s?\b/i],
	["sibling", /\b(?:sibling|brother|sister|twin|half-brother|half-sister|stepbrother|stepsister)s?\b/i],
];

export function kinRole(kind: string): KinRole | null {
	if (/in[- ]law/i.test(kind)) return null;
	let best: KinRole | null = null;
	let at = Infinity;
	for (const [role, re] of KIN_RES) {
		const m = re.exec(kind);
		if (m && m.index < at) {
			at = m.index;
			best = role;
		}
	}
	return best;
}

// ---------- graph ----------

export interface RelNode {
	id: string;
	name: string;
	/** null for relationship targets that aren't notes in the vault. */
	file: TFile | null;
	/** True for notes with type: character. */
	character: boolean;
	status: string;
	/** For names without a note: a character note that mentions them, so a new note is created next to it. */
	source?: string;
}

export interface RelEdge {
	/** Owner of the relationship. */
	from: string;
	/** The `who`. */
	to: string;
	kind: string;
	score: number;
	category: RelCategory;
}

export interface RelGraph {
	nodes: RelNode[];
	edges: RelEdge[];
}

/** Every character note, everyone they name in `relationships`, and one edge per relationship entry. */
export function collectRelGraph(app: App): RelGraph {
	const nodes = new Map<string, RelNode>();
	const edges: RelEdge[] = [];
	const nodeFor = (file: TFile): RelNode => {
		let n = nodes.get(file.path);
		if (!n) {
			const fm = app.metadataCache.getFileCache(file)?.frontmatter;
			const character = fm?.type === "character";
			n = { id: file.path, name: (character && typeof fm?.name === "string" && fm.name) || file.basename, file, character, status: character ? String(fm?.status ?? "") : "" };
			nodes.set(file.path, n);
		}
		return n;
	};

	const sources = app.vault.getMarkdownFiles().filter((f) => app.metadataCache.getFileCache(f)?.frontmatter?.type === "character");
	for (const f of sources) {
		const src = nodeFor(f);
		const c = parseCharacter(app.metadataCache.getFileCache(f)!.frontmatter!, f.basename);
		for (const r of c.relationships) {
			if (!r.who.trim()) continue;
			const { target, display } = parseLink(r.who);
			const dest = app.metadataCache.getFirstLinkpathDest(target ?? display.trim(), f.path);
			let to: RelNode;
			if (dest) to = nodeFor(dest);
			else {
				const id = `?${display.trim().toLowerCase()}`;
				to = nodes.get(id) ?? { id, name: display.trim(), file: null, character: false, status: "", source: f.path };
				nodes.set(id, to);
			}
			if (to.id === src.id) continue;
			edges.push({ from: src.id, to: to.id, kind: r.kind, score: Math.max(-10, Math.min(10, r.score)), category: categorize(r.kind) });
		}
	}
	return { nodes: [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name)), edges };
}

// ---------- family tree ----------

export interface TreeLayout {
	pos: Map<string, { x: number; y: number }>;
	/** Children grouped by their set of parents; parents.length is 1 or 2. */
	families: { parents: string[]; children: string[] }[];
	spouses: [string, string][];
	/** Ids with at least one family link. */
	members: Set<string>;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/** Generations top to bottom, couples side by side, children under their parents. */
export function layoutFamilyTree(edges: RelEdge[], colGap = 150, rowGap = 140): TreeLayout {
	const parentsOf = new Map<string, Set<string>>();
	const spouseKeys = new Set<string>();
	const spouses: [string, string][] = [];
	const siblings: [string, string][] = [];
	const members = new Set<string>();
	const addParent = (p: string, c: string) => {
		if (p === c) return;
		if (!parentsOf.has(c)) parentsOf.set(c, new Set());
		parentsOf.get(c)!.add(p);
	};
	for (const e of edges) {
		const role = kinRole(e.kind);
		if (!role) continue;
		members.add(e.from);
		members.add(e.to);
		if (role === "parent") addParent(e.to, e.from);
		else if (role === "child") addParent(e.from, e.to);
		else if (role === "spouse") {
			const k = pairKey(e.from, e.to);
			if (!spouseKeys.has(k)) {
				spouseKeys.add(k);
				spouses.push([e.from, e.to]);
			}
		} else siblings.push([e.from, e.to]);
	}
	// Siblings share parents, even if only one of them lists them.
	for (let pass = 0; pass < 2; pass++) {
		for (const [a, b] of siblings) {
			const pa = parentsOf.get(a) ?? new Set<string>();
			const pb = parentsOf.get(b) ?? new Set<string>();
			for (const p of pa) addParent(p, b);
			for (const p of pb) addParent(p, a);
		}
	}

	// Undirected adjacency with generation offsets.
	const adj = new Map<string, [string, number][]>();
	const link = (a: string, b: string, d: number) => {
		if (!adj.has(a)) adj.set(a, []);
		if (!adj.has(b)) adj.set(b, []);
		adj.get(a)!.push([b, d]);
		adj.get(b)!.push([a, -d]);
	};
	for (const [c, ps] of parentsOf) for (const p of ps) link(p, c, 1);
	for (const [a, b] of spouses) link(a, b, 0);
	for (const [a, b] of siblings) link(a, b, 0);

	const gen = new Map<string, number>();
	const components: string[][] = [];
	for (const start of [...members].sort()) {
		if (gen.has(start)) continue;
		const comp: string[] = [];
		gen.set(start, 0);
		const queue = [start];
		while (queue.length) {
			const n = queue.shift()!;
			comp.push(n);
			for (const [m, d] of adj.get(n) ?? []) {
				if (gen.has(m)) continue;
				gen.set(m, gen.get(n)! + d);
				queue.push(m);
			}
		}
		const min = Math.min(...comp.map((n) => gen.get(n)!));
		for (const n of comp) gen.set(n, gen.get(n)! - min);
		components.push(comp);
	}

	const spouseOf = new Map<string, string[]>();
	for (const [a, b] of spouses) {
		if (gen.get(a) !== gen.get(b)) continue;
		spouseOf.set(a, [...(spouseOf.get(a) ?? []), b]);
		spouseOf.set(b, [...(spouseOf.get(b) ?? []), a]);
	}
	const childrenOf = new Map<string, string[]>();
	for (const [c, ps] of parentsOf) for (const p of ps) childrenOf.set(p, [...(childrenOf.get(p) ?? []), c]);

	const pos = new Map<string, { x: number; y: number }>();
	let offsetX = 0;
	for (const comp of components) {
		const depth = Math.max(...comp.map((n) => gen.get(n)!));
		const rows: string[][] = Array.from({ length: depth + 1 }, () => []);
		for (const n of comp) rows[gen.get(n)!].push(n);
		const x = new Map<string, number>();
		rows.forEach((row) => row.forEach((n, i) => x.set(n, i * colGap)));

		/** Couples (spouse chains) move as one unit. */
		const units = (row: string[]): string[][] => {
			const seen = new Set<string>();
			const out: string[][] = [];
			for (const n of row) {
				if (seen.has(n)) continue;
				const unit: string[] = [];
				const stack = [n];
				while (stack.length) {
					const m = stack.pop()!;
					if (seen.has(m)) continue;
					seen.add(m);
					unit.push(m);
					for (const s of spouseOf.get(m) ?? []) stack.push(s);
				}
				out.push(unit.sort((a, b) => x.get(a)! - x.get(b)!));
			}
			return out;
		};
		const mean = (ids: string[]) => ids.reduce((s, n) => s + x.get(n)!, 0) / ids.length;
		/** Sort a row by where its units want to be, then place them left to right without overlap. */
		const place = (row: string[], want: (n: string) => number | null) => {
			const us = units(row).map((u) => {
				const ws = u.map(want).filter((w): w is number => w != null);
				return { u, at: ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : mean(u) };
			});
			us.sort((a, b) => a.at - b.at);
			let right = -Infinity;
			for (const { u, at } of us) {
				let left = Math.max(at - ((u.length - 1) * colGap) / 2, right + colGap);
				for (const n of u) {
					x.set(n, left);
					right = left;
					left += colGap;
				}
			}
		};
		for (let iter = 0; iter < 4; iter++) {
			for (let g = 1; g <= depth; g++) place(rows[g], (n) => (parentsOf.get(n)?.size ? mean([...parentsOf.get(n)!].filter((p) => x.has(p))) : null));
			for (let g = depth - 1; g >= 0; g--) place(rows[g], (n) => (childrenOf.get(n)?.length ? mean(childrenOf.get(n)!) : null));
		}
		const minX = Math.min(...comp.map((n) => x.get(n)!));
		const maxX = Math.max(...comp.map((n) => x.get(n)!));
		for (const n of comp) pos.set(n, { x: x.get(n)! - minX + offsetX, y: gen.get(n)! * rowGap });
		offsetX += maxX - minX + colGap * 1.5;
	}

	const families = new Map<string, { parents: string[]; children: string[] }>();
	for (const [c, ps] of parentsOf) {
		const sorted = [...ps].sort((a, b) => pos.get(a)!.x - pos.get(b)!.x);
		// Two parents who are a couple share one line; otherwise each parent gets their own.
		const groups = sorted.length === 2 && spouseKeys.has(pairKey(sorted[0], sorted[1])) ? [sorted] : sorted.map((p) => [p]);
		for (const g of groups) {
			const k = g.join("\u0000");
			if (!families.has(k)) families.set(k, { parents: g, children: [] });
			families.get(k)!.children.push(c);
		}
	}
	return { pos, families: [...families.values()], spouses: spouses.filter(([a, b]) => gen.get(a) === gen.get(b)), members };
}
