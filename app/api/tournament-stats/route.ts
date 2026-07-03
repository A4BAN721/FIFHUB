import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 1000;
const FOTMOB_STATS_BASE_URL = "https://www.fotmob.com/api/data/leagueseasondeepstats";
const FOTMOB_WORLD_CUP_PARAMS = {
  id: "77",
  season: "24254",
  type: "players",
};
const FIFA_PLAYER_STATS_PAGE_URL =
  "https://cxm-api.fifa.com/fifaplusweb/api/pages/en/tournaments/mens/worldcup/canadamexicousa2026/statistics/player-statistics?locale=en";
const FIFA_PLAYER_STATS_FALLBACK_SECTION_IDS = ["7J8zkJsvHm00KaQNhGcBCL"];
const FIFA_GAMEDAY_STORIES_BASE_URL = "https://gameday-prod.fifa.mangodev.co.uk/1-0/stories";
const FIFA_WORLD_CUP_SEASON_ID = "285023";
const FIFA_WORLD_CUP_STATS_ENDPOINTS = [
  "https://api.fifa.com/api/v3/statistics/tournament/17/season/285023/playerStatistics?language=en",
  "https://api.fifa.com/api/v3/statistics/tournament/17/season/285023/player?language=en",
];

type EventRow = {
  match_id?: string | null;
  provider?: string | null;
  event_type: string;
  team_name: string | null;
  player_name: string | null;
  assist_player_name: string | null;
  minute?: number | null;
};

type LineupRow = {
  match_id?: string | null;
  lineups: unknown;
};

type FotmobStatRow = {
  id: string | null;
  teamId: string | null;
  playerName: string;
  value: number;
  subValue: number | null;
  rank: number | null;
};

type FifaStatKind = "distance" | "offsides";

type FifaStatRow = {
  id: string | null;
  teamId: string | null;
  teamName: string | null;
  playerName: string;
  value: number;
  rank: number | null;
};

