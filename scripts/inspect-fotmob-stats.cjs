const matchId = process.argv[2];

if (!matchId) {
  throw new Error("Usage: node scripts/inspect-fotmob-stats.cjs <fotmob-match-id>");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const response = await fetch(`https://www.fotmob.com/api/data/matchDetails?matchId=${matchId}`, {
    headers: {
      accept: "application/json",
      "user-agent": "fifhub-live-score-updater/1.0",
    },
  });

  if (!response.ok) throw new Error(`FotMob returned ${response.status}`);

  const details = await response.json();
  const rows = collectFotmobStatRows(details?.content?.stats);
  const xg = statPair(rows, ["expectedgoalsxg", "expectedgoals", "xg"]);
  const passes = statPair(rows, ["passes", "totalpasses", "accuratepasses"]);
  const passingAccuracy = percentPair(rows, ["passingaccuracy", "passaccuracy", "accuratepasses"]);

  console.log(JSON.stringify({
    matchId,
    rowCount: rows.length,
    matchedRows: {
      xg: describeRow(findFotmobRow(rows, ["expectedgoalsxg", "expectedgoals", "xg"])),
      passes: describeRow(findFotmobRow(rows, ["passes", "totalpasses", "accuratepasses"])),
      passingAccuracy: describeRow(findFotmobRow(rows, ["passingaccuracy", "passaccuracy", "accuratepasses"])),
    },
    mapped: { xg, passes, passingAccuracy },
    firstRows: rows.slice(0, 12).map(describeRow),
  }, null, 2));
}

function collectFotmobStatRows(value, rows = []) {
  if (!value || typeof value !== "object") return rows;

  if (Array.isArray(value)) {
    for (const item of value) collectFotmobStatRows(item, rows);
    return rows;
  }

  const title = value.title ?? value.name ?? value.key;
  if (
    title &&
    Array.isArray(value.stats) &&
    value.stats.length >= 2 &&
    value.stats.some((item) => item != null) &&
    !value.stats.some((item) => item && typeof item === "object")
  ) {
    rows.push(value);
  }

  for (const item of Object.values(value)) {
    collectFotmobStatRows(item, rows);
  }

  return rows;
}

function statPair(rows, keys) {
  return [fotmobStat(rows, keys), fotmobStat(rows, keys, "away")];
}

function percentPair(rows, keys) {
  return [fotmobPercentage(rows, keys), fotmobPercentage(rows, keys, "away")];
}

function fotmobStat(rows, keys, side = "home") {
  const row = findFotmobRow(rows, keys);
  if (!row) return null;
  const index = side === "away" ? 1 : 0;
  return parseFotmobStatValue(row.stats[index]);
}

function fotmobPercentage(rows, keys, side = "home") {
  const row = findFotmobRow(rows, keys);
  if (!row) return null;
  const index = side === "away" ? 1 : 0;
  return parseFotmobPercentage(row.stats[index]);
}

function findFotmobRow(rows, keys) {
  for (const key of keys.map(normalizeFotmobStatKey)) {
    const row = rows.find((item) => normalizeFotmobStatKey(item.key ?? item.title ?? item.name) === key);
    if (row) return row;
  }

  return null;
}

function normalizeFotmobStatKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseFotmobStatValue(value) {
  if (value == null) return null;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFotmobPercentage(value) {
  if (value == null) return null;
  const percentMatch = String(value).match(/\((\d+(?:\.\d+)?)%\)|(\d+(?:\.\d+)?)%/);
  if (percentMatch) {
    const parsed = Number.parseFloat(percentMatch[1] ?? percentMatch[2]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return parseFotmobStatValue(value);
}

function describeRow(row) {
  if (!row) return null;
  return {
    key: row.key,
    normalizedKey: normalizeFotmobStatKey(row.key ?? row.title ?? row.name),
    title: row.title,
    stats: row.stats,
  };
}
