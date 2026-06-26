const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

loadEnvFile(process.env.ENV_FILE_PATH ?? path.join(process.cwd(), ".env.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiFootballKey = process.env.API_FOOTBALL_KEY;
const footballDataKey = process.env.FOOTBALL_DATA_KEY;
const isDryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const fixtures = await loadFixtures();
  const fixtureMap = new Map(fixtures.map((fixture) => [teamPairKey(fixture.home_team, fixture.away_team), fixture]));

  const providerMatches = await loadProviderMatches();
  const primaryResult = await syncMatches(providerMatches, fixtureMap, { writeEvents: true });
  const completedMatches = await loadEspnCompletedMatches();
  const completedResult = await syncMatches(completedMatches, fixtureMap, { writeEvents: true });

  console.log(
    `Live score sync complete. Updated ${primaryResult.updated}; skipped ${primaryResult.skipped}; provider matches ${providerMatches.length}.`,
  );
  if (primaryResult.unmatched.length > 0) {
    console.log(`Unmatched provider fixtures: ${primaryResult.unmatched.slice(0, 20).join("; ")}`);
  }

  console.log(
    `Completed match stats sync complete. Updated ${completedResult.updated}; skipped ${completedResult.skipped}; ESPN matches ${completedMatches.length}.`,
  );
  if (completedResult.unmatched.length > 0) {
    console.log(`Unmatched ESPN fixtures: ${completedResult.unmatched.slice(0, 20).join("; ")}`);
  }
  if (completedResult.eventErrors.length > 0) {
    console.log(`ESPN event write errors: ${completedResult.eventErrors.slice(0, 20).join("; ")}`);
  }
  if (isDryRun && primaryResult.matched.length > 0) {
    console.log("Dry run live/provider-match sample:");
    for (const item of primaryResult.matched.slice(0, 30)) {
      console.log(`- ${item.fixtureId}: ${item.label} ${item.score}; status=${item.status}; phase=${item.phase}`);
    }
  }
  if (isDryRun && completedResult.matched.length > 0) {
    console.log("Dry run completed-match sample:");
    for (const item of completedResult.matched.slice(0, 30)) {
      console.log(`- ${item.fixtureId}: ${item.label} ${item.score}; goals=${item.goalCount}`);
    }
  }
}

async function syncMatches(matches, fixtureMap, options) {
  let updated = 0;
  let skipped = 0;
  const unmatched = [];
  const matched = [];
  const eventErrors = [];
  const bestMatchByFixtureId = new Map();

  for (const match of matches) {
    const resolved = resolveFixtureMatch(match, fixtureMap);

    if (!resolved) {
      skipped++;
      unmatched.push(`${match.homeTeam} vs ${match.awayTeam}`);
      continue;
    }

    const { fixture, scoreMatch } = resolved;
    const current = bestMatchByFixtureId.get(fixture.id);
    if (!current || isBetterScoreMatch(scoreMatch, current.scoreMatch)) {
      bestMatchByFixtureId.set(fixture.id, {
        fixture,
        scoreMatch: {
          ...scoreMatch,
          lineups: scoreMatch.lineups ?? current?.scoreMatch.lineups ?? null,
          events: chooseBestEvents(scoreMatch.events, current?.scoreMatch.events),
          statistics: {
            ...(current?.scoreMatch.statistics ?? {}),
            ...(scoreMatch.statistics ?? {}),
          },
        },
      });
    } else {
      if (scoreMatch.lineups && !current.scoreMatch.lineups) {
        current.scoreMatch.lineups = scoreMatch.lineups;
      }
      current.scoreMatch.events = chooseBestEvents(current.scoreMatch.events, scoreMatch.events);
      current.scoreMatch.statistics = {
        ...(current.scoreMatch.statistics ?? {}),
        ...(scoreMatch.statistics ?? {}),
      };
    }
  }

  for (const { fixture, scoreMatch } of bestMatchByFixtureId.values()) {
    matched.push({
      fixtureId: fixture.id,
      label: `${fixture.home_team} vs ${fixture.away_team}`,
      score: `${scoreMatch.homeScore}-${scoreMatch.awayScore}`,
      status: scoreMatch.status,
      phase: scoreMatch.phase,
      goalCount: scoreMatch.events?.length ?? 0,
    });

    if (isDryRun) {
      updated++;
      continue;
    }

    await upsertLiveState(fixture, scoreMatch);
    if (options.writeEvents) {
      try {
        await replaceMatchEvents(fixture, scoreMatch);
      } catch (error) {
        eventErrors.push(`${fixture.home_team} vs ${fixture.away_team}: ${error.message}`);
      }
    }
    updated++;
  }

  return { updated, skipped, unmatched, matched, eventErrors };
}

function chooseBestEvents(primaryEvents = [], fallbackEvents = []) {
  if (hasAssistData(primaryEvents)) return primaryEvents;
  if (hasAssistData(fallbackEvents)) return fallbackEvents;
  return primaryEvents.length > 0 ? primaryEvents : fallbackEvents;
}

function hasAssistData(events) {
  return events.some((event) => event.assistPlayerName);
}

function resolveFixtureMatch(match, fixtureMap) {
  let fixture = fixtureMap.get(teamPairKey(match.homeTeam, match.awayTeam));
  let scoreMatch = match;

  if (!fixture) {
    fixture = fixtureMap.get(teamPairKey(match.awayTeam, match.homeTeam));
    if (fixture) {
      scoreMatch = {
        ...match,
        homeTeam: match.awayTeam,
        awayTeam: match.homeTeam,
        homeScore: match.awayScore,
        awayScore: match.homeScore,
      };
    }
  }

  if (!fixture) return null;
  return { fixture, scoreMatch };
}

async function loadFixtures() {
  const { data, error } = await supabase
    .from("match_fixtures")
    .select("id, home_team, away_team");

  if (error) throw new Error(`Failed to load match fixtures: ${error.message}`);
  return data ?? [];
}

async function loadProviderMatches() {
  const providerMatches = [];

  providerMatches.push(...await loadEspnLiveMatches());

  if (footballDataKey) {
    providerMatches.push(...await loadFootballDataMatches());
  }

  if (apiFootballKey) {
    providerMatches.push(...await loadApiFootballMatches());
  }

  return dedupeProviderMatches(providerMatches);
}

async function loadEspnLiveMatches() {
  const dateFrom = process.env.ESPN_LIVE_DATE_FROM ?? offsetIsoDate(todayIsoDate(), -2);
  const dateTo = process.env.ESPN_LIVE_DATE_TO ?? offsetIsoDate(todayIsoDate(), 1);
  const matches = [];

  for (const date of enumerateIsoDates(dateFrom, dateTo)) {
    const json = await espnScoreboardRequest(date);
    for (const event of json.events ?? []) {
      const match = mapEspnEvent(event, { completedOnly: false });
      if (match) matches.push(match);
    }
  }

  return matches;
}

async function loadApiFootballMatches() {
  const dates = enumerateIsoDates(
    process.env.API_FOOTBALL_DATE_FROM ?? "2026-06-11",
    process.env.API_FOOTBALL_DATE_TO ?? offsetIsoDate(todayIsoDate(), 1),
  );
  const responses = await Promise.all([
    apiFootballRequest("fixtures", { live: "all" }),
    ...dates.map((date) => apiFootballRequest("fixtures", { date })),
  ]);

  const byId = new Map();
  for (const fixture of responses.flat()) {
    byId.set(String(fixture.fixture.id), mapApiFootballFixture(fixture));
  }

  for (const match of byId.values()) {
    if (shouldFetchApiFootballDetails(match)) {
      const details = await loadApiFootballDetails(match);
      match.lineups = details.lineups;
      match.events = details.events;
      match.statistics = details.statistics;
    }
  }

  return [...byId.values()];
}

function shouldFetchApiFootballDetails(match) {
  if (["live", "half_time", "finished", "extra_time", "penalties"].includes(match.status)) return true;

  const kickoffTime = Date.parse(match.kickoffTime ?? "");
  if (!Number.isFinite(kickoffTime)) return false;

  const hoursUntilKickoff = (kickoffTime - Date.now()) / 3_600_000;
  const lookaheadHours = Number(process.env.LINEUPS_LOOKAHEAD_HOURS ?? 2);
  const lookbackHours = Number(process.env.LINEUPS_LOOKBACK_HOURS ?? 8);

  return hoursUntilKickoff <= lookaheadHours && hoursUntilKickoff >= -lookbackHours;
}

async function loadApiFootballDetails(match) {
  try {
    const [lineups, playerStats, events, statistics] = await Promise.all([
      apiFootballRequest("fixtures/lineups", { fixture: match.providerMatchId }),
      apiFootballRequest("fixtures/players", { fixture: match.providerMatchId }),
      apiFootballRequest("fixtures/events", { fixture: match.providerMatchId }),
      apiFootballRequest("fixtures/statistics", { fixture: match.providerMatchId }),
    ]);

    return {
      lineups: mapApiFootballLineups(lineups, playerStats, match),
      events: mapApiFootballEvents(events, match),
      statistics: mapApiFootballStatistics(statistics),
    };
  } catch (error) {
    console.warn(`API-Football match details unavailable for ${match.homeTeam} vs ${match.awayTeam}: ${error.message}`);
    return { lineups: null, events: [], statistics: {} };
  }
}

async function apiFootballRequest(endpoint, params) {
  const url = new URL(`https://v3.football.api-sports.io/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetchWithRetry(url, {
    headers: {
      "x-rapidapi-key": apiFootballKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
      "user-agent": "fifhub-live-score-updater/1.0",
    },
  }, `API-Football ${endpoint}`);

  if (!response.ok) {
    throw new Error(`API-Football returned ${response.status}`);
  }

  const json = await response.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football error: ${JSON.stringify(json.errors)}`);
  }

  return json.response ?? [];
}

