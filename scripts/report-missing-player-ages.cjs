const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "lib", "world-cup-data.ts"), "utf8");
const ages = {
  ...require(path.join(rootDir, "lib", "player-ages.json")),
  ...require(path.join(rootDir, "lib", "player-age-overrides.json")),
};

const playerNames = [
  ...new Set([...source.matchAll(/\{ name: "([^"]+)"/g)].map((match) => match[1])),
].sort((a, b) => a.localeCompare(b));

const missing = playerNames.filter((name) => ages[name] === undefined);
console.log(`Missing ${missing.length}/${playerNames.length} player ages`);
console.log(missing.join("\n"));
