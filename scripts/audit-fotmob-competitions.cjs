const competitions = [
  ["premier-league", 47],
  ["champions-league", 42],
  ["la-liga", 87],
  ["bundesliga", 54],
  ["ligue-1", 53],
  ["serie-a", 55],
  ["europa-league", 73],
];

const baseUrl = "https://www.fotmob.com/api/data";
const headers = {
  accept: "application/json",
  "user-agent": "flick90-data-audit/1.0",
};

async function request(endpoint, params) {
  const url = new URL(`${baseUrl}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
  return response.json();
}

async function requestUrl(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function findTeams(value, teams = new Map(), seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return teams;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) findTeams(item, teams, seen);
    return teams;
  }

  const possibleTeams = [value.home, value.away, value.team];
  for (const team of possibleTeams) {
    if (team && typeof team === "object" && team.id != null && typeof team.name === "string") {
      teams.set(String(team.id), team.name);
    }
  }

  if (value.id != null && typeof value.name === "string" && ("played" in value || "scoresStr" in value)) {
    teams.set(String(value.id), value.name);
  }

  for (const child of Object.values(value)) findTeams(child, teams, seen);
  return teams;
}

function countTableRows(table) {
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const row of value) {
        if (row && typeof row === "object" && row.id != null && "played" in row) seen.add(String(row.id));
        visit(row);
      }
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(table);
  return seen.size;
}

function countSquadPlayers(squad) {
  const groups = Array.isArray(squad) ? squad : squad?.squad;
  if (!Array.isArray(groups)) return 0;
  return groups.reduce((total, group) => {
    if (Array.isArray(group?.members)) return total + group.members.length;
    if (Array.isArray(group?.players)) return total + group.players.length;
    return total + (group?.id != null ? 1 : 0);
  }, 0);
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        results[index] = await mapper(values[index]);
      } catch (error) {
        results[index] = { error: error.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function describeShape(value, depth = 0) {
  if (depth >= 3 || value == null || typeof value !== "object") return typeof value;
  if (Array.isArray(value)) return { length: value.length, first: describeShape(value[0], depth + 1) };
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, describeShape(child, depth + 1)]));
}

async function auditCompetition([slug, id]) {
  const league = await request("leagues", { id, ccode3: "USA" });
  const teams = findTeams({ matches: league.matches, table: league.table });
  const season = league.currentSeason ?? league.details?.selectedSeason ?? league.allAvailableSeasons?.[0];
  const matches = league.fixtures?.allMatches ?? [];

  const teamEntries = [...teams.entries()];
  const squads = await mapWithConcurrency(teamEntries, 6, async ([teamId, teamName]) => {
    let team = await request("teams", { id: teamId, ccode3: "USA" });
    if (countSquadPlayers(team.squad) === 0) {
      team = await request("teams", { id: teamId, ccode3: "USA", season });
    }
    return {
      teamId,
      teamName,
      players: countSquadPlayers(team.squad),
      ...(countSquadPlayers(team.squad) === 0 ? { squadShape: describeShape(team.squad) } : {}),
    };
  });
  const squadErrors = squads.filter((entry) => entry.error || entry.players === 0);
  const squadResult = {
    ok: squadErrors.length === 0 && squads.length === teams.size,
    teams: squads.length - squadErrors.length,
    players: squads.reduce((total, entry) => total + (entry.players ?? 0), 0),
    errors: squadErrors,
  };

  let statsResult = { ok: false, rows: 0 };
  const firstStat = league.stats?.players?.find((entry) => entry?.fetchAllUrl);
  if (firstStat?.fetchAllUrl) {
    try {
      const payload = await requestUrl(firstStat.fetchAllUrl);
      const rows = payload?.TopLists?.[0]?.StatList ?? [];
      statsResult = {
        ok: Array.isArray(rows) && rows.length > 0,
        stat: firstStat.name,
        rows: Array.isArray(rows) ? rows.length : 0,
        categories: league.stats.players.length,
      };
    } catch (error) {
      statsResult = { ok: false, rows: 0, error: error.message };
    }
  }

  if (process.env.AUDIT_SHAPE === "1" && id === 47) {
    const fixturesTab = await request("leagues", { id, ccode3: "USA", tab: "fixtures" });
    const firstStatPayload = await requestUrl(league.stats.players[0].fetchAllUrl);
    console.error(JSON.stringify({
      leagueKeys: Object.keys(league),
      tabs: league.tabs,
      fixturesTabKeys: Object.keys(fixturesTab),
      fixturesTabMatches: describeShape(fixturesTab.matches),
      fixturesTabFixtures: describeShape(fixturesTab.fixtures),
      leagueMatches: describeShape(league.matches),
      leagueTable: describeShape(league.table),
      leagueStats: describeShape(league.stats),
      firstPlayerStat: league.stats?.players?.[0],
      firstPlayerStatPayload: describeShape(firstStatPayload),
      firstPlayerStatRow: firstStatPayload?.TopLists?.[0]?.StatList?.[0],
      playerStatNames: league.stats?.players?.map((entry) => entry.name),
      firstTeamSquad: describeShape((await request("teams", { id: teamEntries[0][0], ccode3: "USA" })).squad),
      firstSquadMember: (await request("teams", { id: teamEntries[0][0], ccode3: "USA" })).squad?.squad?.[0]?.members?.[0],
      firstFixture: league.fixtures?.allMatches?.[0],
      firstTableRow: league.table?.[0]?.data?.table?.all?.[0],
    }, null, 2));
  }

  return {
    slug,
    id,
    name: league.details?.name,
    season,
    availableSeasons: league.allAvailableSeasons?.slice(0, 3),
    fixtures: Array.isArray(matches) ? matches.length : 0,
    teamsDiscovered: teams.size,
    tableRows: countTableRows(league.table),
    squad: squadResult,
    stats: statsResult,
  };
}

(async () => {
  const results = [];
  for (const competition of competitions) {
    try {
      results.push(await auditCompetition(competition));
    } catch (error) {
      results.push({ slug: competition[0], id: competition[1], error: error.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.error)) process.exitCode = 1;
})();
