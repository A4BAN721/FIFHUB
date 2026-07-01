import { normalizeCountryName } from "@/lib/country-utils";
import type { LiveMatch, MatchPhase, MatchStatistics, MatchStatus } from "./types";

type FotmobMatch = {
  id?: number | string;
  home?: { name?: string; score?: number | string; penaltyScore?: number | string; penalty?: number | string };
  away?: { name?: string; score?: number | string; penaltyScore?: number | string; penalty?: number | string };
  homeName?: string;
  awayName?: string;
  time?: string;
  timeTS?: string | number;
  status?: FotmobStatus;
};

type FotmobStatus = {
  utcTime?: string;
  halfs?: {
    firstHalfStarted?: string;
    secondHalfStarted?: string;
  };
  finished?: boolean;
  started?: boolean;
  cancelled?: boolean;
  scoreStr?: string;
  reason?: {
    short?: string;
    long?: string;
  };
  liveTime?: {
    short?: string;
    long?: string;
    addedTime?: number | null;
  };
};

type FotmobLeague = {
  matches?: FotmobMatch[];
};

type CachedRefresh = {
  expiresAt: number;
  match: LiveMatch | null;
};

const cache = new Map<string, CachedRefresh>();
const CACHE_MS = 8_000;
const FOTMOB_BASE_URL = process.env.FOTMOB_API_BASE_URL ?? "https://www.fotmob.com/api/data";

export async function getFotmobLiveRefresh(baseMatch: LiveMatch): Promise<LiveMatch | null> {
  if (!isActiveMatch(baseMatch)) return null;

  const cached = cache.get(baseMatch.matchId);
  if (cached && cached.expiresAt > Date.now()) return cached.match;

  const refreshed = await fetchFotmobLiveRefresh(baseMatch).catch(() => null);
  cache.set(baseMatch.matchId, {
    expiresAt: Date.now() + CACHE_MS,
    match: refreshed,
  });

  return refreshed;
}

async function fetchFotmobLiveRefresh(baseMatch: LiveMatch): Promise<LiveMatch | null> {
  const match = await findFotmobMatch(baseMatch);
  if (!match?.id) return null;

  const details = await fotmobRequest("matchDetails", { matchId: String(match.id) }).catch(() => null);
  const statistics = details ? mapFotmobStatistics(details) : {};
  const score = parseFotmobScore(match);
  const minute = getFotmobMinute(match.status);
  const status = mapFotmobStatus(match.status, minute);
  const phase = mapFotmobPhase(match.status, minute);

  return {
    ...baseMatch,
    status,
    phase,
    homeScore: score.home,
    awayScore: score.away,
    homePenaltyScore: score.homePenalty ?? baseMatch.homePenaltyScore ?? null,
    awayPenaltyScore: score.awayPenalty ?? baseMatch.awayPenaltyScore ?? null,
    minute,
    stoppageMinute: match.status?.liveTime?.addedTime ?? baseMatch.stoppageMinute ?? null,
    startedAt: match.status?.utcTime ?? baseMatch.startedAt ?? null,
    updatedAt: new Date().toISOString(),
    statistics: {
      ...baseMatch.statistics,
      ...statistics,
    },
  };
}

async function findFotmobMatch(baseMatch: LiveMatch): Promise<FotmobMatch | null> {
  for (const date of getFotmobSearchDates(baseMatch)) {
    const response = await fotmobRequest("matches", { date });
    for (const league of (response?.leagues ?? []) as FotmobLeague[]) {
      for (const match of league.matches ?? []) {
        if (isSameFixture(baseMatch, match)) return match;
      }
    }
  }

  return null;
}

async function fotmobRequest(endpoint: string, params: Record<string, string>) {
  const baseUrl = FOTMOB_BASE_URL.endsWith("/") ? FOTMOB_BASE_URL : `${FOTMOB_BASE_URL}/`;
  const url = new URL(endpoint, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent": "fifhub-live-score/1.0",
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) throw new Error(`FotMob ${endpoint} returned ${response.status}`);
  return response.json();
}

function getFotmobSearchDates(match: LiveMatch): string[] {
  const dates = new Set<string>();
  const startedAt = match.startedAt ? Date.parse(match.startedAt) : NaN;
  const baseTime = Number.isFinite(startedAt) ? startedAt : Date.now();

  for (const offset of [-1, 0, 1]) {
    const date = new Date(baseTime + offset * 86_400_000);
    dates.add(date.toISOString().slice(0, 10).replace(/-/g, ""));
  }

  return [...dates];
}

function isSameFixture(baseMatch: LiveMatch, match: FotmobMatch): boolean {
  const home = match.home?.name ?? match.homeName;
  const away = match.away?.name ?? match.awayName;
  if (!home || !away) return false;

  return (
    normalizeTeam(home) === normalizeTeam(baseMatch.homeTeam) &&
    normalizeTeam(away) === normalizeTeam(baseMatch.awayTeam)
  );
}

