# Story Characters & Timeline

An Obsidian plugin for novelists and worldbuilders. It provides character sheets, a character creation wizard, and an in-world timeline. All data lives in note frontmatter, so it stays plain Markdown, works with Dataview, and syncs.

![Character sheet, Full layout](docs/screenshots/character-sheet-full.png)

## Features

### Character sheet

Notes with `type: character` open as a sheet. The **Full** layout has three columns (portrait, vitals, traits | properties, stat radar, backstory | goals, relationships, inventory, linked notes) plus a Description section. The **Dossier** layout has a header and tabs. Pick the default in settings or switch per view with the layout button.

- Click a vital's value to edit it (`34 / 40`). Click a goal's checkbox to toggle it. Click the portrait to pick an image from the vault.
- **Edit** switches to the Markdown editor. Use the person icon in the editor's header to go back to the sheet.

| Full layout: Description section | Dossier layout |
| --- | --- |
| ![Description section of the Full layout](docs/screenshots/character-sheet-description.png) | ![Dossier layout with tabs](docs/screenshots/character-sheet-dossier.png) |

### City sheet

Notes with `type: city` open as a sheet: the name and motto, a gallery of 3–5 images (the first one larger; click an image to view it full size, use the arrow keys to browse, hover to remove one, or click an empty slot to add one), the description from the note body, an "At a glance" table, configurable tables (districts and landmarks by default), notable people, and the events that take place there. Create one with **Create new city** or the castle ribbon icon.

![City sheet with image gallery and At a glance table](docs/screenshots/city-sheet.png)

| Tables, notable people and events | New city dialog |
| --- | --- |
| ![District and landmark tables, notable people and events here](docs/screenshots/city-sheet-tables.png) | ![New city dialog](docs/screenshots/city-modal.png) |

### Creation wizard

Use the **Create new character** command or the ribbon icon. It has six steps: Identity, Attributes (point-buy, base 8, range 3–18, pool 26), Description, Traits, Relationships and Lore. It writes `Characters/<Name>.md`.

| Identity | Attributes |
| --- | --- |
| ![Wizard step 1: Identity](docs/screenshots/wizard-identity.png) | ![Wizard step 2: Attributes with point-buy and radar](docs/screenshots/wizard-attributes.png) |
| **Description** | **Traits** |
| ![Wizard step 3: Description](docs/screenshots/wizard-description.png) | ![Wizard step 4: Traits](docs/screenshots/wizard-traits.png) |
| **Relationships** | **Lore** |
| ![Wizard step 5: Relationships](docs/screenshots/wizard-relationships.png) | ![Wizard step 6: Lore](docs/screenshots/wizard-lore.png) |

### Timeline

Use the **Open story timeline** command. It shows events on your custom calendar, with one lane per character plus World, Era/Year/Month zoom, drag to re-date, and drag a bar's right edge to change its end. Double-click an event to open it. Double-click an empty spot in a lane to create an event there.

![Story timeline with character lanes](docs/screenshots/timeline.png)

New events can also be created with **Create new timeline event** or the **+ Event** button:

<img src="docs/screenshots/event-modal.png" alt="New event dialog" width="600">

### Canvas sync

The **Sync timeline to canvas** command writes `<Events folder>/<Timeline name>.canvas` in the open JSON Canvas format. Re-syncing keeps the positions you set by hand and only moves a card when its date changed. Optional reverse sync is in settings (experimental): drag a card sideways in the canvas to re-date the event.

![Timeline synced to an Obsidian canvas](docs/screenshots/canvas-sync.png)

## Data model

See `example-vault/` for complete samples. Character notes use `type: character` and these keys: `name`, `quote`, `portrait`, `status`, `role`, `ancestry`, `born: { month, year }`, `affiliation`, `faction`, `faction_tag`, `story_role`, `vitals`, `stats`, `traits`, `values`, `weaknesses`, `goals`, `relationships`, `inventory` and `description`. Event notes look like this:

```yaml
---
type: event
title: Betrayal at Varn
tl-start: { month: 8, year: 1043 }
tl-end: { month: 2, year: 1045 }   # omit for point events
lane: "[[Maren Voss]]"             # or World
category: conflict
characters: ["[[Maren Voss]]"]
---
```

City notes look like this (see `example-vault/Places/Kesthaven.md`):

```yaml
---
type: city
name: Kesthaven
motto: "The tide keeps no ledger."
images: ["[[harbour.png]]", "[[night.png]]", "[[storm.png]]"]
region: "[[Saltreach]]"
founded: { month: 3, year: 612 }
population: 18400
ruler: "[[Corvin Dace]]"
languages: [Common, Saltreach cant]
districts:
  - { name: Harbour Ward, character: Docks and chandlers, notes: "Where [[Maren Voss]] grew up" }
landmarks:
  - { name: The Lantern Spire, kind: Lighthouse, notes: Dark since 1042 }
notable_people: ["[[Old Tamsin]]"]   # optional; characters whose notes link here are added automatically
---
```

Events show up under "Events here" when they have `location: "[[Kesthaven]]"`.

POV counts come from notes in the manuscript folder that have `pov: "[[Character]]"`.

## Settings

- Folders: characters, events, cities, manuscript
- Calendar: era name and abbreviation, the 12 month names, the current story year
- Event categories: key, label and theme colour
- Description fields per group: add, remove, reorder, and set the type (text, colour, choice, long text)
- City sheet: the "At a glance" rows (key + label, reorderable) and the tables (frontmatter key, title, columns)
- Attribute rules
- Default sheet layout
- Auto-open character notes as sheets

| General | Categories and description fields | City sheet |
| --- | --- | --- |
| ![Settings: folders, sheet layout and calendar](docs/screenshots/settings-general.png) | ![Settings: event categories and description fields](docs/screenshots/settings-categories-fields.png) | ![Settings: city sheet rows and tables](docs/screenshots/settings-city-sheet.png) |

## Development

```bash
npm install
npm run build              # type-check + bundle to main.js
npm run dev                # watch mode
npm run install-example    # build and copy into example-vault/
npm run install-vault -- "C:/path/to/YourVault"   # copy a build into any vault
```

Then enable **Story Characters & Timeline** under Settings → Community plugins.

Colours come only from Obsidian theme variables, so the plugin follows light and dark themes. All classes use the `ct-` prefix.