function mapApiFootballFixture(fixture) {
  const status = fixture.fixture.status.short;
  return {
    provider: "api-football",
    providerMatchId: String(fixture.fixture.id),
    homeTeamId: fixture.teams.home.id != null ? String(fixture.teams.home.id) : null,
    awayTeamId: fixture.teams.away.id != null ? String(fixture.teams.away.id) : null,
    homeTeam: fixture.teams.home.name,
    awayTeam: fixture.teams.away.name,
    homeScore: fixture.goals.home ?? 0,
    awayScore: fixture.goals.away ?? 0,
    minute: fixture.fixture.status.elapsed,
    stoppageMinute: fixture.fixture.status.extra,
    status: mapApiFootballStatus(status),
    phase: mapApiFootballPhase(status),
    kickoffTime: fixture.fixture.date,
    providerUpdatedAt: new Date().toISOString(),
  };
}

function mapApiFootballLineups(lineups, playerStats, match) {
  if (!Array.isArray(lineups) || lineups.length === 0) return null;

  const ratings = mapApiFootballRatings(playerStats);
  const homeSource = lineups.find((lineup) => isSameProviderTeam(lineup.team, { id: match.homeTeamId, name: match.homeTeam })) ?? lineups[0];
  const awaySource = lineups.find((lineup) => isSameProviderTeam(lineup.team, { id: match.awayTeamId, name: match.awayTeam })) ?? lineups[1];

  if (!homeSource || !awaySource) return null;

  const home = mapApiFootballTeamLineup(homeSource, match.homeTeam, ratings);
  const away = mapApiFootballTeamLineup(awaySource, match.awayTeam, ratings);

  if (!hasLineupPlayers(home) && !hasLineupPlayers(away)) return null;

  return {
    provider: "api-football",
    lastUpdated: new Date().toISOString(),
    home,
    away,
  };
}

