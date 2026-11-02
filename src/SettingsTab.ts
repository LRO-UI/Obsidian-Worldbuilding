import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type StoryPlugin from "./main";
import { blankCustomType, BUILT_IN_TYPES, CityField, CityTable, CUSTOM_TYPE_PRESETS, CustomType, DescGroupKey, FieldType, GROUP_TITLES, SheetLayout, THEME_COLORS, ThemeColor } from "./settings";

export class StorySettingTab extends PluginSettingTab {
	/** Custom types whose settings are expanded, kept across redraws. */
	private openTypes = new Set<CustomType>();

	constructor(app: App, private plugin: StoryPlugin) {
		super(app, plugin);
	}

	private async save(redraw = false): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.refreshViews();
		if (redraw) this.display();
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();
		containerEl.addClass("ct-settings");

		// Folders
		new Setting(containerEl).setName("Folders").setHeading();
		const folder = (name: string, desc: string, key: "charactersFolder" | "eventsFolder" | "manuscriptFolder" | "citiesFolder" | "speciesFolder" | "factionsFolder") =>
			new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
				t.setValue(s[key]).onChange(async (v) => {
					s[key] = v.trim();
					await this.save();
				})
			);
		folder("Characters folder", "Where the wizard saves new character notes.", "charactersFolder");
		folder("Events folder", "Where new event notes and the synced canvas go.", "eventsFolder");
		folder("Cities folder", "Where \"Create new city\" saves city notes.", "citiesFolder");
		folder("Species folder", "Where \"Create new species\" saves species notes.", "speciesFolder");
		folder("Factions folder", "Where \"Create new faction\" saves faction notes.", "factionsFolder");
		folder("Manuscript folder", "Where \"Create new scene\" saves scene notes (type: scene). Their pov: \"[[Character]]\" counts toward POV totals.", "manuscriptFolder");

		// Sheet
		new Setting(containerEl).setName("Character sheet").setHeading();
		new Setting(containerEl)
			.setName("Default layout")
			.setDesc("Full shows everything at a glance. Dossier uses a header with tabs.")
			.addDropdown((d) =>
				d.addOptions({ full: "Full (three columns)", dossier: "Dossier (tabs)" }).setValue(s.defaultLayout).onChange(async (v) => {
					s.defaultLayout = v as SheetLayout;
					await this.save();
				})
			);
		new Setting(containerEl)
			.setName("Open character notes as sheets")
			.setDesc("When you open a note with type: character, show the sheet instead of the editor. Use Edit to get back to Markdown.")
			.addToggle((t) =>
				t.setValue(s.openSheetByDefault).onChange(async (v) => {
					s.openSheetByDefault = v;
					await this.save();
				})
			);

		// Calendar
		new Setting(containerEl).setName("Calendar").setHeading();
		new Setting(containerEl).setName("Timeline name").addText((t) =>
			t.setValue(s.timelineName).onChange(async (v) => {
				s.timelineName = v;
				await this.save();
			})
		);
		new Setting(containerEl).setName("Era").setDesc("Name and abbreviation, e.g. Third Age / TA.").addText((t) =>
			t.setPlaceholder("Third Age").setValue(s.eraName).onChange(async (v) => {
				s.eraName = v;
				await this.save();
			})
		).addText((t) =>
			t.setPlaceholder("TA").setValue(s.eraAbbr).onChange(async (v) => {
				s.eraAbbr = v;
				await this.save();
			})
		);
		new Setting(containerEl).setName("Current story year").setDesc("Used to compute ages.").addText((t) => {
			t.inputEl.type = "number";
			t.setValue(String(s.currentYear)).onChange(async (v) => {
				const n = Number(v);
				if (Number.isFinite(n)) {
					s.currentYear = n;
					await this.save();
				}
			});
		});
		const months = new Setting(containerEl).setName("Months").setDesc("Twelve month names, in order.");
		const mgrid = months.controlEl.createDiv({ cls: "ct-months-grid" });
		s.months.forEach((m, i) => {
			const input = mgrid.createEl("input", { type: "text", value: m });
			input.addEventListener("change", async () => {
				s.months[i] = input.value.trim() || `Month ${i + 1}`;
				await this.save();
			});
		});

		// Categories
		new Setting(containerEl).setName("Event categories").setHeading();
		s.categories.forEach((c, i) => {
			new Setting(containerEl)
				.setClass("ct-compact-setting")
				.addText((t) => t.setPlaceholder("key").setValue(c.key).onChange(async (v) => {
					c.key = v.trim();
					await this.save();
				}))
				.addText((t) => t.setPlaceholder("Label").setValue(c.label).onChange(async (v) => {
					c.label = v;
					await this.save();
				}))
				.addDropdown((d) => {
					THEME_COLORS.forEach((col) => d.addOption(col, col));
					d.setValue(c.color).onChange(async (v) => {
						c.color = v as ThemeColor;
						await this.save();
					});
				})
				.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => {
					s.categories.splice(i, 1);
					await this.save(true);
				}));
		});
		new Setting(containerEl).addButton((b) =>
			b.setButtonText("Add category").onClick(async () => {
				s.categories.push({ key: `category${s.categories.length + 1}`, label: "New category", color: "green" });
				await this.save(true);
			})
		);

		// Description fields
		new Setting(containerEl).setName("Description fields").setHeading();
		containerEl.createDiv({ cls: "setting-item-description", text: "Fields are stored under description.<group>.<key> in the character's frontmatter. Colour fields store { text, color }. Enum options are comma-separated." });
		for (const g of Object.keys(GROUP_TITLES) as DescGroupKey[]) {
			new Setting(containerEl).setName(GROUP_TITLES[g]).setClass("ct-subheading");
			const list = s.descFields[g];
			list.forEach((f, i) => {
				const row = new Setting(containerEl)
					.setClass("ct-compact-setting")
					.addText((t) => t.setPlaceholder("key").setValue(f.key).onChange(async (v) => {
						f.key = v.trim().replace(/\s+/g, "_");
						await this.save();
					}))
					.addText((t) => t.setPlaceholder("Label").setValue(f.label).onChange(async (v) => {
						f.label = v;
						await this.save();
					}))
					.addDropdown((d) =>
						d.addOptions({ text: "Text", color: "Colour", enum: "Choice", textarea: "Long text" }).setValue(f.type).onChange(async (v) => {
							f.type = v as FieldType;
							await this.save(true);
						})
					);
				if (f.type === "enum")
					row.addText((t) => t.setPlaceholder("Option A, Option B").setValue(f.options ?? "").onChange(async (v) => {
						f.options = v;
						await this.save();
					}));
				row
					.addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(async () => {
						if (i === 0) return;
						[list[i - 1], list[i]] = [list[i], list[i - 1]];
						await this.save(true);
					}))
					.addExtraButton((b) => b.setIcon("arrow-down").setTooltip("Move down").setDisabled(i === list.length - 1).onClick(async () => {
						if (i === list.length - 1) return;
						[list[i + 1], list[i]] = [list[i], list[i + 1]];
						await this.save(true);
					}))
					.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => {
						list.splice(i, 1);
						await this.save(true);
					}));
			});
			new Setting(containerEl).addButton((b) =>
				b.setButtonText(`Add ${GROUP_TITLES[g].toLowerCase()} field`).onClick(async () => {
					list.push({ key: `field${list.length + 1}`, label: "New field", type: "text" });
					await this.save(true);
				})
			);
		}

		// Cities
		new Setting(containerEl).setName("City sheet").setHeading();
		containerEl.createDiv({ cls: "setting-item-description", text: "\"At a glance\" rows read these frontmatter keys. Values can be text, [[links]], lists or calendar dates ({ month, year })." });
		this.fieldList(containerEl, s.cityFields);
		new Setting(containerEl).setName("Tables").setClass("ct-subheading");
		containerEl.createDiv({ cls: "setting-item-description", text: "Each table reads a frontmatter list of objects, e.g. districts: [{ name, character, notes }]. Columns are the object keys, comma-separated." });
		this.tableList(containerEl, s.cityTables, { key: "trade", title: "Trade", columns: "good, partner, notes" });

		// Species
		new Setting(containerEl).setName("Species sheet").setHeading();
		containerEl.createDiv({ cls: "setting-item-description", text: "\"At a glance\" rows read these frontmatter keys, like the city sheet." });
		this.fieldList(containerEl, s.speciesFields);
		new Setting(containerEl).setName("Sections").setClass("ct-subheading");
		containerEl.createDiv({ cls: "setting-item-description", text: "Long-text sections, stored as \"## \" headings in the note body. The species editor shows one box per section, in this order." });
		this.sectionList(containerEl, s.speciesSections);
		new Setting(containerEl).setName("Tables").setClass("ct-subheading");
		this.tableList(containerEl, s.speciesTables, { key: "predators", title: "Predators", columns: "name, threat, notes" });

		// Factions
		new Setting(containerEl).setName("Faction sheet").setHeading();
		containerEl.createDiv({ cls: "setting-item-description", text: "\"At a glance\" rows read these frontmatter keys, like the city sheet. Goals, territory, allies, rivals, power and reputation have their own sections." });
		this.fieldList(containerEl, s.factionFields);
		new Setting(containerEl).setName("Tables").setClass("ct-subheading");
		this.tableList(containerEl, s.factionTables, { key: "holdings", title: "Holdings", columns: "name, kind, notes" });

		// Custom types
		new Setting(containerEl).setName("Custom types").setHeading();
		containerEl.createDiv({
			cls: "setting-item-description",
			text: "Your own note types, like artifacts, religions or languages. Each one gets a sheet with a gallery, an overview, \"At a glance\" fields, \"## \" sections and tables, plus a wizard and a \"Create new …\" command. A note uses a type when its frontmatter has that type.",
		});
		s.customTypes.forEach((t) => this.customTypeSettings(containerEl, t));
		let preset = CUSTOM_TYPE_PRESETS.find((p) => !s.customTypes.some((t) => t.type === p.type))?.type ?? "";
		new Setting(containerEl)
			.setName("Add type")
			.setDesc("Start from a preset or a blank type. Everything can be changed afterwards.")
			.addDropdown((d) => {
				for (const p of CUSTOM_TYPE_PRESETS) d.addOption(p.type, p.label);
				d.addOption("", "Blank");
				d.setValue(preset).onChange((v) => (preset = v));
			})
			.addButton((b) =>
				b.setButtonText("Add").setCta().onClick(async () => {
					const base = CUSTOM_TYPE_PRESETS.find((p) => p.type === preset);
					const t: CustomType = base ? JSON.parse(JSON.stringify(base)) : blankCustomType(s.customTypes.length + 1);
					while (s.customTypes.some((x) => x.type === t.type)) t.type += "2";
					s.customTypes.push(t);
					this.openTypes.add(t);
					this.plugin.syncCustomCommands();
					await this.save(true);
				})
			);

		// Attributes
		new Setting(containerEl).setName("Attributes (creation wizard)").setHeading();
		const num = (name: string, desc: string, key: "pointPool" | "statBase" | "statMin" | "statMax") =>
			new Setting(containerEl).setName(name).setDesc(desc).addText((t) => {
				t.inputEl.type = "number";
				t.setValue(String(s[key])).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n)) {
						s[key] = n;
						await this.save();
					}
				});
			});
		num("Point pool", "Points to spend above the base.", "pointPool");
		num("Base value", "Every stat starts here.", "statBase");
		num("Minimum", "Lowest allowed stat.", "statMin");
		num("Maximum", "Highest allowed stat; also the radar's outer ring.", "statMax");

		// Canvas
		new Setting(containerEl).setName("Canvas").setHeading();
		new Setting(containerEl)
			.setName("Reverse sync from canvas (experimental)")
			.setDesc("When you drag an event card sideways in the synced canvas and it saves, re-date the event note. Only cards created by \"Sync timeline to canvas\" are affected.")
			.addToggle((t) =>
				t.setValue(s.canvasReverseSync).onChange(async (v) => {
					s.canvasReverseSync = v;
					await this.save();
				})
			);
	}

	/** One collapsible block per custom type: identity, fields, sections and tables. */
	private customTypeSettings(parent: HTMLElement, t: CustomType): void {
		const types = this.plugin.settings.customTypes;
		const details = parent.createEl("details", { cls: "ct-type-settings" });
		details.open = this.openTypes.has(t);
		details.addEventListener("toggle", () => (details.open ? this.openTypes.add(t) : this.openTypes.delete(t)));
		const summary = details.createEl("summary", { cls: "ct-type-summary" });
		setIcon(summary.createSpan({ cls: "ct-type-icon" }), t.icon || "file-text");
		summary.createSpan({ text: t.label || t.type });
		summary.createSpan({ cls: "ct-faint ct-12 ct-mono", text: `type: ${t.type}` });

		const problem = !t.type
			? "A type is required."
			: BUILT_IN_TYPES.includes(t.type)
				? `"${t.type}" is a built-in type; pick another name.`
				: types.filter((x) => x.type === t.type).length > 1
					? `Another custom type already uses "${t.type}".`
					: "";
		const typeSetting = new Setting(details)
			.setName("Type")
			.setDesc("The frontmatter value, e.g. type: artifact. Renaming it doesn't update existing notes.")
			.addText((x) =>
				x.setPlaceholder("artifact").setValue(t.type).onChange(async (v) => {
					t.type = v.trim().toLowerCase().replace(/s+/g, "_");
					this.plugin.syncCustomCommands();
					await this.save();
				})
			);
		if (problem) typeSetting.descEl.createDiv({ cls: "ct-error", text: problem });
		const text = (name: string, desc: string, key: "label" | "icon" | "folder" | "tagline", placeholder: string) =>
			new Setting(details).setName(name).setDesc(desc).addText((x) =>
				x.setPlaceholder(placeholder).setValue(t[key]).onChange(async (v) => {
					t[key] = key === "tagline" ? v.trim().replace(/s+/g, "_") : v.trim();
					await this.save();
				})
			);
		text("Name", "Singular, used in titles and buttons.", "label", "Artifact");
		text("Icon", "A Lucide icon name, e.g. gem, sun, languages, scroll.", "icon", "file-text");
		text("Folder", "Where \"Create new …\" saves these notes.", "folder", "Artifacts");
		text("Tagline key", "Frontmatter key shown in quotes under the name, e.g. epithet or creed. Leave empty for none.", "tagline", "epithet");

		new Setting(details).setName("At a glance").setClass("ct-subheading");
		this.fieldList(details, t.fields);
		new Setting(details).setName("Sections").setClass("ct-subheading");
		this.sectionList(details, t.sections);
		new Setting(details).setName("Tables").setClass("ct-subheading");
		this.tableList(details, t.tables, { key: "items", title: "Items", columns: "name, kind, notes" });

		new Setting(details).addButton((b) =>
			b.setButtonText(`Remove ${t.label || t.type}`).setWarning().onClick(async () => {
				types.splice(types.indexOf(t), 1);
				this.openTypes.delete(t);
				await this.save(true);
			})
		);
	}

	/** Reorderable "## " section headings. */
	private sectionList(el: HTMLElement, secs: string[]): void {
		secs.forEach((title, i) => {
			new Setting(el)
				.setClass("ct-compact-setting")
				.addText((t) => t.setPlaceholder("Heading").setValue(title).onChange(async (v) => {
					secs[i] = v.trim();
					await this.save();
				}))
				.addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(async () => {
					if (i === 0) return;
					[secs[i - 1], secs[i]] = [secs[i], secs[i - 1]];
					await this.save(true);
				}))
				.addExtraButton((b) => b.setIcon("arrow-down").setTooltip("Move down").setDisabled(i === secs.length - 1).onClick(async () => {
					if (i === secs.length - 1) return;
					[secs[i + 1], secs[i]] = [secs[i], secs[i + 1]];
					await this.save(true);
				}))
				.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => {
					secs.splice(i, 1);
					await this.save(true);
				}));
		});
		new Setting(el).addButton((b) =>
			b.setButtonText("Add section").onClick(async () => {
				secs.push("New section");
				await this.save(true);
			})
		);
	}

	/** Reorderable "At a glance" rows: frontmatter key + label. */
	private fieldList(el: HTMLElement, list: CityField[]): void {
		list.forEach((f, i) => {
			new Setting(el)
				.setClass("ct-compact-setting")
				.addText((t) => t.setPlaceholder("key").setValue(f.key).onChange(async (v) => {
					f.key = v.trim().replace(/s+/g, "_");
					await this.save();
				}))
				.addText((t) => t.setPlaceholder("Label").setValue(f.label).onChange(async (v) => {
					f.label = v;
					await this.save();
				}))
				.addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(async () => {
					if (i === 0) return;
					[list[i - 1], list[i]] = [list[i], list[i - 1]];
					await this.save(true);
				}))
				.addExtraButton((b) => b.setIcon("arrow-down").setTooltip("Move down").setDisabled(i === list.length - 1).onClick(async () => {
					if (i === list.length - 1) return;
					[list[i + 1], list[i]] = [list[i], list[i + 1]];
					await this.save(true);
				}))
				.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => {
					list.splice(i, 1);
					await this.save(true);
				}));
		});
		new Setting(el).addButton((b) =>
			b.setButtonText("Add field").onClick(async () => {
				list.push({ key: `field${list.length + 1}`, label: "New field" });
				await this.save(true);
			})
		);
	}

	/** Frontmatter tables: key, title and comma-separated columns. */
	private tableList(el: HTMLElement, list: CityTable[], example: CityTable): void {
		list.forEach((t, i) => {
			new Setting(el)
				.setClass("ct-compact-setting")
				.addText((x) => x.setPlaceholder("key").setValue(t.key).onChange(async (v) => {
					t.key = v.trim();
					await this.save();
				}))
				.addText((x) => x.setPlaceholder("Title").setValue(t.title).onChange(async (v) => {
					t.title = v;
					await this.save();
				}))
				.addText((x) => x.setPlaceholder("name, kind, notes").setValue(t.columns).onChange(async (v) => {
					t.columns = v;
					await this.save();
				}))
				.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => {
					list.splice(i, 1);
					await this.save(true);
				}));
		});
		new Setting(el).addButton((b) =>
			b.setButtonText("Add table").onClick(async () => {
				list.push({ ...example });
				await this.save(true);
			})
		);
	}
}