function normalizeTeam(teamName: string): string {
  return normalizeCountryName(teamName).replace(/[^a-z0-9]/g, "");
}

function parseFotmobScore(match: FotmobMatch) {
  const homeScore = firstFiniteNumber(match.home?.score);
  const awayScore = firstFiniteNumber(match.away?.score);
  const penaltyScore = parsePenaltyScore(
    match.home?.penaltyScore,
    match.away?.penaltyScore,
    match.home?.penalty,
    match.away?.penalty,
    match.status?.scoreStr,
  );

  if (homeScore != null && awayScore != null) {
    return { home: homeScore, away: awayScore, ...penaltyScore };
  }

  const scoreMatch = String(match.status?.scoreStr ?? "").match(/(\d+)\s*-\s*(\d+)/);
  return {
    home: scoreMatch ? Number(scoreMatch[1]) : 0,
    away: scoreMatch ? Number(scoreMatch[2]) : 0,
    ...penaltyScore,
  };
}

function parsePenaltyScore(...values: unknown[]) {
  const home = firstFiniteNumber(values[0], values[2]);
  const away = firstFiniteNumber(values[1], values[3]);
  if (home != null && away != null) return { homePenalty: home, awayPenalty: away };

  const textMatch = String(values[4] ?? "").match(/\((\d+)\s*-\s*(\d+)\)/);
  return textMatch ? { homePenalty: Number(textMatch[1]), awayPenalty: Number(textMatch[2]) } : {};
}

function getFotmobMinute(status?: FotmobStatus) {
  const liveTimeMinute = parseFotmobMinute(status?.liveTime?.short ?? status?.liveTime?.long);
  if (liveTimeMinute != null) return liveTimeMinute;

  const reason = String(status?.reason?.short ?? status?.reason?.long ?? "").toUpperCase();
  if (reason === "HT") return 45;
  if (status?.finished) return 90;
  if (!status?.started) return null;

  const secondHalfStarted = parseFotmobLocalTimestamp(status?.halfs?.secondHalfStarted);
  if (Number.isFinite(secondHalfStarted)) {
    return Math.min(90, Math.max(46, Math.floor((Date.now() - secondHalfStarted) / 60_000) + 46));
  }

  const firstHalfStarted = parseFotmobLocalTimestamp(status?.halfs?.firstHalfStarted);
  if (Number.isFinite(firstHalfStarted)) {
    return Math.min(45, Math.max(1, Math.floor((Date.now() - firstHalfStarted) / 60_000) + 1));
  }

  return null;
}