function mapApiFootballTeamLineup(lineup, fallbackTeamName, ratings) {
  return {
    teamName: lineup.team?.name ?? fallbackTeamName,
    formation: lineup.formation ?? null,
    coach: lineup.coach?.name ?? null,
    starters: (lineup.startXI ?? [])
      .map((entry) => mapApiFootballLineupPlayer(entry, "starter", ratings))
      .filter(Boolean),
    substitutes: (lineup.substitutes ?? [])
      .map((entry) => mapApiFootballLineupPlayer(entry, "substitute", ratings))
      .filter(Boolean),
  };
}

function mapApiFootballLineupPlayer(entry, status, ratings) {
  const player = entry?.player ?? entry;
  const id = player?.id != null ? String(player.id) : null;
  const name = player?.name;
  if (!name) return null;

  const ratingEntry = id ? ratings.get(id) : null;
  const shirtNumber = Number(player?.number ?? ratingEntry?.shirtNumber);
  const rating = Number(ratingEntry?.rating);

  return {
    id,
    name,
    position: player?.pos ?? ratingEntry?.position ?? null,
    shirtNumber: Number.isFinite(shirtNumber) ? shirtNumber : null,
    status,
    rating: Number.isFinite(rating) ? rating : null,
    grid: player?.grid ?? null,
    captain: Boolean(ratingEntry?.captain),
  };
}

function mapApiFootballRatings(playerStats) {
  const ratings = new Map();

  for (const team of playerStats ?? []) {
    for (const item of team.players ?? []) {
      const id = item.player?.id != null ? String(item.player.id) : null;
      if (!id) continue;

      const games = item.statistics?.[0]?.games ?? {};
      ratings.set(id, {
        rating: games.rating,
        shirtNumber: games.number,
        position: games.position,
        captain: games.captain,
      });
    }
  }

  return ratings;
}