export async function GET() {
  try {
    const supabase = createApiClient();
    const [events, lineupRows, fotmobRatingRows, fotmobMinutesRows, fifaDistanceRows, fifaOffsidesRows] = await Promise.all([
      fetchAllRows<EventRow>((from, to) =>
        supabase
          .from("match_events")
          .select("match_id,provider,event_type,team_name,player_name,assist_player_name,minute")
          .order("match_id", { ascending: true })
          .order("minute", { ascending: true, nullsFirst: false })
          .range(from, to),
      ),
      fetchAllRows<LineupRow>((from, to) =>
        supabase
          .from("live_match_state")
          .select("match_id,lineups")
          .not("lineups", "is", null)
          .range(from, to),
      ),
      fetchFotmobStatRows("rating"),
      fetchFotmobStatRows("mins_played"),
      fetchFifaStatRows("distance"),
      fetchFifaStatRows("offsides"),
    ]);

    return NextResponse.json(
      {
        events,
        lineupRows,
        fotmobRatingRows,
        fotmobMinutesRows,
        fifaDistanceRows,
        fifaOffsidesRows,
        updatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Failed to load tournament stats.", error);
    return NextResponse.json(
      { error: "Failed to load tournament stats." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function fetchFifaStatRows(stat: FifaStatKind): Promise<FifaStatRow[]> {
  try {
    const payloads = await Promise.allSettled([
      ...((await fetchFifaGameDayStatPayloads(stat)).map((payload) => Promise.resolve(payload))),
      ...FIFA_WORLD_CUP_STATS_ENDPOINTS.map((url) => fetchJson(url, `FIFA ${stat} stats`)),
      ...((await fetchFifaPlayerStatsSectionUrls()).map((url) => fetchJson(url, `FIFA ${stat} stats section`))),
    ]);

    const rows = payloads.flatMap((result) =>
      result.status === "fulfilled" ? extractFifaStatRows(result.value, stat) : [],
    );

    return rankExternalRows(dedupeFifaRows(rows));
  } catch (error) {
    console.warn(`Failed to load FIFA ${stat} leaderboard.`, error);
    return [];
  }
}

async function fetchFifaGameDayStatPayloads(stat: FifaStatKind) {
  const classification = stat === "distance" ? "gcp_physical" : "gcp_discipline";
  const payloads: unknown[] = [];

  for (let page = 1; page <= 40; page += 1) {
    const payload = await fetchJson(fifaGameDayStoriesUrl(classification, page), `FIFA GameDay ${classification} page ${page}`).catch(
      () => null,
    );
    if (!payload) break;
    payloads.push(payload);
    if (!fifaPayloadHasResults(payload)) break;
  }

  return payloads;
}

function fifaGameDayStoriesUrl(classification: string, page: number) {
  const url = new URL(FIFA_GAMEDAY_STORIES_BASE_URL);
  url.searchParams.set(
    "query",
    `(and resourceStatus==\`urn:gd:resourceStatus:active\` _externalId~\`urn:gd:story:classification:${classification}:competitionId:${FIFA_WORLD_CUP_SEASON_ID}:(.*):rank_asc:page:${page}$\`)`,
  );
  url.searchParams.set("skip", "0");
  url.searchParams.set("limit", "1");
  url.searchParams.set("sort", "tags.name==urn:gd:tag:story:fifa:column_number:asc");
  return url.toString();
}

function fifaPayloadHasResults(payload: unknown) {
  if (Array.isArray(payload)) return payload.length > 0;
  if (!payload || typeof payload !== "object") return false;
  const entry = payload as Record<string, unknown>;
  return [entry.results, entry.Results, entry.items, entry.Items, entry.stories, entry.Stories, entry.data].some(
    (value) => Array.isArray(value) && value.length > 0,
  );
}

async function fetchFotmobStatRows(stat: "rating" | "mins_played"): Promise<FotmobStatRow[]> {
  try {
    const url = new URL(FOTMOB_STATS_BASE_URL);
    for (const [key, value] of Object.entries(FOTMOB_WORLD_CUP_PARAMS)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("stat", stat);

    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "user-agent": "fifhub-tournament-stats/1.0",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) throw new Error(`FotMob ${stat} stats returned ${response.status}`);
    const payload = (await response.json()) as { statsData?: unknown[] };

    return (payload.statsData ?? [])
      .map((row): FotmobStatRow | null => {
        if (!row || typeof row !== "object") return null;
        const entry = row as {
          id?: number | string | null;
          teamId?: number | string | null;
          name?: string | null;
          rank?: number | null;
          statValue?: { value?: number | string | null } | null;
          substatValue?: { value?: number | string | null } | null;
        };
        const value = Number(entry.statValue?.value);
        const subValue = Number(entry.substatValue?.value);
        if (!entry.name || !Number.isFinite(value)) return null;

        return {
          id: entry.id != null ? String(entry.id) : null,
          teamId: entry.teamId != null ? String(entry.teamId) : null,
          playerName: entry.name,
          value,
          subValue: Number.isFinite(subValue) ? subValue : null,
          rank: Number.isFinite(Number(entry.rank)) ? Number(entry.rank) : null,
        };
      })
      .filter((row): row is FotmobStatRow => row != null);
  } catch (error) {
    console.warn(`Failed to load FotMob ${stat} leaderboard.`, error);
    return [];
  }
}

async function fetchFifaPlayerStatsSectionUrls() {
  const sectionIds = new Set(FIFA_PLAYER_STATS_FALLBACK_SECTION_IDS);

  try {
    const page = (await fetchJson(FIFA_PLAYER_STATS_PAGE_URL, "FIFA player statistics page")) as {
      sections?: Array<{ entryId?: unknown; entryType?: unknown; entryEndpoint?: unknown }>;
    };

    for (const section of page.sections ?? []) {
      const entryId = typeof section.entryId === "string" ? section.entryId : null;
      const entryType = typeof section.entryType === "string" ? section.entryType : "";
      if (entryId && /performer|stat/i.test(entryType)) sectionIds.add(entryId);
    }
  } catch (error) {
    console.warn("Failed to resolve FIFA player statistics page sections.", error);
  }

  return [...sectionIds].flatMap((entryId) => [
    `https://cxm-api.fifa.com/fifaplusweb/api/sections/topPerformerGroup/${entryId}?locale=en`,
    `https://cxm-api.fifa.com/fifaplusweb/api/data/competitionSeasonSummaryData/${entryId}?locale=en`,
  ]);
}

async function fetchJson(url: string, label: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent": "fifhub-tournament-stats/1.0",
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
  return response.json();
}

function extractFifaStatRows(payload: unknown, stat: FifaStatKind): FifaStatRow[] {
  const rows: FifaStatRow[] = [];
  const seen = new WeakSet<object>();
  const statAliases = fifaStatAliases(stat);

  function visit(value: unknown, contextMatchesStat = false) {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) visit(item, contextMatchesStat);
      return;
    }

    const entry = value as Record<string, unknown>;
    const objectMatchesStat = contextMatchesStat || objectMentionsStat(entry, statAliases);
    const playerName = fifaTextValue(
      entry.playerName ??
        entry.PlayerName ??
        entry.name ??
        entry.Name ??
        entry.fullName ??
        entry.FullName ??
        entry.personName ??
        entry.PersonName ??
        entry.player,
    );
    const numericValue = fifaNumericStatValue(entry, statAliases, objectMatchesStat);

    if (playerName && numericValue != null) {
      rows.push({
        id: fifaTextValue(entry.id ?? entry.IdPlayer ?? entry.playerId ?? entry.PlayerId),
        teamId: fifaTextValue(entry.IdTeam ?? entry.teamId ?? entry.TeamId),
        teamName: fifaTextValue(
          entry.teamName ?? entry.TeamName ?? entry.team ?? entry.Team ?? entry.countryName ?? entry.CountryName,
        ),
        playerName,
        value: numericValue,
        rank: fifaNumberValue(entry.rank ?? entry.Rank ?? entry.position ?? entry.Position),
      });
    }

    for (const child of Object.values(entry)) visit(child, objectMatchesStat);
  }

  visit(payload);
  return rows;
}

function fifaStatAliases(stat: FifaStatKind) {
  return stat === "distance"
    ? ["distance", "distancecovered", "distancecoveredm", "totaldistance", "totaldistancecovered", "distancerun"]
    : ["offsides", "offside"];
}

function objectMentionsStat(entry: Record<string, unknown>, aliases: string[]) {
  return Object.entries(entry).some(([key, value]) => {
    const normalizedKey = normalizeStatKey(key);
    if (aliases.includes(normalizedKey)) return true;
    const text = fifaTextValue(value);
    return Boolean(text && aliases.some((alias) => normalizeStatKey(text).includes(alias)));
  });
}

function fifaNumericStatValue(entry: Record<string, unknown>, aliases: string[], contextMatchesStat: boolean) {
  for (const [key, value] of Object.entries(entry)) {
    if (aliases.includes(normalizeStatKey(key))) {
      const directValue = fifaNumberValue(value);
      if (directValue != null) return directValue;
    }
  }

  for (const key of ["value", "Value", "statValue", "StatValue", "total", "Total", "amount", "Amount"]) {
    const value = fifaNumberValue(entry[key]);
    if (value != null && contextMatchesStat) return value;
  }

  return null;
}

function fifaTextValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = fifaTextValue(item);
      if (text) return text;
    }
  }
  if (value && typeof value === "object") {
    const entry = value as Record<string, unknown>;
    return fifaTextValue(entry.Description ?? entry.description ?? entry.Name ?? entry.name ?? entry.DisplayName);
  }
  return null;
}

function fifaNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    const entry = value as Record<string, unknown>;
    return fifaNumberValue(entry.value ?? entry.Value ?? entry.total ?? entry.Total);
  }
  return null;
}

function normalizeStatKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function dedupeFifaRows(rows: FifaStatRow[]) {
  const bestRows = new Map<string, FifaStatRow>();

  for (const row of rows) {
    if (!Number.isFinite(row.value) || row.value <= 0) continue;
    const key = [normalizeStatKey(row.playerName), normalizeStatKey(row.teamName ?? row.teamId ?? "")].join("::");
    const current = bestRows.get(key);
    if (!current || row.value > current.value) bestRows.set(key, row);
  }

  return [...bestRows.values()];
}

function rankExternalRows(rows: FifaStatRow[]) {
  let previousValue = -1;
  let previousRank = 0;

  return rows
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || b.value - a.value)
    .map((row, index) => {
      const rank = row.rank ?? (row.value === previousValue ? previousRank : index + 1);
      previousValue = row.value;
      previousRank = rank;
      return { ...row, rank };
    });
}

async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}
