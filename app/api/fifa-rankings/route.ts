import { NextResponse } from "next/server";
import { normalizeCountryName } from "@/lib/country-utils";
import { fifaWorldRankings } from "@/lib/fifa-rankings";

export const revalidate = 43_200;

const FIFA_RANKINGS_URL = "https://inside.fifa.com/fifa-world-ranking/men";
const FIFA_RANKINGS_API_URL = "https://api.fifa.com/api/v3/rankings/?gender=1&count=250";
const fifaRankingAliases: Record<string, string> = {
  "cabo-verde": "cape-verde",
  "congo-dr": "dr-congo",
  "cote-d-ivoire": "ivory-coast",
  "cote-divoire": "ivory-coast",
  "korea-republic": "south-korea",
  "republic-of-korea": "south-korea",
  "bosnia-and-herzegovina": "bosnia-herzegovina",
  "united-states": "usa",
  "united-states-of-america": "usa",
};

type RankingsResponse = {
  rankings: Record<string, number>;
  source: string;
  updatedAt: string;
};

export async function GET() {
  try {
    const response = await fetch(FIFA_RANKINGS_API_URL, {
      next: { revalidate },
      headers: {
        "User-Agent": "FIFHUB rankings updater",
      },
    });

    if (!response.ok) {
      throw new Error(`FIFA ranking request failed with ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const rankings = parseFifaApiRankings(payload);

    return NextResponse.json<RankingsResponse>({
      rankings,
      source: FIFA_RANKINGS_API_URL,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    try {
      const pageResponse = await fetch(FIFA_RANKINGS_URL, {
        next: { revalidate },
        headers: {
          "User-Agent": "FIFHUB rankings updater",
        },
      });
      if (!pageResponse.ok) throw new Error(`FIFA ranking page request failed with ${pageResponse.status}`);
      const html = await pageResponse.text();
      const rankings = parseFifaRankings(html);

      return NextResponse.json<RankingsResponse>({
        rankings,
        source: FIFA_RANKINGS_URL,
        updatedAt: new Date().toISOString(),
      });
    } catch (pageError) {
      console.warn("Using fallback FIFA rankings.", { error, pageError });
    }

    return NextResponse.json<RankingsResponse>({
      rankings: fifaWorldRankings,
      source: "fallback",
      updatedAt: new Date().toISOString(),
    });
  }
}

function parseFifaApiRankings(payload: unknown) {
  const results = payload && typeof payload === "object" ? (payload as { Results?: unknown }).Results : null;
  if (!Array.isArray(results)) {
    throw new Error("FIFA rankings API payload did not contain Results.");
  }

  const rankings: Record<string, number> = {};
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const rank = toRank(record.Rank);
    const countryName = fifaTeamName(record.TeamName) ?? textValue(record.IdCountry);
    if (rank == null || !countryName) continue;
    rankings[rankingNationId(countryName)] = rank;
  }

  if (Object.keys(rankings).length < 40) {
    throw new Error("FIFA rankings API payload did not contain enough teams.");
  }

  return rankings;
}

function fifaTeamName(value: unknown) {
  if (!Array.isArray(value)) return null;
  const english = value.find((item) => {
    if (!item || typeof item !== "object") return false;
    return String((item as Record<string, unknown>).Locale ?? "").toLowerCase().startsWith("en");
  });
  const row = (english ?? value[0]) as Record<string, unknown> | undefined;
  return textValue(row?.Description);
}

function parseFifaRankings(html: string) {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  const end = start >= 0 ? html.indexOf("</script>", start) : -1;
  if (start < 0 || end < 0) {
    throw new Error("FIFA rankings JSON payload was not found.");
  }

  const payload = JSON.parse(html.slice(start + marker.length, end)) as unknown;
  const rows: Array<{ nationId: string; rank: number }> = [];
  collectRankingRows(payload, rows);

  const rankings: Record<string, number> = {};
  for (const row of rows) {
    if (!rankings[row.nationId] || row.rank < rankings[row.nationId]) {
      rankings[row.nationId] = row.rank;
    }
  }

  if (Object.keys(rankings).length < 40) {
    throw new Error("FIFA rankings payload did not contain enough teams.");
  }

  return rankings;
}

function collectRankingRows(value: unknown, rows: Array<{ nationId: string; rank: number }>) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) collectRankingRows(item, rows);
    return;
  }

  const record = value as Record<string, unknown>;
  const rank = extractRank(record);
  const countryName = extractCountryName(record);
  if (rank != null && countryName) {
    rows.push({ nationId: rankingNationId(countryName), rank });
  }

  for (const child of Object.values(record)) {
    collectRankingRows(child, rows);
  }
}

function extractRank(record: Record<string, unknown>): number | null {
  for (const key of ["rank", "ranking", "position", "rankPosition"]) {
    const rank = toRank(record[key]);
    if (rank != null) return rank;
  }

  return null;
}

function toRank(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 250) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d]/g, ""));
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 250) return parsed;
  }

  return null;
}

function extractCountryName(record: Record<string, unknown>): string | null {
  for (const key of ["countryName", "teamName", "name", "displayName"]) {
    const value = textValue(record[key]);
    if (value) return value;
  }

  for (const key of ["country", "team", "memberAssociation", "association"]) {
    const nested = record[key];
    if (!nested || typeof nested !== "object") continue;
    const value = extractCountryName(nested as Record<string, unknown>);
    if (value) return value;
  }

  return null;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && /[A-Za-z]/.test(value)) return value;

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["name", "fullName", "displayName", "en"]) {
      const nested = record[key];
      if (typeof nested === "string" && /[A-Za-z]/.test(nested)) return nested;
    }
  }

  return null;
}

function rankingNationId(countryName: string) {
  const normalized = normalizeCountryName(countryName);
  return fifaRankingAliases[normalized] ?? normalized;
}