function mapApiFootballEvents(events, match) {
  return (events ?? [])
    .map((event, index) => {
      const eventType = mapApiFootballEventType(event);
      if (!eventType) return null;

      return {
        externalEventId: `api-football:${match.providerMatchId}:${index}:${event.time?.elapsed ?? 0}:${event.type ?? ""}:${event.detail ?? ""}:${event.player?.id ?? "unknown"}`,
        provider: "api-football",
        minute: event.time?.elapsed ?? 0,
        stoppageMinute: event.time?.extra ?? null,
        sequenceNumber: index + 1,
        eventType,
        teamName: event.team?.name ?? null,
        playerName: event.player?.name ?? null,
        assistPlayerName: event.assist?.name ?? null,
        description: event.comments ?? event.detail ?? null,
        createdAt: match.kickoffTime ?? new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function mapApiFootballEventType(event) {
  const type = String(event.type ?? "").toLowerCase();
  const detail = String(event.detail ?? "").toLowerCase();

  if (type === "goal") {
    if (detail.includes("own")) return "own_goal";
    if (detail.includes("penalty")) return "penalty_goal";
    return "goal";
  }
  if (type === "card") {
    if (detail.includes("red")) return "red_card";
    if (detail.includes("second yellow")) return "second_yellow";
    return "yellow_card";
  }
  if (type === "subst") return "substitution";
  if (type === "var") return "var";
  return null;
}

function mapApiFootballStatistics(statistics) {
  const home = statistics?.[0]?.statistics ?? [];
  const away = statistics?.[1]?.statistics ?? [];

  return {
    homePossession: apiFootballStat(home, "Ball Possession"),
    awayPossession: apiFootballStat(away, "Ball Possession"),
    homeExpectedGoals: apiFootballStat(home, "expected_goals") ?? apiFootballStat(home, "Expected Goals"),
    awayExpectedGoals: apiFootballStat(away, "expected_goals") ?? apiFootballStat(away, "Expected Goals"),
    homeShots: apiFootballStat(home, "Total Shots"),
    awayShots: apiFootballStat(away, "Total Shots"),
    homeShotsOnTarget: apiFootballStat(home, "Shots on Goal"),
    awayShotsOnTarget: apiFootballStat(away, "Shots on Goal"),
    homePasses: apiFootballStat(home, "Total passes"),
    awayPasses: apiFootballStat(away, "Total passes"),
    homePassingAccuracy: apiFootballStat(home, "Passes %"),
    awayPassingAccuracy: apiFootballStat(away, "Passes %"),
    homeOffsides: apiFootballStat(home, "Offsides"),
    awayOffsides: apiFootballStat(away, "Offsides"),
    homeFouls: apiFootballStat(home, "Fouls"),
    awayFouls: apiFootballStat(away, "Fouls"),
    homeYellowCards: apiFootballStat(home, "Yellow Cards"),
    awayYellowCards: apiFootballStat(away, "Yellow Cards"),
    homeRedCards: apiFootballStat(home, "Red Cards"),
    awayRedCards: apiFootballStat(away, "Red Cards"),
  };
}

function apiFootballStat(statistics, type) {
  const stat = statistics.find((item) => String(item.type).toLowerCase() === type.toLowerCase());
  if (!stat || stat.value == null) return null;

  const value = Number.parseFloat(String(stat.value).replace("%", ""));
  return Number.isFinite(value) ? value : null;
}

function mapApiFootballStatus(status) {
  if (["FT", "AET", "PEN"].includes(status)) return "finished";
  if (status === "HT") return "half_time";
  if (["1H", "2H", "ET", "BT", "P"].includes(status)) return "live";
  return "scheduled";
}

function mapApiFootballPhase(status) {
  if (status === "1H") return "first_half";
  if (status === "HT") return "half_time";
  if (status === "2H") return "second_half";
  if (["ET", "BT"].includes(status)) return "extra_time";
  if (status === "P") return "penalties";
  if (["FT", "AET", "PEN"].includes(status)) return "full_time";
  return "pre_match";
}

async function loadFootballDataMatches() {
  const json = await footballDataRequest("competitions/WC/matches", {
    dateFrom: process.env.FOOTBALL_DATA_DATE_FROM ?? "2026-06-11",
    dateTo: process.env.FOOTBALL_DATA_DATE_TO ?? "2026-07-20",
  });

  return (json.matches ?? []).map(mapFootballDataMatch);
}

function dedupeProviderMatches(matches) {
  const bestByProviderMatch = new Map();
  const bestByFixturePair = new Map();

  for (const match of matches) {
    const key = `${match.provider}:${match.providerMatchId}`;
    const current = bestByProviderMatch.get(key);
    if (!current || isBetterScoreMatch(match, current)) {
      bestByProviderMatch.set(key, match);
    }

    const fixturePairKey = teamPairKey(match.homeTeam, match.awayTeam);
    const pairCurrent = bestByFixturePair.get(fixturePairKey);
    if (!pairCurrent || isBetterScoreMatch(match, pairCurrent)) {
      bestByFixturePair.set(fixturePairKey, match);
    }
  }

  return [...bestByFixturePair.values(), ...bestByProviderMatch.values()];
}

function isBetterScoreMatch(candidate, current) {
  const priorityDelta = scoreMatchPriority(candidate) - scoreMatchPriority(current);
  if (priorityDelta !== 0) return priorityDelta > 0;

  const candidateUpdatedAt = parseComparableDate(candidate.providerUpdatedAt ?? candidate.kickoffTime);
  const currentUpdatedAt = parseComparableDate(current.providerUpdatedAt ?? current.kickoffTime);
  if (candidateUpdatedAt !== currentUpdatedAt) return candidateUpdatedAt > currentUpdatedAt;

  return scoreValue(candidate) >= scoreValue(current);
}

function scoreMatchPriority(match) {
  if (match.status === "finished") return 4;
  if (match.status === "half_time") return 3;
  if (["live", "extra_time", "penalties"].includes(match.status)) return 2;
  if (match.status === "scheduled") return 1;
  return 0;
}

function scoreValue(match) {
  return Number(match.homeScore ?? 0) + Number(match.awayScore ?? 0);
}

function parseComparableDate(value) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function footballDataRequest(endpoint, params) {
  const url = new URL(`https://api.football-data.org/v4/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetchWithRetry(url, {
    headers: {
      "X-Auth-Token": footballDataKey,
      "user-agent": "fifhub-live-score-updater/1.0",
    },
  }, `Football-Data.org ${endpoint}`);

  if (!response.ok) {
    throw new Error(`Football-Data.org returned ${response.status}`);
  }

  return response.json();
}

function mapFootballDataMatch(match) {
  const minute = estimateFootballDataMinute(match);
  const status = mapFootballDataStatus(match.status);

  return {
    provider: "football-data",
    providerMatchId: String(match.id),
    homeTeam: match.homeTeam.name,
    awayTeam: match.awayTeam.name,
    homeScore: match.score.fullTime.home ?? match.score.halfTime.home ?? 0,
    awayScore: match.score.fullTime.away ?? match.score.halfTime.away ?? 0,
    minute,
    stoppageMinute: null,
    status,
    phase: mapFootballDataPhase(match.status, minute),
    kickoffTime: match.utcDate,
    providerUpdatedAt: match.lastUpdated ?? new Date().toISOString(),
    lineups: mapFootballDataLineups(match),
  };
}

function mapFootballDataLineups(match) {
  const sourceLineups = Array.isArray(match.lineups) ? match.lineups : null;
  const homeSource = sourceLineups?.find((lineup) => isSameProviderTeam(lineup.team, match.homeTeam)) ?? match.homeTeam;
  const awaySource = sourceLineups?.find((lineup) => isSameProviderTeam(lineup.team, match.awayTeam)) ?? match.awayTeam;

  const home = mapProviderTeamLineup(homeSource, match.homeTeam.name);
  const away = mapProviderTeamLineup(awaySource, match.awayTeam.name);

  if (!hasLineupPlayers(home) && !hasLineupPlayers(away)) return null;

  return {
    provider: "football-data",
    lastUpdated: match.lastUpdated ?? new Date().toISOString(),
    home,
    away,
  };
}

function mapProviderTeamLineup(source, fallbackTeamName) {
  const starters = firstArray(
    source?.startXI,
    source?.startingXI,
    source?.starters,
    source?.lineup,
    source?.players?.filter?.((player) => isStarterPlayer(player)),
  );
  const substitutes = firstArray(
    source?.substitutes,
    source?.subs,
    source?.bench,
    source?.players?.filter?.((player) => !isStarterPlayer(player)),
  );

  return {
    teamName: source?.team?.name ?? source?.name ?? fallbackTeamName,
    formation: source?.formation ?? source?.tactic?.formation ?? null,
    coach: source?.coach?.name ?? source?.coach ?? null,
    starters: starters.map((player) => mapLineupPlayer(player, "starter")).filter(Boolean),
    substitutes: substitutes.map((player) => mapLineupPlayer(player, "substitute")).filter(Boolean),
  };
}

function mapLineupPlayer(entry, status) {
  const player = entry?.player ?? entry;
  const name = player?.name ?? player?.displayName ?? player?.fullName ?? entry?.name;
  if (!name) return null;

  const shirtNumber = Number(player?.shirtNumber ?? player?.number ?? entry?.shirtNumber ?? entry?.number);
  const rating = Number(player?.rating ?? entry?.rating ?? player?.fotmobRating ?? entry?.fotmobRating);

  return {
    id: player?.id != null ? String(player.id) : null,
    name,
    position: player?.position ?? player?.pos ?? entry?.position ?? null,
    shirtNumber: Number.isFinite(shirtNumber) ? shirtNumber : null,
    status,
    rating: Number.isFinite(rating) ? rating : null,
  };
}

function isStarterPlayer(entry) {
  const playerStatus = String(entry?.status ?? entry?.role ?? entry?.type ?? "").toLowerCase();
  if (playerStatus.includes("sub")) return false;
  if (playerStatus.includes("start") || playerStatus.includes("lineup")) return true;
  return entry?.substitute === false || entry?.isStarting === true || entry?.starter === true;
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) ?? [];
}

function hasLineupPlayers(lineup) {
  return lineup.starters.length > 0 || lineup.substitutes.length > 0;
}

function isSameProviderTeam(candidate, expected) {
  if (!candidate || !expected) return false;
  if (candidate.id != null && expected.id != null && String(candidate.id) === String(expected.id)) return true;
  return normalizeTeamName(candidate.name ?? candidate.shortName ?? "") === normalizeTeamName(expected.name ?? expected.shortName ?? "");
}

function mapFootballDataStatus(status) {
  if (status === "FINISHED") return "finished";
  if (status === "PAUSED") return "half_time";
  if (["LIVE", "IN_PLAY"].includes(status)) return "live";
  return "scheduled";
}

function mapFootballDataPhase(status, minute) {
  if (status === "FINISHED") return "full_time";
  if (status === "PAUSED") return "half_time";
  if (["LIVE", "IN_PLAY"].includes(status)) {
    if (typeof minute === "number" && minute <= 45) return "first_half";
    return "second_half";
  }
  return "pre_match";
}

function estimateFootballDataMinute(match) {
  if (match.status === "PAUSED") return 45;
  if (!["LIVE", "IN_PLAY"].includes(match.status)) return null;

  const kickoffTime = Date.parse(match.utcDate);
  if (!Number.isFinite(kickoffTime)) return null;

  const elapsedSinceKickoff = Math.floor((Date.now() - kickoffTime) / 60_000);
  if (elapsedSinceKickoff < 0) return null;

  if (elapsedSinceKickoff <= 45) return Math.max(1, elapsedSinceKickoff);

  const estimatedMinute = elapsedSinceKickoff - 15;
  return Math.min(120, Math.max(46, estimatedMinute));
}

async function loadEspnCompletedMatches() {
  const dateFrom = process.env.ESPN_DATE_FROM ?? "2026-06-11";
  const dateTo = process.env.ESPN_DATE_TO ?? offsetIsoDate(todayIsoDate(), 1);
  const matches = [];

  for (const date of enumerateIsoDates(dateFrom, dateTo)) {
    const json = await espnScoreboardRequest(date);
    for (const event of json.events ?? []) {
      const match = mapEspnEvent(event, { completedOnly: true });
      if (match) matches.push(match);
    }
  }

  return matches;
}

async function espnScoreboardRequest(date) {
  const url = new URL("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard");
  url.searchParams.set("dates", date.replace(/-/g, ""));

  const response = await fetchWithRetry(
    url,
    { headers: { "user-agent": "fifhub-completed-match-updater/1.0" } },
    `ESPN scoreboard ${date}`,
  );

  if (!response.ok) {
    throw new Error(`ESPN scoreboard returned ${response.status}`);
  }

  return response.json();
}

function mapEspnEvent(event, { completedOnly }) {
  const competition = event.competitions?.[0];
  const statusType = competition?.status?.type;
  if (!competition || (completedOnly && !statusType?.completed)) return null;

  const home = competition.competitors?.find((competitor) => competitor.homeAway === "home");
  const away = competition.competitors?.find((competitor) => competitor.homeAway === "away");
  if (!home || !away) return null;

  const teamById = new Map([
    [String(home.id), home.team?.displayName ?? home.team?.shortDisplayName],
    [String(away.id), away.team?.displayName ?? away.team?.shortDisplayName],
  ]);

  return {
    provider: "espn",
    providerMatchId: String(event.id),
    homeTeam: home.team?.displayName ?? home.team?.shortDisplayName,
    awayTeam: away.team?.displayName ?? away.team?.shortDisplayName,
    homeScore: Number(home.score ?? 0),
    awayScore: Number(away.score ?? 0),
    minute: mapEspnMinute(competition),
    stoppageMinute: null,
    status: mapEspnStatus(statusType),
    phase: mapEspnPhase(statusType, competition),
    kickoffTime: competition.date ?? event.date,
    providerUpdatedAt: new Date().toISOString(),
    statistics: mapEspnStatistics(home, away, competition.details ?? []),
    events: mapEspnGoalEvents(competition, teamById),
  };
}

function mapEspnStatus(statusType) {
  if (statusType?.completed) return "finished";
  if (statusType?.state === "in") return "live";
  if (statusType?.state === "post") return "finished";
  return "scheduled";
}

function mapEspnPhase(statusType, competition) {
  if (statusType?.completed || statusType?.state === "post") return "full_time";

  const period = Number(competition.status?.period ?? 0);
  const statusName = String(statusType?.name ?? statusType?.description ?? "").toUpperCase();
  if (statusName.includes("HALFTIME") || statusName === "STATUS_HALFTIME") return "half_time";
  if (period === 1) return "first_half";
  if (period === 2) return "second_half";
  if (period > 2) return "extra_time";
  return "pre_match";
}

function mapEspnMinute(competition) {
  if (competition.status?.type?.completed) return 90;

  const displayClock = competition.status?.displayClock;
  const timing = parseEspnClock(displayClock);
  if (timing.minute > 0) return timing.minute;

  const clock = Number(competition.status?.clock);
  if (Number.isFinite(clock) && clock > 0) {
    return Math.max(1, Math.floor(clock / 60));
  }

  return null;
}

function mapEspnStatistics(home, away, details) {
  return {
    homePossession: espnStat(home, "possessionPct"),
    awayPossession: espnStat(away, "possessionPct"),
    homeExpectedGoals: espnStat(home, "expectedGoals") ?? espnStat(home, "xG"),
    awayExpectedGoals: espnStat(away, "expectedGoals") ?? espnStat(away, "xG"),
    homeShots: espnStat(home, "totalShots") ?? 0,
    awayShots: espnStat(away, "totalShots") ?? 0,
    homeShotsOnTarget: espnStat(home, "shotsOnTarget") ?? 0,
    awayShotsOnTarget: espnStat(away, "shotsOnTarget") ?? 0,
    homePasses: espnStat(home, "totalPasses") ?? espnStat(home, "passes"),
    awayPasses: espnStat(away, "totalPasses") ?? espnStat(away, "passes"),
    homePassingAccuracy: espnStat(home, "accuratePassesPct") ?? espnStat(home, "passAccuracy") ?? espnStat(home, "passingAccuracy"),
    awayPassingAccuracy: espnStat(away, "accuratePassesPct") ?? espnStat(away, "passAccuracy") ?? espnStat(away, "passingAccuracy"),
    homeYellowCards: countEspnCard(details, home.id, "yellowCard"),
    awayYellowCards: countEspnCard(details, away.id, "yellowCard"),
    homeRedCards: countEspnCard(details, home.id, "redCard"),
    awayRedCards: countEspnCard(details, away.id, "redCard"),
    homeCorners: espnStat(home, "wonCorners") ?? 0,
    awayCorners: espnStat(away, "wonCorners") ?? 0,
    homeFouls: espnStat(home, "foulsCommitted") ?? 0,
    awayFouls: espnStat(away, "foulsCommitted") ?? 0,
    homeOffsides: espnStat(home, "totalOffside") ?? 0,
    awayOffsides: espnStat(away, "totalOffside") ?? 0,
  };
}

function mapEspnGoalEvents(competition, teamById) {
  return (competition.details ?? [])
    .filter((detail) => detail.scoringPlay && !detail.shootout)
    .map((detail, index) => {
      const timing = parseEspnClock(detail.clock?.displayValue);
      const scorer = detail.athletesInvolved?.[0]?.displayName ?? null;
      const assist = detail.athletesInvolved?.[1]?.displayName ?? parseAssistFromText(detail.text);
      const eventType = detail.ownGoal ? "own_goal" : detail.penaltyKick ? "penalty_goal" : "goal";
      const teamName = teamById.get(String(detail.team?.id)) ?? detail.team?.displayName ?? null;

      return {
        externalEventId: `espn:${competition.id}:${index}:${detail.clock?.displayValue ?? "0"}:${detail.type?.id ?? "goal"}:${detail.athletesInvolved?.[0]?.id ?? "unknown"}`,
        provider: "espn",
        minute: timing.minute,
        stoppageMinute: timing.stoppageMinute,
        sequenceNumber: index + 1,
        eventType,
        teamName,
        playerName: scorer,
        assistPlayerName: assist,
        description: detail.text ?? null,
        createdAt: competition.date ?? new Date().toISOString(),
      };
    });
}

function parseAssistFromText(text) {
  const match = String(text ?? "").match(/\bassist(?:ed by)?:\s*([^.;]+)/i);
  return match?.[1]?.trim() ?? null;
}

function espnStat(competitor, name) {
  const stat = competitor.statistics?.find((item) => item.name === name);
  if (!stat) return null;

  const value = Number.parseFloat(String(stat.value ?? stat.displayValue).replace("%", ""));
  return Number.isFinite(value) ? value : null;
}

function countEspnCard(details, teamId, typeId) {
  return details.filter((detail) => String(detail.team?.id) === String(teamId) && detail.type?.id === typeId).length;
}

function parseEspnClock(displayValue) {
  const normalized = String(displayValue ?? "0").replace(/[\u2019']/g, "");
  const [minute, stoppageMinute] = normalized.split("+").map((part) => Number.parseInt(part, 10));

  return {
    minute: Number.isFinite(minute) ? minute : 0,
    stoppageMinute: Number.isFinite(stoppageMinute) ? stoppageMinute : null,
  };
}

function enumerateIsoDates(dateFrom, dateTo) {
  const dates = [];
  const cursor = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);

  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime()) || cursor > end) {
    return dates;
  }

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function offsetIsoDate(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function upsertLiveState(fixture, match) {
  const existingState = await getExistingLiveState(fixture.id);

  if (match.status === "scheduled" && hasConfirmedFinalScore(existingState)) {
    return;
  }

  const now = new Date().toISOString();
  const finalScoreConfirmedAt = match.status === "finished" ? match.providerUpdatedAt ?? now : null;
  const phase = normalizePhase(match.phase);
  const statistics = match.statistics ?? {};
  const statisticColumns = mapStatisticColumns(statistics, existingState);
  const lineupColumns = mapLineupColumns(match.lineups ?? getKnownLineupsForFixture(fixture), existingState);

  const { error } = await supabase.from("live_match_state").upsert(
    {
      match_id: fixture.id,
      home_team: fixture.home_team,
      away_team: fixture.away_team,
      home_score: match.homeScore,
      away_score: match.awayScore,
      minute: match.minute,
      stoppage_minute: match.stoppageMinute,
      stoppage_time: match.stoppageMinute,
      status: match.status,
      phase,
      period: periodForPhase(phase),
      started_at: match.kickoffTime ?? null,
      final_score_confirmed_at: finalScoreConfirmedAt,
      ...statisticColumns,
      ...lineupColumns,
      provider_updated_at: match.providerUpdatedAt ?? now,
      updated_at: now,
    },
    { onConflict: "match_id" },
  );

  if (error) {
    throw new Error(`Failed to update ${fixture.home_team} vs ${fixture.away_team}: ${error.message}`);
  }
}

async function getExistingLiveState(matchId) {
  const { data, error } = await supabase
    .from("live_match_state")
    .select("status, final_score_confirmed_at, home_possession, away_possession, home_shots, away_shots, home_shots_on_target, away_shots_on_target, home_expected_goals, away_expected_goals, home_passes, away_passes, home_passing_accuracy, away_passing_accuracy, home_yellow_cards, away_yellow_cards, home_red_cards, away_red_cards, home_corners, away_corners, home_fouls, away_fouls, home_offsides, away_offsides, lineups, lineups_provider, lineups_updated_at")
    .eq("match_id", matchId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load existing live state for match ${matchId}: ${error.message}`);
  }

  return data;
}

function mapLineupColumns(lineups, existingState) {
  const nextLineups = hasStoredLineups(lineups) ? lineups : existingState?.lineups;
  if (!hasStoredLineups(nextLineups)) return {};

  return {
    lineups: nextLineups,
    lineups_provider: nextLineups.provider ?? existingState?.lineups_provider ?? null,
    lineups_updated_at: nextLineups.lastUpdated ?? existingState?.lineups_updated_at ?? new Date().toISOString(),
  };
}

function hasStoredLineups(lineups) {
  return Boolean(lineups?.home && lineups?.away && (hasLineupPlayers(lineups.home) || hasLineupPlayers(lineups.away)));
}

function getKnownLineupsForFixture(fixture) {
  const key = teamPairKey(fixture.home_team, fixture.away_team);
  return knownLineupsByPair[key] ?? null;
}

const knownLineupsByPair = {
  [teamPairKey("Türkiye", "USA")]: {
    provider: "manual-verified",
    lastUpdated: "2026-06-26T04:05:00.000Z",
    home: {
      teamName: "Türkiye",
      formation: "3-4-2-1",
      coach: null,
      starters: [
        lineupPlayer("Uğurcan Çakır", 23, "G", "starter", "1:1", 6.4),
        lineupPlayer("Zeki Çelik", 2, "D", "starter", "2:3", 7.2, true),
        lineupPlayer("Ozan Kabak", 15, "D", "starter", "2:2", 6.7),
        lineupPlayer("Abdülkerim Bardakcı", 14, "D", "starter", "2:1", 7.0),
        lineupPlayer("Oğuz Aydın", 24, "M", "starter", "3:4", 7.5),
        lineupPlayer("Salih Özcan", 5, "M", "starter", "3:3", 7.3),
        lineupPlayer("Orkun Kökçü", 6, "M", "starter", "3:2", 7.4),
        lineupPlayer("Eren Elmalı", 13, "M", "starter", "3:1", 7.4),
        lineupPlayer("Arda Güler", 8, "F", "starter", "4:2", 7.8),
        lineupPlayer("Kenan Yıldız", 11, "F", "starter", "4:1", 6.4),
        lineupPlayer("Barış Alper Yılmaz", 21, "F", "starter", "5:1", 8.1),
      ],
      substitutes: [
        lineupPlayer("Can Uzun", null, "F", "substitute"),
        lineupPlayer("Çağlar Söyüncü", null, "D", "substitute"),
      ],
    },
    away: {
      teamName: "USA",
      formation: "4-3-3",
      coach: null,
      starters: [
        lineupPlayer("Matt Turner", 1, "G", "starter", "1:1", 5.8),
        lineupPlayer("Auston Trusty", 6, "D", "starter", "2:4", 7.9),
        lineupPlayer("Mark McKenzie", 22, "D", "starter", "2:3", 6.4),
        lineupPlayer("Miles Robinson", 12, "D", "starter", "2:2", 6.5),
        lineupPlayer("Joe Scally", 23, "D", "starter", "2:1", 6.4),
        lineupPlayer("Tim Weah", 21, "F", "starter", "4:3", 5.4),
        lineupPlayer("Gio Reyna", 7, "M", "starter", "3:3", 6.2),
        lineupPlayer("Sebastian Berhalter", 14, "M", "starter", "3:2", 9.0),
        lineupPlayer("Weston McKennie", 8, "M", "starter", "3:1", 7.4, true),
        lineupPlayer("Ricardo Pepi", 9, "F", "starter", "4:2", 6.2),
        lineupPlayer("Brenden Aaronson", 11, "F", "starter", "4:1", 6.2),
      ],
      substitutes: [
        lineupPlayer("Christian Pulisic", null, "F", "substitute"),
        lineupPlayer("Sergiño Dest", null, "D", "substitute"),
        lineupPlayer("Alex Zendejas", null, "F", "substitute"),
        lineupPlayer("Alex Freeman", null, "D", "substitute"),
        lineupPlayer("Malik Tillman", null, "M", "substitute"),
      ],
    },
  },
};

function lineupPlayer(name, shirtNumber, position, status, grid = null, rating = null, captain = false) {
  return {
    id: null,
    name,
    position,
    shirtNumber,
    status,
    rating,
    grid,
    captain,
  };
}

function hasConfirmedFinalScore(state) {
  return Boolean(state && state.status === "finished" && state.final_score_confirmed_at);
}

function mapStatisticColumns(statistics, existingState) {
  return compactObject({
    home_possession: firstDefined(statistics.homePossession, existingState?.home_possession),
    away_possession: firstDefined(statistics.awayPossession, existingState?.away_possession),
    home_shots: firstDefined(statistics.homeShots, existingState?.home_shots),
    away_shots: firstDefined(statistics.awayShots, existingState?.away_shots),
    home_shots_on_target: firstDefined(statistics.homeShotsOnTarget, existingState?.home_shots_on_target),
    away_shots_on_target: firstDefined(statistics.awayShotsOnTarget, existingState?.away_shots_on_target),
    home_expected_goals: firstDefined(statistics.homeExpectedGoals, existingState?.home_expected_goals),
    away_expected_goals: firstDefined(statistics.awayExpectedGoals, existingState?.away_expected_goals),
    home_passes: firstDefined(statistics.homePasses, existingState?.home_passes),
    away_passes: firstDefined(statistics.awayPasses, existingState?.away_passes),
    home_passing_accuracy: firstDefined(statistics.homePassingAccuracy, existingState?.home_passing_accuracy),
    away_passing_accuracy: firstDefined(statistics.awayPassingAccuracy, existingState?.away_passing_accuracy),
    home_yellow_cards: firstDefined(statistics.homeYellowCards, existingState?.home_yellow_cards),
    away_yellow_cards: firstDefined(statistics.awayYellowCards, existingState?.away_yellow_cards),
    home_red_cards: firstDefined(statistics.homeRedCards, existingState?.home_red_cards),
    away_red_cards: firstDefined(statistics.awayRedCards, existingState?.away_red_cards),
    home_corners: firstDefined(statistics.homeCorners, existingState?.home_corners),
    away_corners: firstDefined(statistics.awayCorners, existingState?.away_corners),
    home_fouls: firstDefined(statistics.homeFouls, existingState?.home_fouls),
    away_fouls: firstDefined(statistics.awayFouls, existingState?.away_fouls),
    home_offsides: firstDefined(statistics.homeOffsides, existingState?.home_offsides),
    away_offsides: firstDefined(statistics.awayOffsides, existingState?.away_offsides),
  });
}

function firstDefined(...values) {
  return values.find((value) => value != null);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue != null)
  );
}

async function replaceMatchEvents(fixture, match) {
  if (!match.events || match.events.length === 0) return;

  const { error: deleteError } = await supabase
    .from("match_events")
    .delete()
    .eq("match_id", fixture.id)
    .eq("provider", match.provider);

  if (deleteError) {
    throw new Error(`Failed to clear events for ${fixture.home_team} vs ${fixture.away_team}: ${deleteError.message}`);
  }

  const rows = match.events.map((event) => ({
    external_event_id: event.externalEventId,
    provider: event.provider,
    match_id: fixture.id,
    minute: event.minute,
    stoppage_minute: event.stoppageMinute,
    sequence_number: event.sequenceNumber,
    event_type: event.eventType,
    team_name: getFixtureTeamNameForEvent(event.teamName, match, fixture),
    player_name: event.playerName,
    assist_player_name: event.assistPlayerName ?? null,
    description: event.description,
    event_timestamp: event.createdAt,
    created_at: event.createdAt,
  }));

  const { error: insertError } = await supabase.from("match_events").insert(rows);

  if (insertError && isEventTypeConstraintError(insertError)) {
    const upperRows = rows.map((row) => ({
      ...row,
      event_type: row.event_type.toUpperCase(),
    }));
    const { error: upperInsertError } = await supabase.from("match_events").insert(upperRows);

    if (!upperInsertError) {
      return;
    }

    throw new Error(`Failed to insert events for ${fixture.home_team} vs ${fixture.away_team}: ${upperInsertError.message}`);
  }

  if (insertError) {
    throw new Error(`Failed to insert events for ${fixture.home_team} vs ${fixture.away_team}: ${insertError.message}`);
  }
}

function isEventTypeConstraintError(error) {
  return (
    error?.code === "23514" &&
    String(error?.message ?? "").toLowerCase().includes("event_type")
  );
}

function getFixtureTeamNameForEvent(eventTeamName, match, fixture) {
  if (!eventTeamName) return null;

  const eventTeamKey = normalizeTeamName(eventTeamName);

  if (eventTeamKey === normalizeTeamName(match.homeTeam)) {
    return fixture.home_team;
  }

  if (eventTeamKey === normalizeTeamName(match.awayTeam)) {
    return fixture.away_team;
  }

  return eventTeamName;
}

function periodForPhase(phase) {
  return phase === "extra_time" ? "extra_time_first_half" : phase;
}

function normalizePhase(phase) {
  if (
    phase === "first_half" ||
    phase === "half_time" ||
    phase === "second_half" ||
    phase === "extra_time" ||
    phase === "penalties" ||
    phase === "full_time"
  ) {
    return phase;
  }
  return "pre_match";
}

function teamPairKey(homeTeam, awayTeam) {
  return `${normalizeTeamName(homeTeam)}::${normalizeTeamName(awayTeam)}`;
}

function normalizeTeamName(name) {
  const direct = {
    bih: "bosniaherzegovina",
    "bosnia herzegovina": "bosniaherzegovina",
    "bosnia-herzegovina": "bosniaherzegovina",
    bosniaherzegovina: "bosniaherzegovina",
    "cape verde island": "capeverde",
    "cape verde islands": "capeverde",
    "cote divoire": "ivorycoast",
    "czech republic": "czechia",
    "democratic republic of congo": "drcongo",
    "congo dr": "drcongo",
    congodr: "drcongo",
    drc: "drcongo",
    "ir iran": "iran",
    iran: "iran",
    "korea rep": "southkorea",
    "republic of korea": "southkorea",
    "saudi-arabia": "saudiarabia",
    "saudi arabia": "saudiarabia",
    turkey: "turkiye",
    "united states of america": "usa",
    "usa": "usa",
    "united states": "usa",
    "cote d'ivoire": "ivorycoast",
    "cote d\u2019ivoire": "ivorycoast",
    "côte d'ivoire": "ivorycoast",
    "côte d’ivoire": "ivorycoast",
    "ivory coast": "ivorycoast",
    "korea republic": "southkorea",
    "south korea": "southkorea",
    "turkiye": "turkiye",
    "türkiye": "turkiye",
    "cabo verde": "capeverde",
    "cape verde": "capeverde",
    "dr congo": "drcongo",
    "bosnia & herzegovina": "bosniaherzegovina",
    "bosnia and herzegovina": "bosniaherzegovina",
  };

  const normalized = String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019']/g, "")
    .toLowerCase()
    .trim();

  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return direct[normalized] ?? direct[compact] ?? compact;
}

async function fetchWithRetry(url, options, label, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status >= 500 && attempt < attempts) {
        lastError = new Error(`${label} returned ${response.status}`);
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
    }

    const delayMs = 1000 * attempt;
    console.warn(`${label} request failed on attempt ${attempt}/${attempts}. Retrying in ${delayMs}ms.`);
    await sleep(delayMs);
  }

  throw new Error(`${label} request failed after ${attempts} attempts: ${lastError?.message ?? lastError}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
