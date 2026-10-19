// Usage: node scripts/copy-to-vault.mjs <path-to-vault>
import fs from "fs";
import path from "path";

const vault = process.argv[2];
if (!vault || !fs.existsSync(vault)) {
	console.error("Pass the path to an Obsidian vault.");
	process.exit(1);
}
const dest = path.join(vault, ".obsidian", "plugins", "worldbuilding");
fs.mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(f, path.join(dest, f));
console.log(`Copied plugin to ${dest}`);
