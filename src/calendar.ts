import type { PluginSettings } from "./settings";

export interface CalDate {
	month: number;
	year: number;
}

/** Dates are laid out as an absolute month index: year * 12 + month. */
export function toIndex(d: CalDate): number {
	return d.year * 12 + d.month;
}

export function fromIndex(i: number): CalDate {
	return { month: ((i % 12) + 12) % 12, year: Math.floor(i / 12) };
}

export function parseDate(raw: unknown): CalDate | null {
	if (raw == null) return null;
	if (typeof raw === "object") {
		const o = raw as Record<string, unknown>;
		const year = Number(o.year);
		const month = Number(o.month ?? 0);
		if (!Number.isFinite(year)) return null;
		return { year, month: Number.isFinite(month) ? Math.min(11, Math.max(0, Math.round(month))) : 0 };
	}
	if (typeof raw === "number") return { year: raw, month: 0 };
	return null;
}

export class Calendar {
	constructor(private settings: PluginSettings) {}

	get months(): string[] {
		return this.settings.months;
	}

	monthName(m: number): string {
		return this.settings.months[((m % 12) + 12) % 12] ?? `M${m + 1}`;
	}

	format(d: CalDate | number): string {
		const c = typeof d === "number" ? fromIndex(d) : d;
		return `${this.monthName(c.month)} ${c.year}`;
	}

	formatRange(start: number, end?: number | null): string {
		if (end == null) return this.format(start);
		const n = end - start;
		return `${this.format(start)} → ${this.format(end)} · ${n} month${n === 1 ? "" : "s"}`;
	}

	shortRange(start: number, end?: number | null): string {
		return end == null ? this.format(start) : `${this.format(start)} → ${this.format(end)}`;
	}

	age(born: CalDate): number {
		return this.settings.currentYear - born.year;
	}
}