function parseFotmobMinute(value: unknown) {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function parseFotmobLocalTimestamp(value: unknown) {
  const match = String(value ?? "").match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return NaN;

  const [, day, month, year, hour, minute, second = "0"] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime();

  return Number.isFinite(parsed) ? parsed : NaN;
}

function mapFotmobStatus(status: FotmobStatus | undefined, minute: number | null): MatchStatus {
  const reason = String(status?.reason?.short ?? status?.reason?.long ?? "").toUpperCase();
  if (status?.finished || ["FT", "AET", "PEN"].includes(reason)) return "finished";
  if (reason === "HT") return "half_time";
  if (typeof minute === "number" && minute > 90 && status?.started) return "extra_time";
  if (reason === "ET") return "extra_time";
  if (["P", "PENS", "PENALTIES"].includes(reason)) return "penalties";
  if (status?.started || ["1H", "2H", "LIVE"].includes(reason)) return "live";
  if (status?.cancelled) return "cancelled";
  return "scheduled";
}

function mapFotmobPhase(status: FotmobStatus | undefined, minute: number | null): MatchPhase {
  const reason = String(status?.reason?.short ?? status?.reason?.long ?? "").toUpperCase();
  if (["FT", "AET", "PEN"].includes(reason) || status?.finished) return "full_time";
  if (reason === "HT") return "half_time";
  if (reason === "1H") return "first_half";
  if (reason === "2H") return "second_half";
  if (typeof minute === "number" && minute > 90 && status?.started) return "extra_time";
  if (reason === "ET") return "extra_time";
  if (["P", "PENS", "PENALTIES"].includes(reason)) return "penalties";
  return status?.started ? "second_half" : "pre_match";
}

function mapFotmobStatistics(details: unknown): MatchStatistics {
  const rows = collectFotmobStatRows(getNestedValue(details, ["content", "stats"]));

  return compactObject({
    homeExpectedGoals: fotmobStat(rows, ["expectedgoalsxg", "expectedgoals", "xg"]),
    awayExpectedGoals: fotmobStat(rows, ["expectedgoalsxg", "expectedgoals", "xg"], "away"),
    homeShots: fotmobStat(rows, ["totalshots", "shots"]),
    awayShots: fotmobStat(rows, ["totalshots", "shots"], "away"),
    homeShotsOnTarget: fotmobStat(rows, ["shotsontarget"]),
    awayShotsOnTarget: fotmobStat(rows, ["shotsontarget"], "away"),
    homePasses: fotmobPassCount(rows),
    awayPasses: fotmobPassCount(rows, "away"),
    homePassingAccuracy: fotmobPassAccuracy(rows),
    awayPassingAccuracy: fotmobPassAccuracy(rows, "away"),
    homePossession: fotmobStat(rows, ["ballpossession", "ballpossesion", "possession"]),
    awayPossession: fotmobStat(rows, ["ballpossession", "ballpossesion", "possession"], "away"),
    homeYellowCards: fotmobStat(rows, ["yellowcards", "yellowcard", "yellow"]),
    awayYellowCards: fotmobStat(rows, ["yellowcards", "yellowcard", "yellow"], "away"),
    homeRedCards: fotmobStat(rows, ["redcards", "redcard", "red"]),
    awayRedCards: fotmobStat(rows, ["redcards", "redcard", "red"], "away"),
    homeCorners: fotmobStat(rows, ["corners", "cornerkicks"]),
    awayCorners: fotmobStat(rows, ["corners", "cornerkicks"], "away"),
    homeFouls: fotmobStat(rows, ["foulscommitted", "fouls"]),
    awayFouls: fotmobStat(rows, ["foulscommitted", "fouls"], "away"),
    homeOffsides: fotmobStat(rows, ["offsides", "offside"]),
    awayOffsides: fotmobStat(rows, ["offsides", "offside"], "away"),
  });
}

type FotmobStatRow = {
  key?: string;
  title?: string;
  name?: string;
  stats: unknown[];
};

function collectFotmobStatRows(value: unknown, rows: FotmobStatRow[] = []): FotmobStatRow[] {
  if (!value || typeof value !== "object") return rows;

  if (Array.isArray(value)) {
    for (const item of value) collectFotmobStatRows(item, rows);
    return rows;
  }

  const entry = value as { key?: string; title?: string; name?: string; stats?: unknown[] };
  const title = entry.title ?? entry.name ?? entry.key;
  if (
    title &&
    Array.isArray(entry.stats) &&
    entry.stats.length >= 2 &&
    entry.stats.some((item) => item != null) &&
    !entry.stats.some((item) => item && typeof item === "object")
  ) {
    rows.push(entry as FotmobStatRow);
  }

  for (const item of Object.values(value)) {
    collectFotmobStatRows(item, rows);
  }

  return rows;
}

function fotmobStat(rows: FotmobStatRow[], keys: string[], side = "home") {
  const row = findFotmobRow(rows, keys);
  if (!row) return null;
  const index = side === "away" ? 1 : 0;
  return parseFotmobStatValue(row.stats[index]);
}

function fotmobPassCount(rows: FotmobStatRow[], side = "home") {
  const row = findFotmobRow(rows, ["passes", "totalpasses", "accuratepasses"]);
  if (!row) return null;
  const index = side === "away" ? 1 : 0;
  return parseFotmobStatValue(row.stats[index]);
}

function fotmobPassAccuracy(rows: FotmobStatRow[], side = "home") {
  const row = findFotmobRow(rows, ["passingaccuracy", "passaccuracy", "accuratepasses"]);
  if (!row) return null;
  const index = side === "away" ? 1 : 0;
  return parseFotmobPercentage(row.stats[index]);
}

function findFotmobRow(rows: FotmobStatRow[], keys: string[]) {
  for (const key of keys.map(normalizeFotmobStatKey)) {
    const row = rows.find((item) => normalizeFotmobStatKey(item.key ?? item.title ?? item.name) === key);
    if (row) return row;
  }

  return null;
}

function normalizeFotmobStatKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseFotmobStatValue(value: unknown) {
  if (value == null) return null;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFotmobPercentage(value: unknown) {
  if (value == null) return null;
  const percentMatch = String(value).match(/\((\d+(?:\.\d+)?)%\)|(\d+(?:\.\d+)?)%/);
  if (percentMatch) {
    const parsed = Number.parseFloat(percentMatch[1] ?? percentMatch[2]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return parseFotmobStatValue(value);
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }

  return null;
}

function getNestedValue(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue != null)
  ) as T;
}

function isActiveMatch(match: LiveMatch) {
  return (
    match.status === "live" ||
    match.status === "half_time" ||
    match.status === "extra_time" ||
    match.status === "penalties"
  );
}
