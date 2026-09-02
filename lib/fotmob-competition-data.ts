import "server-only";

import type {
  ClubCompetitionId,
  CompetitionFixture,
  CompetitionOverview,
  CompetitionStanding,
  CompetitionStatCategory,
  CompetitionStatRow,
  CompetitionStats,
  FotmobTeam,
  SquadPlayer,
  TeamSquad,
} from "@/lib/fotmob-competition-types";

const FOTMOB_API_URL = process.env.FOTMOB_API_BASE_URL ?? "https://www.fotmob.com/api/data";
const CACHE_SECONDS = 300;

export const FOTMOB_COMPETITIONS: Record<ClubCompetitionId, number> = {
  "premier-league": 47,
  "champions-league": 42,
  "la-liga": 87,
  bundesliga: 54,
  "ligue-1": 53,
  "serie-a": 55,
  "europa-league": 73,
};

const PENDING_SQUAD_TEAM_IDS = new Set(["951893", "9728"]);

const requestedStats = [
  ["goals", "Goals", "number"],
  ["goal_assist", "Assists", "number"],
  ["_goals_and_goal_assist", "Goals + assists", "number"],
  ["mins_played", "Minutes played", "number"],
  ["phys_tdc", "Distance covered", "distance"],
  ["rating", "Average rating", "rating"],
  ["yellow_card", "Yellow cards", "number"],
  ["red_card", "Red cards", "number"],
  ["offsides", "Offsides", "number"],
] as const;

type JsonObject = Record<string, unknown>;

export function isClubCompetitionId(value: string): value is ClubCompetitionId {
  return value in FOTMOB_COMPETITIONS;
}

export async function getCompetitionOverview(competitionId: ClubCompetitionId): Promise<CompetitionOverview> {
  const payload = await fetchLeague(competitionId);
  const tableRows = extractTableRows(payload);
  const fixtures = extractFixtures(payload);
  const teams = collectTeams(tableRows, fixtures);

  return {
    competitionId,
    name: text(object(payload.details).name) ?? competitionId,
    season: text(payload.currentSeason) ?? text(object(payload.details).selectedSeason) ?? text(array(payload.allAvailableSeasons)[0]) ?? "Current season",
    teams,
    fixtures,
    standings: tableRows.map(mapStanding).filter((row): row is CompetitionStanding => row != null),
    updatedAt: new Date().toISOString(),
  };
}

export async function getTeamSquad(competitionId: ClubCompetitionId, teamId: string): Promise<TeamSquad> {
  const overview = await getCompetitionOverview(competitionId);
  const team = overview.teams.find((entry) => entry.id === teamId);
  if (!team) throw new Error("Team does not belong to this competition");

  if (PENDING_SQUAD_TEAM_IDS.has(teamId)) {
    return { team, pending: true, groups: [], updatedAt: new Date().toISOString() };
  }

  const payload = await fotmobJson("teams", { id: teamId, ccode3: "USA" });
  const groups = Array.isArray(object(payload.squad).squad)
    ? array(object(payload.squad).squad).map((group) => {
        const entry = object(group);
        return {
          title: text(entry.title) ?? "Squad",
          players: array(entry.members).map(mapSquadPlayer).filter((player): player is SquadPlayer => player != null),
        };
      }).filter((group) => group.players.length > 0)
    : [];

  return { team, pending: groups.length === 0, groups, updatedAt: new Date().toISOString() };
}

export async function getCompetitionStats(competitionId: ClubCompetitionId): Promise<CompetitionStats> {
  const payload = await fetchLeague(competitionId);
  const season = text(payload.currentSeason) ?? text(object(payload.details).selectedSeason) ?? "Current season";
  const availableStats = array(object(payload.stats).players).map(object);
  const categories = await Promise.all(
    requestedStats.map(async ([id, label, valueFormat]): Promise<CompetitionStatCategory | null> => {
      const metadata = availableStats.find((entry) => text(entry.name) === id);
      const url = text(metadata?.fetchAllUrl);
      if (!url || !isAllowedStatsUrl(url)) return { id, label, valueFormat, rows: [] };

      try {
        const statPayload = await fetchJsonUrl(url);
        const topList = object(array(statPayload.TopLists)[0]);
        const rows = array(topList.StatList)
          .map((row, index) => mapStatRow(row, index))
          .filter((row): row is CompetitionStatRow => row != null);
        return { id, label, valueFormat, rows } satisfies CompetitionStatCategory;
      } catch (error) {
        console.warn(`Failed to load FotMob ${competitionId} ${id} stats.`, error);
        return { id, label, valueFormat, rows: [] };
      }
    }),
  );
  const populatedCategories = categories.filter((category): category is CompetitionStatCategory => category != null);

  return {
    competitionId,
    season,
    pending: populatedCategories.every((category) => category.rows.length === 0),
    categories: populatedCategories,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchLeague(competitionId: ClubCompetitionId) {
  return fotmobJson("leagues", { id: FOTMOB_COMPETITIONS[competitionId], ccode3: "USA" });
}

async function fotmobJson(endpoint: string, params: Record<string, string | number>) {
  const base = FOTMOB_API_URL.endsWith("/") ? FOTMOB_API_URL : `${FOTMOB_API_URL}/`;
  const url = new URL(endpoint, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return fetchJsonUrl(url.toString());
}

async function fetchJsonUrl(url: string): Promise<JsonObject> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "flick90-competition-data/1.0" },
    next: { revalidate: CACHE_SECONDS },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`FotMob returned ${response.status}`);
  return object(await response.json());
}

function isAllowedStatsUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "data.fotmob.com";
  } catch {
    return false;
  }
}

function extractTableRows(payload: JsonObject) {
  const firstTable = object(array(payload.table)[0]);
  return array(object(object(firstTable.data).table).all);
}

function extractFixtures(payload: JsonObject): CompetitionFixture[] {
  return array(object(payload.fixtures).allMatches).map((value) => {
    const entry = object(value);
    const home = mapTeam(entry.home);
    const away = mapTeam(entry.away);
    const status = object(entry.status);
    if (!home || !away || !text(entry.id)) return null;

    return {
      id: text(entry.id)!,
      round: text(entry.round) ?? String(number(entry.roundName) ?? ""),
      home,
      away,
      utcTime: text(status.utcTime) ?? "",
      started: Boolean(status.started),
      finished: Boolean(status.finished),
      cancelled: Boolean(status.cancelled),
      score: text(status.scoreStr),
      status: text(object(status.reason).short) ?? (status.finished ? "FT" : status.started ? "LIVE" : "Scheduled"),
    };
  }).filter((fixture): fixture is CompetitionFixture => fixture != null);
}

function mapStanding(value: unknown): CompetitionStanding | null {
  const entry = object(value);
  const team = mapTeam(entry);
  if (!team) return null;
  const [goalsFor, goalsAgainst] = (text(entry.scoresStr) ?? "0-0").split("-").map((part) => Number(part));
  return {
    position: number(entry.idx) ?? 0,
    team,
    played: number(entry.played) ?? 0,
    wins: number(entry.wins) ?? 0,
    draws: number(entry.draws) ?? 0,
    losses: number(entry.losses) ?? 0,
    goalsFor: Number.isFinite(goalsFor) ? goalsFor : 0,
    goalsAgainst: Number.isFinite(goalsAgainst) ? goalsAgainst : 0,
    goalDifference: number(entry.goalConDiff) ?? 0,
    points: number(entry.pts) ?? 0,
    qualificationColor: text(entry.qualColor),
  };
}

function collectTeams(tableRows: unknown[], fixtures: CompetitionFixture[]) {
  const teams = new Map<string, FotmobTeam>();
  for (const row of tableRows) {
    const team = mapTeam(row);
    if (team) teams.set(team.id, team);
  }
  for (const fixture of fixtures) {
    teams.set(fixture.home.id, fixture.home);
    teams.set(fixture.away.id, fixture.away);
  }
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mapTeam(value: unknown): FotmobTeam | null {
  const entry = object(value);
  const id = text(entry.id);
  const name = text(entry.name);
  if (!id || !name) return null;
  return { id, name, shortName: text(entry.shortName) ?? name };
}

function mapSquadPlayer(value: unknown): SquadPlayer | null {
  const entry = object(value);
  const id = text(entry.id);
  const name = text(entry.name);
  if (!id || !name) return null;
  const role = text(object(entry.role).fallback) ?? text(object(entry.role).key) ?? "Player";
  const position = text(entry.positionDescription) ?? text(entry.position) ?? role;
  return {
    id,
    name,
    role,
    position,
    shirtNumber: number(entry.shirtNumber),
    age: number(entry.age),
    height: number(entry.height),
    country: text(entry.cname),
    countryCode: text(entry.ccode),
  };
}

function mapStatRow(value: unknown, index: number) {
  const entry = object(value);
  const playerName = text(entry.ParticipantName);
  const playerId = text(entry.ParticiantId);
  const teamId = text(entry.TeamId);
  const teamName = text(entry.TeamName);
  const statValue = number(entry.StatValue);
  if (!playerName || !playerId || !teamId || !teamName || statValue == null) return null;
  return {
    rank: number(entry.Rank) ?? index + 1,
    playerId,
    playerName,
    teamId,
    teamName,
    value: statValue,
    subValue: number(entry.SubStatValue),
    countryCode: text(entry.ParticipantCountryCode),
  };
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
