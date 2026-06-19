const { createClient } = require("@supabase/supabase-js");

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
  const primaryResult = await syncMatches(providerMatches, fixtureMap, { writeEvents: false });
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

  for (const match of matches) {
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

    if (!fixture) {
      skipped++;
      unmatched.push(`${match.homeTeam} vs ${match.awayTeam}`);
      continue;
    }

    matched.push({
      fixtureId: fixture.id,
      label: `${fixture.home_team} vs ${fixture.away_team}`,
      score: `${scoreMatch.homeScore}-${scoreMatch.awayScore}`,
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

async function loadFixtures() {
  const { data, error } = await supabase
    .from("match_fixtures")
    .select("id, home_team, away_team");

  if (error) throw new Error(`Failed to load match fixtures: ${error.message}`);
  return data ?? [];
}

async function loadProviderMatches() {
  if (footballDataKey) return loadFootballDataMatches();
  if (apiFootballKey) return loadApiFootballMatches();
  return [];
}

async function loadApiFootballMatches() {
  const today = new Date().toISOString().slice(0, 10);
  const [live, todayMatches] = await Promise.all([
    apiFootballRequest("fixtures", { live: "all" }),
    apiFootballRequest("fixtures", { date: today }),
  ]);

  const byId = new Map();
  for (const fixture of [...live, ...todayMatches]) {
    byId.set(String(fixture.fixture.id), mapApiFootballFixture(fixture));
  }
  return [...byId.values()];
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
    homeTeam: fixture.teams.home.name,
    awayTeam: fixture.teams.away.name,
    homeScore: fixture.goals.home ?? 0,
    awayScore: fixture.goals.away ?? 0,
    minute: fixture.fixture.status.elapsed,
    stoppageMinute: fixture.fixture.status.extra,
    status: mapApiFootballStatus(status),
    phase: mapApiFootballPhase(status),
    providerUpdatedAt: new Date().toISOString(),
  };
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
  };
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
  const dateTo = process.env.ESPN_DATE_TO ?? new Date().toISOString().slice(0, 10);
  const matches = [];

  for (const date of enumerateIsoDates(dateFrom, dateTo)) {
    const json = await espnScoreboardRequest(date);
    for (const event of json.events ?? []) {
      const match = mapEspnEvent(event);
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

function mapEspnEvent(event) {
  const competition = event.competitions?.[0];
  if (!competition?.status?.type?.completed) return null;

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
    minute: 90,
    stoppageMinute: null,
    status: "finished",
    phase: "full_time",
    kickoffTime: competition.date ?? event.date,
    providerUpdatedAt: new Date().toISOString(),
    statistics: mapEspnStatistics(home, away, competition.details ?? []),
    events: mapEspnGoalEvents(competition, teamById),
  };
}

function mapEspnStatistics(home, away, details) {
  return {
    homePossession: espnStat(home, "possessionPct"),
    awayPossession: espnStat(away, "possessionPct"),
    homeShots: espnStat(home, "totalShots") ?? 0,
    awayShots: espnStat(away, "totalShots") ?? 0,
    homeShotsOnTarget: espnStat(home, "shotsOnTarget") ?? 0,
    awayShotsOnTarget: espnStat(away, "shotsOnTarget") ?? 0,
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
        description: detail.text ?? null,
        createdAt: competition.date ?? new Date().toISOString(),
      };
    });
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

async function upsertLiveState(fixture, match) {
  const now = new Date().toISOString();
  const finalScoreConfirmedAt = match.status === "finished" ? match.providerUpdatedAt ?? now : null;
  const phase = normalizePhase(match.phase);
  const statistics = match.statistics ?? {};

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
      home_possession: statistics.homePossession,
      away_possession: statistics.awayPossession,
      home_shots: statistics.homeShots,
      away_shots: statistics.awayShots,
      home_shots_on_target: statistics.homeShotsOnTarget,
      away_shots_on_target: statistics.awayShotsOnTarget,
      home_yellow_cards: statistics.homeYellowCards,
      away_yellow_cards: statistics.awayYellowCards,
      home_red_cards: statistics.homeRedCards,
      away_red_cards: statistics.awayRedCards,
      home_corners: statistics.homeCorners,
      away_corners: statistics.awayCorners,
      home_fouls: statistics.homeFouls,
      away_fouls: statistics.awayFouls,
      home_offsides: statistics.homeOffsides,
      away_offsides: statistics.awayOffsides,
      provider_updated_at: match.providerUpdatedAt ?? now,
      updated_at: now,
    },
    { onConflict: "match_id" },
  );

  if (error) {
    throw new Error(`Failed to update ${fixture.home_team} vs ${fixture.away_team}: ${error.message}`);
  }
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
    assist_player_name: null,
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
