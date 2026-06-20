const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const worldCupDataPath = path.join(rootDir, "lib", "world-cup-data.ts");
const outputPath = path.join(rootDir, "lib", "player-ages.json");
const asOfDate = new Date("2026-06-20T00:00:00Z");
const requestHeaders = {
  "user-agent": "FIFHUB26 player age updater (local development)",
};

function getAgeFromDob(dobValue) {
  const dob = new Date(dobValue);
  if (Number.isNaN(dob.getTime())) return null;

  let age = asOfDate.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = asOfDate.getUTCMonth() - dob.getUTCMonth();
  const dayDelta = asOfDate.getUTCDate() - dob.getUTCDate();

  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
    age -= 1;
  }

  return age;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sparqlString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"@en`;
}

function wikidataEntity(value) {
  return `wd:${value.replace(/^.*\//, "")}`;
}

function getSearchTerms(name) {
  const terms = new Set([name]);
  terms.add(name.replace(/\bJr\.$/i, "").trim());
  terms.add(name.replace(/\bJúnior$/i, "Junior").trim());
  terms.add(name.replace(/\bMoraes$/i, "").trim());
  terms.add(name.replace(/\bLuiz$/i, "").trim());
  terms.add(name.replace(/\bSantos$/i, "").trim());
  terms.add(name.replace(/4/g, "a"));
  terms.add(name.replace(/4/g, "l"));
  return [...terms].filter(Boolean);
}

async function fetchJson(url, options = {}) {
  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(url, {
      ...options,
      headers: {
        ...requestHeaders,
        ...options.headers,
      },
    });

    if (response.ok) break;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const backoffMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : attempt * 4000;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  if (!response?.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function querySparql(query) {
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");

  return fetchJson(url, {
    headers: {
      accept: "application/sparql-results+json",
    },
  });
}

async function queryExactAges(names) {
  const values = names.map(sparqlString).join(" ");
  const query = `
    SELECT ?name ?player ?playerLabel ?dob WHERE {
      VALUES ?name { ${values} }
      ?player rdfs:label ?name.
      ?player wdt:P569 ?dob.
      ?player wdt:P106/wdt:P279* wd:Q937857.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
  `;

  const data = await querySparql(query);
  return data.results.bindings;
}

async function searchWikidataEntities(term) {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "8");
  url.searchParams.set("search", term);

  const data = await fetchJson(url, {
    headers: {
      accept: "application/json",
    },
  });

  return data.search ?? [];
}

async function queryCandidateAges(candidateIds) {
  if (candidateIds.length === 0) return [];

  const values = candidateIds.map(wikidataEntity).join(" ");
  const query = `
    SELECT ?player ?dob WHERE {
      VALUES ?player { ${values} }
      ?player wdt:P569 ?dob.
      ?player wdt:P106/wdt:P279* wd:Q937857.
    }
  `;

  const data = await querySparql(query);
  return data.results.bindings;
}

async function queryFallbackAge(name) {
  const candidatesById = new Map();

  for (const term of getSearchTerms(name)) {
    const candidates = await searchWikidataEntities(term);
    for (const candidate of candidates) {
      const description = candidate.description ?? "";
      if (!/football|soccer/i.test(description)) continue;
      candidatesById.set(candidate.id, candidate);
    }

    if (candidatesById.size > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  const candidateIds = [...candidatesById.keys()];
  const bindings = await queryCandidateAges(candidateIds);
  const firstMatch = bindings.find((binding) => {
    const id = binding.player?.value?.replace(/^.*\//, "");
    return id && candidatesById.has(id);
  });

  const age = getAgeFromDob(firstMatch?.dob?.value);
  return age;
}

async function main() {
  const fallbackOnly = process.argv.includes("--fallback-only");
  const source = fs.readFileSync(worldCupDataPath, "utf8");
  const playerNames = [
    ...new Set([...source.matchAll(/\{ name: "([^"]+)"/g)].map((match) => match[1])),
  ].sort((a, b) => a.localeCompare(b));

  const ages = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, "utf8"))
    : {};

  if (!fallbackOnly) {
    const batches = chunk(playerNames, 20);

    for (const [batchIndex, batch] of batches.entries()) {
      console.log(`Fetching age batch ${batchIndex + 1}/${batches.length} (${batch.length} names)...`);
      const bindings = await queryExactAges(batch);

      for (const binding of bindings) {
        const name = binding.name?.value;
        const age = getAgeFromDob(binding.dob?.value);
        if (!name || age === null) continue;
        ages[name] ??= age;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const unmatchedNames = playerNames.filter((name) => ages[name] === undefined);
  console.log(`Running fallback search for ${unmatchedNames.length} unmatched names...`);

  for (const [index, name] of unmatchedNames.entries()) {
    if (index > 0 && index % 10 === 0) {
      console.log(`Fallback progress ${index}/${unmatchedNames.length}...`);
    }

    try {
      const age = await queryFallbackAge(name);
      if (age !== null && age !== undefined) {
        ages[name] = age;
      }
    } catch (error) {
      console.warn(`Could not resolve age for ${name}: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(ages, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(ages).length}/${playerNames.length} player ages to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
