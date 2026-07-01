const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createClient } = require("@supabase/supabase-js");

loadEnvFile(process.env.ENV_FILE_PATH ?? path.join(process.cwd(), ".env.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiFootballKey = process.env.API_FOOTBALL_KEY;
const footballDataKey = process.env.FOOTBALL_DATA_KEY;
const fotmobApiBaseUrl = process.env.FOTMOB_API_BASE_URL ?? "https://www.fotmob.com/api/data";
const isDryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
const providerOrder = parseProviderOrder(process.env.LIVE_SCORE_PROVIDER_ORDER);
const providerPriority = new Map(providerOrder.map((provider, index) => [provider, index]));

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

  console.log(`Live score provider order: ${providerOrder.join(" -> ")}`);
  const providerMatches = await loadProviderMatches(fixtureMap);
  const primaryResult = await syncMatches(providerMatches, fixtureMap, { writeEvents: true });
  const storedFotmobMatches = await loadStoredFotmobCompletedMatches();
  const storedFotmobResult = await syncMatches(storedFotmobMatches, fixtureMap, { writeEvents: false });
  const storedFotmobRepairResult = await repairStoredFotmobCompletedStatistics(storedFotmobMatches);
  const completedMatches = await loadEspnCompletedMatches();
  const completedResult = await syncMatches(completedMatches, fixtureMap, { preserveExistingStats: true, writeEvents: false });

  console.log(
    `Live score sync complete. Updated ${primaryResult.updated}; skipped ${primaryResult.skipped}; provider matches ${providerMatches.length}.`,
  );
  if (primaryResult.unmatched.length > 0) {
    console.log(`Unmatched provider fixtures: ${primaryResult.unmatched.slice(0, 20).join("; ")}`);
  }

  console.log(
    `Stored FotMob completed stats sync complete. Updated ${storedFotmobResult.updated}; skipped ${storedFotmobResult.skipped}; stored matches ${storedFotmobMatches.length}.`,
  );
  if (storedFotmobResult.unmatched.length > 0) {
    console.log(`Unmatched stored FotMob fixtures: ${storedFotmobResult.unmatched.slice(0, 20).join("; ")}`);
  }
  console.log(
    `Stored FotMob stat repair complete. Updated ${storedFotmobRepairResult.updated}; skipped ${storedFotmobRepairResult.skipped}.`,
  );

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
      console.log(`- ${item.fixtureId}: ${item.label} ${item.score}; provider=${item.provider}; status=${item.status}; phase=${item.phase}; stats=${item.statCount}; ratings=${item.ratingCount}`);
    }
  }
  if (isDryRun && completedResult.matched.length > 0) {
    console.log("Dry run completed-match sample:");
    for (const item of completedResult.matched.slice(0, 30)) {
      console.log(`- ${item.fixtureId}: ${item.label} ${item.score}; goals=${item.goalCount}`);
    }
  }

  await advanceKnockoutFixtures();
  runHighlightsSyncAfterScores();
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

    const { fixture } = resolved;
    let { scoreMatch } = resolved;
    if (match.provider === "fotmob" && shouldFetchFotmobDetails(match)) {
      const fotmobDetails = await loadFotmobDetails(match);
      const orientedStatistics = scoreMatch === match ? fotmobDetails.statistics : swapMatchStatistics(fotmobDetails.statistics);
      const orientedLineups = scoreMatch === match ? fotmobDetails.lineups : swapMatchLineups(fotmobDetails.lineups);
      const orientedEvents = scoreMatch === match ? fotmobDetails.events : swapMatchEvents(fotmobDetails.events);
      scoreMatch = {
        ...scoreMatch,
        lineups: orientedLineups ?? scoreMatch.lineups ?? null,
        events: chooseBestEvents(orientedEvents, scoreMatch.events),
        statistics: mergeMatchStatistics(scoreMatch.statistics, orientedStatistics),
      };
    }
    const current = bestMatchByFixtureId.get(fixture.id);
    if (!current || isBetterScoreMatch(scoreMatch, current.scoreMatch)) {
      bestMatchByFixtureId.set(fixture.id, {
        fixture,
        scoreMatch: {
          ...scoreMatch,
          lineups: scoreMatch.lineups ?? current?.scoreMatch.lineups ?? null,
          events: chooseBestEvents(scoreMatch.events, current?.scoreMatch.events),
          statistics: mergeMatchStatistics(current?.scoreMatch.statistics, scoreMatch.statistics),
        },
      });
    } else {
      if (scoreMatch.lineups && !current.scoreMatch.lineups) {
        current.scoreMatch.lineups = scoreMatch.lineups;
      }
      current.scoreMatch.events = chooseBestEvents(current.scoreMatch.events, scoreMatch.events);
      current.scoreMatch.statistics = mergeMatchStatistics(current.scoreMatch.statistics, scoreMatch.statistics);
    }
  }

  for (const { fixture, scoreMatch } of bestMatchByFixtureId.values()) {
    matched.push({
      fixtureId: fixture.id,
      label: `${fixture.home_team} vs ${fixture.away_team}`,
      score: `${scoreMatch.homeScore}-${scoreMatch.awayScore}`,
      status: scoreMatch.status,
      phase: scoreMatch.phase,
      provider: scoreMatch.provider,
      statCount: Object.keys(scoreMatch.statistics ?? {}).length,
      ratingCount: countLineupRatings(scoreMatch.lineups),
      goalCount: scoreMatch.events?.length ?? 0,
    });

    if (isDryRun) {
      updated++;
      continue;
    }

    await upsertLiveState(fixture, scoreMatch, options);
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
  if (hasProviderEvents(primaryEvents, "fotmob")) return primaryEvents;
  if (hasProviderEvents(fallbackEvents, "fotmob")) return fallbackEvents;
  if (hasAssistData(primaryEvents)) return primaryEvents;
  if (hasAssistData(fallbackEvents)) return fallbackEvents;
  return primaryEvents.length > 0 ? primaryEvents : fallbackEvents;
}

function hasProviderEvents(events, provider) {
  return events.some((event) => event.provider === provider);
}

function hasAssistData(events) {
  return events.some((event) => event.assistPlayerName);
}

function mergeMatchStatistics(base = {}, incoming = {}) {
  const merged = {
    ...compactObject(base),
    ...compactObject(incoming),
  };
  for (const key of ["homeYellowCards", "awayYellowCards", "homeRedCards", "awayRedCards"]) {
    if (base[key] != null && incoming[key] != null) {
      merged[key] = Math.max(Number(base[key]) || 0, Number(incoming[key]) || 0);
    }
  }
  return merged;
}

function runHighlightsSyncAfterScores() {
  if (process.env.RUN_HIGHLIGHTS_SYNC_AFTER_SCORES !== "1") return;

  const args = [path.join("scripts", "sync-fifa-highlights.cjs")];
  if (isDryRun) args.push("--dry-run");

  try {
    execFileSync(process.execPath, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        HIGHLIGHTS_MATCH_LIMIT: process.env.HIGHLIGHTS_MATCH_LIMIT ?? "120",
      },
    });
  } catch (error) {
    console.warn(`FIFA highlights sync after scores failed: ${error.message}`);
  }
}

const knockoutProgression = {
  "89": ["75", "78"],
  "90": ["73", "76"],
  "91": ["84", "83"],
  "92": ["82", "81"],
  "93": ["74", "77"],
  "94": ["79", "80"],
  "95": ["87", "86"],
  "96": ["85", "88"],
  "97": ["89", "90"],
  "98": ["91", "92"],
  "99": ["93", "94"],
  "100": ["95", "96"],
  "101": ["97", "98"],
  "102": ["99", "100"],
  "104": ["101", "102"],
};

const bronzeFinalSources = ["101", "102"];

async function advanceKnockoutFixtures() {
  const matchIds = [
    ...new Set([
      ...Object.keys(knockoutProgression),
      ...Object.values(knockoutProgression).flat(),
      ...bronzeFinalSources,
      "103",
    ]),
  ];

  const { data: fixtures, error: fixtureError } = await supabase
    .from("match_fixtures")
    .select("id, home_team, away_team")
    .in("id", matchIds);

  if (fixtureError) {
    throw new Error(`Failed to load knockout fixtures: ${fixtureError.message}`);
  }

  const { data: states, error: stateError } = await supabase
    .from("live_match_state")
    .select("match_id, home_team, away_team, home_score, away_score, home_penalty_score, away_penalty_score, status, final_score_confirmed_at")
    .in("match_id", matchIds);

  if (stateError) {
    throw new Error(`Failed to load knockout live states: ${stateError.message}`);
  }

  const fixtureById = new Map((fixtures ?? []).map((fixture) => [String(fixture.id), fixture]));
  const stateByMatchId = new Map((states ?? []).map((state) => [String(state.match_id), state]));
  let updated = 0;
  const skipped = [];

  for (const [targetMatchId, sourceMatchIds] of Object.entries(knockoutProgression)) {
    const homeTeam = getKnockoutWinnerName(sourceMatchIds[0], fixtureById, stateByMatchId);
    const awayTeam = getKnockoutWinnerName(sourceMatchIds[1], fixtureById, stateByMatchId);

    if (!homeTeam || !awayTeam) {
      skipped.push(targetMatchId);
      continue;
    }

    updated += await updateKnockoutFixtureTeams(targetMatchId, homeTeam, awayTeam, fixtureById);
  }

  const bronzeHomeTeam = getKnockoutLoserName(bronzeFinalSources[0], fixtureById, stateByMatchId);
  const bronzeAwayTeam = getKnockoutLoserName(bronzeFinalSources[1], fixtureById, stateByMatchId);
  if (bronzeHomeTeam && bronzeAwayTeam) {
    updated += await updateKnockoutFixtureTeams("103", bronzeHomeTeam, bronzeAwayTeam, fixtureById);
  } else {
    skipped.push("103");
  }

  console.log(`Knockout advancement sync complete. Updated ${updated}; waiting on ${skipped.length}.`);
}

function getKnockoutWinnerName(matchId, fixtureById, stateByMatchId) {
  const outcome = getKnockoutOutcome(matchId, fixtureById, stateByMatchId);
  return outcome?.winner ?? null;
}

function getKnockoutLoserName(matchId, fixtureById, stateByMatchId) {
  const outcome = getKnockoutOutcome(matchId, fixtureById, stateByMatchId);
  return outcome?.loser ?? null;
}

function getKnockoutOutcome(matchId, fixtureById, stateByMatchId) {
  const fixture = fixtureById.get(String(matchId));
  const state = stateByMatchId.get(String(matchId));

  if (!fixture || !state || state.status !== "finished" || !state.final_score_confirmed_at) {
    return null;
  }

  const homeScore = Number(state.home_score);
  const awayScore = Number(state.away_score);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
    return null;
  }
  const homePenaltyScore = Number(state.home_penalty_score);
  const awayPenaltyScore = Number(state.away_penalty_score);
  const hasPenaltyWinner =
    Number.isFinite(homePenaltyScore) &&
    Number.isFinite(awayPenaltyScore) &&
    homePenaltyScore !== awayPenaltyScore;

  if (homeScore === awayScore && !hasPenaltyWinner) {
    return null;
  }

  const homeTeam = state.home_team ?? fixture.home_team;
  const awayTeam = state.away_team ?? fixture.away_team;

  const homeWon = homeScore === awayScore ? homePenaltyScore > awayPenaltyScore : homeScore > awayScore;

  return homeWon
    ? { winner: homeTeam, loser: awayTeam }
    : { winner: awayTeam, loser: homeTeam };
}

async function updateKnockoutFixtureTeams(matchId, homeTeam, awayTeam, fixtureById) {
  const fixture = fixtureById.get(String(matchId));
  if (!fixture || (fixture.home_team === homeTeam && fixture.away_team === awayTeam)) {
    return 0;
  }

  if (isDryRun) {
    console.log(`Would advance knockout fixture ${matchId}: ${homeTeam} vs ${awayTeam}`);
    return 1;
  }

  const { error } = await supabase
    .from("match_fixtures")
    .update({
      home_team: homeTeam,
      away_team: awayTeam,
      updated_at: new Date().toISOString(),
    })
    .eq("id", matchId);

  if (error) {
    throw new Error(`Failed to advance knockout fixture ${matchId}: ${error.message}`);
  }

  fixture.home_team = homeTeam;
  fixture.away_team = awayTeam;
  return 1;
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
        homePenaltyScore: match.awayPenaltyScore,
        awayPenaltyScore: match.homePenaltyScore,
      };
    }
  }

  if (!fixture) return null;
  return { fixture, scoreMatch };
}

function swapMatchStatistics(statistics = {}) {
  const swapped = {};
  for (const [key, value] of Object.entries(statistics)) {
    if (key.startsWith("home")) {
      swapped[`away${key.slice(4)}`] = value;
    } else if (key.startsWith("away")) {
      swapped[`home${key.slice(4)}`] = value;
    } else {
      swapped[key] = value;
    }
  }
  return swapped;
}

function swapMatchLineups(lineups) {
  if (!lineups?.home || !lineups?.away) return lineups ?? null;
  return {
    ...lineups,
    home: lineups.away,
    away: lineups.home,
  };
}

function swapMatchEvents(events = []) {
  return events.map((event) => ({
    ...event,
    teamName: event.teamSide === "home" ? event.awayTeamName : event.teamSide === "away" ? event.homeTeamName : event.teamName,
    teamSide: event.teamSide === "home" ? "away" : event.teamSide === "away" ? "home" : event.teamSide,
  }));
}

async function loadFixtures() {
  const { data, error } = await supabase
    .from("match_fixtures")
    .select("id, home_team, away_team");

  if (error) throw new Error(`Failed to load match fixtures: ${error.message}`);
  return data ?? [];
}

async function loadProviderMatches(fixtureMap) {
  const providerMatches = [];

  for (const provider of providerOrder) {
    providerMatches.push(...await loadProviderSource(provider, fixtureMap));
  }

  return dedupeProviderMatches(filterProviderMatchesForFixtures(providerMatches, fixtureMap));
}

async function loadStoredFotmobCompletedMatches() {
  const { data: states, error: statesError } = await supabase
    .from("live_match_state")
    .select("match_id,home_team,away_team,home_score,away_score,home_penalty_score,away_penalty_score,status,phase")
    .eq("status", "finished");

  if (statesError) {
    console.warn(`Stored FotMob completed matches unavailable: ${statesError.message}`);
    return [];
  }

  const matchIds = (states ?? []).map((state) => String(state.match_id));
  if (matchIds.length === 0) return [];

  const { data: events, error: eventsError } = await supabase
    .from("match_events")
    .select("match_id,external_event_id")
    .eq("provider", "fotmob")
    .in("match_id", matchIds);

  if (eventsError) {
    console.warn(`Stored FotMob event IDs unavailable: ${eventsError.message}`);
    return [];
  }

  const providerIdByMatchId = new Map();
  for (const event of events ?? []) {
    const matchId = String(event.match_id);
    if (providerIdByMatchId.has(matchId)) continue;

    const providerMatchId = String(event.external_event_id ?? "").match(/^fotmob:(\d+):/)?.[1];
    if (providerMatchId) providerIdByMatchId.set(matchId, providerMatchId);
  }

  return (states ?? [])
    .map((state) => {
      const providerMatchId = providerIdByMatchId.get(String(state.match_id));
      if (!providerMatchId) return null;

      return {
        matchId: state.match_id,
        provider: "fotmob",
        providerMatchId,
        homeTeam: state.home_team,
        awayTeam: state.away_team,
        homeScore: state.home_score,
        awayScore: state.away_score,
        homePenaltyScore: state.home_penalty_score,
        awayPenaltyScore: state.away_penalty_score,
        status: "finished",
        phase: state.phase ?? "full_time",
        minute: null,
        startTime: null,
        statistics: {},
        lineups: null,
        events: [],
      };
    })
    .filter(Boolean);
}

async function repairStoredFotmobCompletedStatistics(matches) {
  let updated = 0;
  let skipped = 0;

  for (const match of matches) {
    if (!match.matchId || !match.providerMatchId) {
      skipped++;
      continue;
    }

    const details = await loadFotmobDetails(match);
    const existingState = await getExistingLiveState(match.matchId);
    const statisticColumns = mapStatisticColumns(details.statistics, existingState);

    if (Object.keys(statisticColumns).length === 0) {
      skipped++;
      continue;
    }

    if (!isDryRun) {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("live_match_state")
        .update({
          ...statisticColumns,
          provider_updated_at: now,
          updated_at: now,
        })
        .eq("match_id", match.matchId);

      if (error) {
        throw new Error(`Failed to repair stored FotMob stats for ${match.homeTeam} vs ${match.awayTeam}: ${error.message}`);
      }
    }

    updated++;
  }

  return { updated, skipped };
}

async function loadProviderSource(provider, fixtureMap) {
  try {
    if (provider === "fotmob") {
      if (process.env.FOTMOB_ENABLED === "0") return [];
      return loadFotmobMatches(fixtureMap);
    }

    if (provider === "espn") {
      return loadEspnLiveMatches();
    }

    if (provider === "football-data") {
      return footballDataKey ? loadFootballDataMatches(fixtureMap) : [];
    }

    if (provider === "api-football") {
      return apiFootballKey ? loadApiFootballMatches(fixtureMap) : [];
    }
  } catch (error) {
    console.warn(`${provider} live scores unavailable: ${error.message}`);
  }

  return [];
}

function parseProviderOrder(value) {
  const supportedProviders = ["fotmob", "espn", "football-data", "api-football"];
  const requestedProviders = String(value || "fotmob,espn,football-data,api-football")
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
  const orderedProviders = requestedProviders.filter((provider) => supportedProviders.includes(provider));

  for (const provider of supportedProviders) {
    if (!orderedProviders.includes(provider)) orderedProviders.push(provider);
  }

  return orderedProviders;
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

async function loadFotmobMatches(fixtureMap) {
  const dateFrom = process.env.FOTMOB_DATE_FROM ?? process.env.ESPN_LIVE_DATE_FROM ?? offsetIsoDate(todayIsoDate(), -2);
  const dateTo = process.env.FOTMOB_DATE_TO ?? process.env.ESPN_LIVE_DATE_TO ?? offsetIsoDate(todayIsoDate(), 1);
  const matches = [];

  for (const date of enumerateIsoDates(dateFrom, dateTo)) {
    try {
      const json = await fotmobRequest("matches", { date: compactIsoDate(date) });
      for (const league of json.leagues ?? []) {
        for (const match of league.matches ?? []) {
          const mapped = mapFotmobMatch(match, league);
          if (mapped && hasFixturePair(mapped, fixtureMap)) matches.push(mapped);
        }
      }
    } catch (error) {
      console.warn(`FotMob matches unavailable for ${date}: ${error.message}`);
    }
  }

  return matches;
}

function mapFotmobMatch(match, league) {
  const homeTeam = match.home?.name ?? match.homeName;
  const awayTeam = match.away?.name ?? match.awayName;
  if (!match.id || !homeTeam || !awayTeam) return null;

  const score = parseFotmobScore(match);
  const minute = getFotmobMinute(match.status);

  return {
    provider: "fotmob",
    providerMatchId: String(match.id),
    homeTeam,
    awayTeam,
    homeScore: score.home,
    awayScore: score.away,
    homePenaltyScore: score.homePenalty,
    awayPenaltyScore: score.awayPenalty,
    minute,
    stoppageMinute: null,
    status: mapFotmobStatus(match.status, minute),
    phase: mapFotmobPhase(match.status, minute),
    kickoffTime: match.status?.utcTime ?? match.timeTS ?? match.time ?? null,
    providerUpdatedAt: new Date().toISOString(),
    competition: league.name,
    events: [],
    statistics: {},
  };
}

function parseFotmobScore(match) {
  const homeScore = Number(match.home?.score);
  const awayScore = Number(match.away?.score);
  const penaltyScore = parsePenaltyScore(
    match.home?.penaltyScore,
    match.away?.penaltyScore,
    match.home?.penalty,
    match.away?.penalty,
    match.status?.scoreStr,
  );

  if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
    return { home: homeScore, away: awayScore, ...penaltyScore };
  }

  const scoreMatch = String(match.status?.scoreStr ?? "").match(/(\d+)\s*-\s*(\d+)/);
  return {
    home: scoreMatch ? Number(scoreMatch[1]) : 0,
    away: scoreMatch ? Number(scoreMatch[2]) : 0,
    ...penaltyScore,
  };
}

function parsePenaltyScore(homeValue, awayValue, fallbackHomeValue, fallbackAwayValue, textValue) {
  const home = firstFiniteNumber(homeValue, fallbackHomeValue);
  const away = firstFiniteNumber(awayValue, fallbackAwayValue);
  if (home != null && away != null) {
    return { homePenalty: home, awayPenalty: away };
  }

  const text = String(textValue ?? "");
  const textMatch =
    text.match(/\((\d+)\s*-\s*(\d+)\s*(?:pen|pens|penalties)?\)/i) ??
    text.match(/(?:pen|pens|penalties)[:\s]+(\d+)\s*-\s*(\d+)/i) ??
    text.match(/(\d+)\s*-\s*(\d+)\s*(?:pen|pens|penalties)/i);

  if (!textMatch) {
    return { homePenalty: null, awayPenalty: null };
  }

  return {
    homePenalty: Number(textMatch[1]),
    awayPenalty: Number(textMatch[2]),
  };
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getFotmobMinute(status) {
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

function parseFotmobMinute(value) {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function parseFotmobLocalTimestamp(value) {
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

function mapFotmobStatus(status, minute) {
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

function mapFotmobPhase(status, minute) {
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

function shouldFetchFotmobDetails(match) {
  return Boolean(match.providerMatchId);
}

async function loadFotmobDetails(match) {
  try {
    const json = await fotmobRequest("matchDetails", { matchId: match.providerMatchId });
    return {
      statistics: mapFotmobStatistics(json),
      lineups: mapFotmobLineups(json, match),
      events: mapFotmobEvents(json, match),
    };
  } catch (error) {
    console.warn(`FotMob details unavailable for ${match.homeTeam} vs ${match.awayTeam}: ${error.message}`);
    return { statistics: {}, lineups: null, events: [] };
  }
}

async function fotmobRequest(endpoint, params) {
  const baseUrl = fotmobApiBaseUrl.endsWith("/") ? fotmobApiBaseUrl : `${fotmobApiBaseUrl}/`;
  const url = new URL(endpoint, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetchWithRetry(url, {
    headers: {
      accept: "application/json",
      "user-agent": "fifhub-live-score-updater/1.0",
    },
  }, `FotMob ${endpoint}`);

  if (!response.ok) {
    throw new Error(`FotMob returned ${response.status}`);
  }

  return response.json();
}

function mapFotmobStatistics(details) {
  const rows = collectFotmobStatRows(details?.content?.stats);

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

function mapFotmobLineups(details, match) {
  const lineup = details?.content?.lineup;
  if (!lineup?.homeTeam || !lineup?.awayTeam) return null;

  const ratings = mapFotmobPlayerRatings(details?.content?.playerStats);
  const playerOfTheMatch = getFotmobPlayerOfTheMatch(details);
  const home = mapFotmobTeamLineup(lineup.homeTeam, match.homeTeam, ratings, playerOfTheMatch);
  const away = mapFotmobTeamLineup(lineup.awayTeam, match.awayTeam, ratings, playerOfTheMatch);
  if (!hasLineupPlayers(home) && !hasLineupPlayers(away)) return null;

  return {
    provider: "fotmob",
    lastUpdated: new Date().toISOString(),
    home,
    away,
  };
}

function mapFotmobEvents(details, match) {
  const events = details?.content?.matchFacts?.events?.events ?? [];
  return events
    .map((event, index) => {
      const eventType = mapFotmobEventType(event);
      if (!eventType) return null;

      const playerName = event.fullName ?? event.nameStr ?? event.player?.name ?? parseFotmobSubstitutedOutPlayer(event);
      const teamName = event.isHome === true ? match.homeTeam : event.isHome === false ? match.awayTeam : null;

      return {
        externalEventId: `fotmob:${match.providerMatchId}:${event.eventId ?? event.reactKey ?? index}:${event.type ?? ""}`,
        provider: "fotmob",
        minute: Number(event.time) || 0,
        stoppageMinute: Number.isFinite(Number(event.overloadTime)) ? Number(event.overloadTime) || null : null,
        sequenceNumber: index + 1,
        eventType,
        teamName,
        teamSide: event.isHome === true ? "home" : event.isHome === false ? "away" : null,
        homeTeamName: match.homeTeam,
        awayTeamName: match.awayTeam,
        playerName,
        assistPlayerName: event.assistInput ?? parseFotmobAssist(event.assistStr),
        substitutePlayerName: parseFotmobSubstitutePlayer(event),
        description: event.goalDescription ?? event.card ?? event.type ?? null,
        createdAt: match.kickoffTime ?? new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function mapFotmobEventType(event) {
  const type = String(event.type ?? "").toLowerCase();
  const card = String(event.card ?? "").toLowerCase();
  const goalDescription = String(event.goalDescription ?? event.suffix ?? "").toLowerCase();
  const combined = `${type} ${goalDescription}`;

  if (combined.includes("shootout") || combined.includes("shoot-out")) {
    if (combined.includes("miss") || combined.includes("saved")) return "penalty_shootout_miss";
    return "penalty_shootout_goal";
  }
  if (type.includes("injur")) return "injury";
  if (type === "goal") {
    if (event.ownGoal) return "own_goal";
    if (goalDescription.includes("pen") || goalDescription.includes("penalty")) return "penalty_goal";
    return "goal";
  }
  if (type === "card") {
    if (card.includes("second")) return "second_yellow";
    if (card.includes("red")) return "red_card";
    if (card.includes("yellow")) return "yellow_card";
  }
  if (type === "substitution") return "substitution";
  if (type === "var") return "var";
  return null;
}

function parseFotmobAssist(value) {
  const match = String(value ?? "").match(/assist\s+by\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseFotmobSubstitutePlayer(event) {
  if (String(event?.type ?? "").toLowerCase() !== "substitution") return null;

  return (
    event?.swap?.[0]?.name ??
    event?.swap?.[0]?.fullName ??
    event?.substitute?.name ??
    event?.substitute?.fullName ??
    event?.playerIn?.name ??
    event?.playerIn?.fullName ??
    event?.onPlayer?.name ??
    event?.onPlayer?.fullName ??
    event?.swap?.name ??
    event?.swap?.fullName ??
    null
  );
}

function parseFotmobSubstitutedOutPlayer(event) {
  if (String(event?.type ?? "").toLowerCase() !== "substitution") return null;

  return (
    event?.swap?.[1]?.name ??
    event?.swap?.[1]?.fullName ??
    event?.playerOut?.name ??
    event?.playerOut?.fullName ??
    event?.offPlayer?.name ??
    event?.offPlayer?.fullName ??
    null
  );
}

function getFotmobPlayerOfTheMatch(details) {
  const player = details?.content?.matchFacts?.playerOfTheMatch;
  const id = player?.id != null ? String(player.id) : null;
  const name = player?.name?.fullName ?? [player?.name?.firstName, player?.name?.lastName].filter(Boolean).join(" ");
  return {
    id,
    name: name || null,
  };
}

function mapFotmobTeamLineup(team, fallbackTeamName, ratings, playerOfTheMatch) {
  return {
    teamName: team.name ?? fallbackTeamName,
    formation: team.formation ?? null,
    coach: team.coach?.name ?? team.coach ?? null,
    starters: (team.starters ?? []).map((player) => mapFotmobLineupPlayer(player, "starter", ratings, playerOfTheMatch)).filter(Boolean),
    substitutes: (team.subs ?? team.substitutes ?? []).map((player) => mapFotmobLineupPlayer(player, "substitute", ratings, playerOfTheMatch)).filter(Boolean),
    unavailable: mapUnavailablePlayers(
      firstArray(team.unavailable, team.unavailablePlayers, team.missingPlayers, team.absentPlayers, team.sidelined),
    ),
  };
}

function mapFotmobLineupPlayer(player, status, ratings, playerOfTheMatch) {
  const name = player?.name ?? [player?.firstName, player?.lastName].filter(Boolean).join(" ");
  if (!name) return null;

  const id = player.id != null ? String(player.id) : null;
  const shirtNumber = Number(player.shirtNumber);
  const rating = Number(player.performance?.rating ?? player.rating ?? ratings.get(id));
  const grid = fotmobGrid(player);

  return {
    id,
    name,
    position: fotmobPosition(player.positionId ?? player.usualPlayingPositionId) ?? fotmobPositionFromGrid(grid),
    shirtNumber: Number.isFinite(shirtNumber) ? shirtNumber : null,
    status,
    rating: Number.isFinite(rating) ? rating : null,
    grid,
    captain: player.isCaptain === true,
    playerOfTheMatch: isSameFotmobPlayer({ id, name }, playerOfTheMatch),
  };
}

function isSameFotmobPlayer(player, target) {
  if (!target?.id && !target?.name) return false;
  if (player.id && target.id && String(player.id) === String(target.id)) return true;
  return Boolean(player.name && target.name && normalizePlayerName(player.name) === normalizePlayerName(target.name));
}

function mapFotmobPlayerRatings(playerStats) {
  const ratings = new Map();
  if (!playerStats || typeof playerStats !== "object") return ratings;

  for (const [playerId, player] of Object.entries(playerStats)) {
    const rating = extractFotmobPlayerRating(player);
    if (rating != null) ratings.set(String(player?.id ?? playerId), rating);
  }

  return ratings;
}

function extractFotmobPlayerRating(player) {
  for (const group of player?.stats ?? []) {
    for (const stat of Object.values(group?.stats ?? {})) {
      const key = normalizeFotmobStatKey(stat?.key ?? stat?.title ?? "");
      if (key === "ratingtitle" || key === "fotmobrating") {
        const rating = Number(stat?.stat?.value ?? stat?.value);
        return Number.isFinite(rating) ? rating : null;
      }
    }
  }

  return null;
}

function fotmobPosition(positionId) {
  const value = Number(positionId);
  if (!Number.isFinite(value)) return null;
  if (value === 0 || value === 11) return "G";
  if (value === 1 || value === 32 || value === 34 || value === 36) return "D";
  if (value === 2 || value === 22 || value === 24 || value === 26) return "M";
  if (value === 3 || value === 13 || value === 23 || value === 33) return "F";
  return null;
}

function fotmobPositionFromGrid(grid) {
  const y = Number(String(grid ?? "").split(":")[1]);
  if (!Number.isFinite(y)) return null;
  if (y <= 0.2) return "G";
  if (y <= 0.45) return "D";
  if (y <= 0.75) return "M";
  return "F";
}

function fotmobGrid(player) {
  const layout = player?.verticalLayout ?? player?.horizontalLayout;
  if (!layout || layout.x == null || layout.y == null) return null;
  return `${Number(layout.x).toFixed(3)}:${Number(layout.y).toFixed(3)}`;
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

function fotmobStat(rows, keys, side = "home") {
  const row = findFotmobRow(rows, keys);
  if (!row) return null;
  const index = side === "away" ? 1 : 0;
  return parseFotmobStatValue(row.stats[index]);
}

function fotmobPassCount(rows, side = "home") {
  const row = findFotmobRow(rows, ["passes", "totalpasses", "accuratepasses"]);
  if (!row) return null;
  const index = side === "away" ? 1 : 0;
  return parseFotmobStatValue(row.stats[index]);
}

function fotmobPassAccuracy(rows, side = "home") {
  const accuracyRow = findFotmobRow(rows, ["passingaccuracy", "passaccuracy", "accuratepasses"]);
  if (!accuracyRow) return null;
  const index = side === "away" ? 1 : 0;
  return parseFotmobPercentage(accuracyRow.stats[index]);
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

function compactIsoDate(date) {
  return String(date).replace(/-/g, "");
}

async function loadApiFootballMatches(fixtureMap) {
  const dates = enumerateIsoDates(
    process.env.API_FOOTBALL_DATE_FROM ?? offsetIsoDate(todayIsoDate(), -2),
    process.env.API_FOOTBALL_DATE_TO ?? offsetIsoDate(todayIsoDate(), 1),
  );
  const responses = await Promise.all([
    apiFootballRequest("fixtures", { live: "all" }),
    ...dates.map((date) => apiFootballRequest("fixtures", { date })),
  ]);

  const byId = new Map();
  for (const fixture of responses.flat()) {
    const match = mapApiFootballFixture(fixture);
    if (match && hasFixturePair(match, fixtureMap)) {
      byId.set(String(fixture.fixture.id), match);
    }
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
    const [lineups, playerStats, events, statistics, injuries] = await Promise.all([
      apiFootballRequest("fixtures/lineups", { fixture: match.providerMatchId }),
      apiFootballRequest("fixtures/players", { fixture: match.providerMatchId }),
      apiFootballRequest("fixtures/events", { fixture: match.providerMatchId }),
      apiFootballRequest("fixtures/statistics", { fixture: match.providerMatchId }),
      apiFootballRequest("injuries", { fixture: match.providerMatchId }).catch((error) => {
        console.warn(`API-Football injuries unavailable for ${match.homeTeam} vs ${match.awayTeam}: ${error.message}`);
        return [];
      }),
    ]);

    return {
      lineups: mapApiFootballLineups(lineups, playerStats, match, injuries),
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
  const penaltyScore = parsePenaltyScore(
    fixture.score?.penalty?.home,
    fixture.score?.penalty?.away,
    fixture.score?.penalties?.home,
    fixture.score?.penalties?.away,
  );

  return {
    provider: "api-football",
    providerMatchId: String(fixture.fixture.id),
    homeTeamId: fixture.teams.home.id != null ? String(fixture.teams.home.id) : null,
    awayTeamId: fixture.teams.away.id != null ? String(fixture.teams.away.id) : null,
    homeTeam: fixture.teams.home.name,
    awayTeam: fixture.teams.away.name,
    homeScore: fixture.goals.home ?? 0,
    awayScore: fixture.goals.away ?? 0,
    homePenaltyScore: penaltyScore.homePenalty,
    awayPenaltyScore: penaltyScore.awayPenalty,
    minute: fixture.fixture.status.elapsed,
    stoppageMinute: fixture.fixture.status.extra,
    status: mapApiFootballStatus(status),
    phase: mapApiFootballPhase(status),
    kickoffTime: fixture.fixture.date,
    providerUpdatedAt: new Date().toISOString(),
  };
}

function mapApiFootballLineups(lineups, playerStats, match, injuries = []) {
  if (!Array.isArray(lineups) || lineups.length === 0) return null;

  const ratings = mapApiFootballRatings(playerStats);
  const unavailableByTeam = mapApiFootballUnavailableByTeam(injuries, match);
  const homeSource = lineups.find((lineup) => isSameProviderTeam(lineup.team, { id: match.homeTeamId, name: match.homeTeam })) ?? lineups[0];
  const awaySource = lineups.find((lineup) => isSameProviderTeam(lineup.team, { id: match.awayTeamId, name: match.awayTeam })) ?? lineups[1];

  if (!homeSource || !awaySource) return null;

  const home = mapApiFootballTeamLineup(homeSource, match.homeTeam, ratings, unavailableByTeam.home);
  const away = mapApiFootballTeamLineup(awaySource, match.awayTeam, ratings, unavailableByTeam.away);

  if (!hasLineupPlayers(home) && !hasLineupPlayers(away)) return null;

  return {
    provider: "api-football",
    lastUpdated: new Date().toISOString(),
    home,
    away,
  };
}

function mapApiFootballTeamLineup(lineup, fallbackTeamName, ratings, unavailable = []) {
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
    unavailable,
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
        substitutePlayerName: eventType === "substitution" ? event.assist?.name ?? null : null,
        description: event.comments ?? event.detail ?? null,
        createdAt: match.kickoffTime ?? new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function mapApiFootballEventType(event) {
  const type = String(event.type ?? "").toLowerCase();
  const detail = String(event.detail ?? "").toLowerCase();
  const comments = String(event.comments ?? "").toLowerCase();
  const combined = `${type} ${detail} ${comments}`;

  if (combined.includes("penalty shootout") || combined.includes("penalty shoot-out")) {
    if (combined.includes("miss") || combined.includes("saved")) return "penalty_shootout_miss";
    return "penalty_shootout_goal";
  }
  if (type.includes("injur") || detail.includes("injur")) return "injury";
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
  if (["ET", "BT"].includes(status)) return "extra_time";
  if (status === "P") return "penalties";
  if (["1H", "2H"].includes(status)) return "live";
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

async function loadFootballDataMatches(fixtureMap) {
  const json = await footballDataRequest("competitions/WC/matches", {
    dateFrom: process.env.FOOTBALL_DATA_DATE_FROM ?? offsetIsoDate(todayIsoDate(), -2),
    dateTo: process.env.FOOTBALL_DATA_DATE_TO ?? offsetIsoDate(todayIsoDate(), 1),
  });

  return (json.matches ?? []).map(mapFootballDataMatch).filter((match) => hasFixturePair(match, fixtureMap));
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

  const deduped = new Map();
  for (const match of [...bestByFixturePair.values(), ...bestByProviderMatch.values()]) {
    const key = teamPairKey(match.homeTeam, match.awayTeam);
    const current = deduped.get(key);
    if (!current || isBetterScoreMatch(match, current)) {
      deduped.set(key, match);
    }
  }

  return [...deduped.values()];
}

function filterProviderMatchesForFixtures(matches, fixtureMap) {
  return matches.filter((match) => hasFixturePair(match, fixtureMap));
}

function hasFixturePair(match, fixtureMap) {
  return (
    fixtureMap.has(teamPairKey(match.homeTeam, match.awayTeam)) ||
    fixtureMap.has(teamPairKey(match.awayTeam, match.homeTeam))
  );
}

function isBetterScoreMatch(candidate, current) {
  const providerDelta = scoreProviderPriority(current.provider) - scoreProviderPriority(candidate.provider);
  if (providerDelta !== 0) return providerDelta > 0;

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
  return Number(match.homeScore ?? match.home_score ?? 0) + Number(match.awayScore ?? match.away_score ?? 0);
}

function scoreProviderPriority(provider) {
  return providerPriority.get(provider) ?? providerOrder.length;
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
  const status = mapFootballDataStatus(match.status, minute);
  const penaltyScore = parsePenaltyScore(
    match.score?.penalties?.home,
    match.score?.penalties?.away,
    match.score?.penalty?.home,
    match.score?.penalty?.away,
  );

  return {
    provider: "football-data",
    providerMatchId: String(match.id),
    homeTeam: match.homeTeam.name,
    awayTeam: match.awayTeam.name,
    homeScore: match.score.fullTime.home ?? match.score.halfTime.home ?? 0,
    awayScore: match.score.fullTime.away ?? match.score.halfTime.away ?? 0,
    homePenaltyScore: penaltyScore.homePenalty,
    awayPenaltyScore: penaltyScore.awayPenalty,
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
    unavailable: mapUnavailablePlayers(
      firstArray(source?.unavailable, source?.unavailablePlayers, source?.missingPlayers, source?.absentPlayers, source?.sidelined),
    ),
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

function mapApiFootballUnavailableByTeam(injuries, match) {
  const unavailableByTeam = { home: [], away: [] };

  for (const injury of injuries ?? []) {
    const player = mapUnavailablePlayer(injury, "injured");
    if (!player) continue;

    if (isSameProviderTeam(injury.team, { id: match.homeTeamId, name: match.homeTeam })) {
      unavailableByTeam.home.push(player);
    } else if (isSameProviderTeam(injury.team, { id: match.awayTeamId, name: match.awayTeam })) {
      unavailableByTeam.away.push(player);
    }
  }

  return unavailableByTeam;
}

function mapUnavailablePlayers(players) {
  return players.map((player) => mapUnavailablePlayer(player)).filter(Boolean);
}

function mapUnavailablePlayer(entry, fallbackStatus = "unavailable") {
  const player = entry?.player ?? entry;
  const name = player?.name ?? player?.displayName ?? player?.fullName ?? entry?.name;
  if (!name) return null;

  const reason = player?.reason ?? entry?.reason ?? entry?.type ?? entry?.detail ?? entry?.status ?? null;
  const status = unavailableStatus(reason, fallbackStatus);
  const shirtNumber = Number(player?.number ?? player?.shirtNumber ?? entry?.number ?? entry?.shirtNumber);

  return {
    id: player?.id != null ? String(player.id) : null,
    name,
    position: player?.position ?? player?.pos ?? entry?.position ?? null,
    shirtNumber: Number.isFinite(shirtNumber) ? shirtNumber : null,
    reason,
    status,
  };
}

function unavailableStatus(reason, fallbackStatus = "unavailable") {
  const normalized = String(reason ?? "").toLowerCase();
  if (normalized.includes("susp")) return "suspended";
  if (normalized.includes("injur") || normalized.includes("ill") || normalized.includes("knock")) return "injured";
  return fallbackStatus;
}

function hasLineupPlayers(lineup) {
  return lineup.starters.length > 0 || lineup.substitutes.length > 0 || (lineup.unavailable ?? []).length > 0;
}

function isSameProviderTeam(candidate, expected) {
  if (!candidate || !expected) return false;
  if (candidate.id != null && expected.id != null && String(candidate.id) === String(expected.id)) return true;
  return normalizeTeamName(candidate.name ?? candidate.shortName ?? "") === normalizeTeamName(expected.name ?? expected.shortName ?? "");
}

function mapFootballDataStatus(status, minute) {
  if (status === "FINISHED") return "finished";
  if (status === "PAUSED") return "half_time";
  if (["EXTRA_TIME", "IN_EXTRA_TIME"].includes(status)) return "extra_time";
  if (["PENALTY_SHOOTOUT", "PENALTIES"].includes(status)) return "penalties";
  if (["LIVE", "IN_PLAY"].includes(status) && typeof minute === "number" && minute > 90) return "extra_time";
  if (["LIVE", "IN_PLAY"].includes(status)) return "live";
  return "scheduled";
}

function mapFootballDataPhase(status, minute) {
  if (status === "FINISHED") return "full_time";
  if (status === "PAUSED") return "half_time";
  if (["EXTRA_TIME", "IN_EXTRA_TIME"].includes(status)) return "extra_time";
  if (["PENALTY_SHOOTOUT", "PENALTIES"].includes(status)) return "penalties";
  if (["LIVE", "IN_PLAY"].includes(status)) {
    if (typeof minute === "number" && minute > 90) return "extra_time";
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
    let json;
    try {
      json = await espnScoreboardRequest(date);
    } catch (error) {
      console.warn(`ESPN completed scoreboard unavailable for ${date}: ${error.message}`);
      continue;
    }

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
  const penaltyScore = mapEspnPenaltyScore(competition, home, away);

  return {
    provider: "espn",
    providerMatchId: String(event.id),
    homeTeam: home.team?.displayName ?? home.team?.shortDisplayName,
    awayTeam: away.team?.displayName ?? away.team?.shortDisplayName,
    homeScore: Number(home.score ?? 0),
    awayScore: Number(away.score ?? 0),
    homePenaltyScore: penaltyScore.homePenalty,
    awayPenaltyScore: penaltyScore.awayPenalty,
    minute: mapEspnMinute(competition),
    stoppageMinute: null,
    status: mapEspnStatus(statusType, competition),
    phase: mapEspnPhase(statusType, competition),
    kickoffTime: competition.date ?? event.date,
    providerUpdatedAt: new Date().toISOString(),
    statistics: mapEspnStatistics(home, away, competition.details ?? []),
    events: mapEspnEvents(competition, teamById),
  };
}

function mapEspnStatus(statusType, competition) {
  if (statusType?.completed) return "finished";
  const statusName = String(statusType?.name ?? statusType?.description ?? "").toUpperCase();
  if (statusName.includes("PENAL")) return "penalties";
  if (statusName.includes("EXTRA") || statusName.includes("AET")) return "extra_time";
  if (Number(competition.status?.period ?? 0) > 2) return "extra_time";
  if (statusType?.state === "in") return "live";
  if (statusType?.state === "post") return "finished";
  return "scheduled";
}

function mapEspnPhase(statusType, competition) {
  if (statusType?.completed || statusType?.state === "post") return "full_time";

  const period = Number(competition.status?.period ?? 0);
  const statusName = String(statusType?.name ?? statusType?.description ?? "").toUpperCase();
  if (statusName.includes("PENAL")) return "penalties";
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
  const homeYellowCards = countEspnCards(details, home.id, "yellow_card");
  const awayYellowCards = countEspnCards(details, away.id, "yellow_card");
  const homeSecondYellowCards = countEspnCards(details, home.id, "second_yellow");
  const awaySecondYellowCards = countEspnCards(details, away.id, "second_yellow");

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
    homeYellowCards: homeYellowCards + homeSecondYellowCards,
    awayYellowCards: awayYellowCards + awaySecondYellowCards,
    homeRedCards: countEspnCards(details, home.id, "red_card") + homeSecondYellowCards,
    awayRedCards: countEspnCards(details, away.id, "red_card") + awaySecondYellowCards,
    homeCorners: espnStat(home, "wonCorners") ?? 0,
    awayCorners: espnStat(away, "wonCorners") ?? 0,
    homeFouls: espnStat(home, "foulsCommitted") ?? 0,
    awayFouls: espnStat(away, "foulsCommitted") ?? 0,
    homeOffsides: espnStat(home, "totalOffside") ?? espnStat(home, "offsides") ?? espnStat(home, "offside") ?? 0,
    awayOffsides: espnStat(away, "totalOffside") ?? espnStat(away, "offsides") ?? espnStat(away, "offside") ?? 0,
  };
}

function mapEspnPenaltyScore(competition, home, away) {
  const directScore = parsePenaltyScore(
    home.shootoutScore ?? home.penaltyScore ?? home.penalties,
    away.shootoutScore ?? away.penaltyScore ?? away.penalties,
    home.score?.shootout ?? home.score?.penalties,
    away.score?.shootout ?? away.score?.penalties,
  );
  if (directScore.homePenalty != null && directScore.awayPenalty != null) {
    return directScore;
  }

  const shootoutDetails = (competition.details ?? []).filter((detail) => detail.shootout);
  if (shootoutDetails.length === 0) {
    return { homePenalty: null, awayPenalty: null };
  }

  let homePenalty = 0;
  let awayPenalty = 0;
  for (const detail of shootoutDetails) {
    if (!isSuccessfulShootoutAttempt(detail)) continue;

    const teamId = String(detail.team?.id ?? "");
    if (teamId === String(home.id)) homePenalty++;
    if (teamId === String(away.id)) awayPenalty++;
  }

  return { homePenalty, awayPenalty };
}

function isSuccessfulShootoutAttempt(detail) {
  if (detail.scoringPlay === true) return true;
  if (detail.scoreValue != null) return Number(detail.scoreValue) > 0;

  const text = String(detail.type?.text ?? detail.type?.description ?? detail.text ?? "").toLowerCase();
  return text.includes("scored") || text.includes("made");
}

function mapEspnEvents(competition, teamById) {
  const goalEvents = (competition.details ?? [])
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

  const cardEvents = (competition.details ?? [])
    .filter((detail) => !detail.shootout)
    .map((detail, index) => {
      const eventType = mapEspnCardEventType(detail);
      if (!eventType) return null;

      const timing = parseEspnClock(detail.clock?.displayValue);
      const player = detail.athletesInvolved?.[0]?.displayName ?? parsePlayerFromCardText(detail.text);
      const teamName = teamById.get(String(detail.team?.id)) ?? detail.team?.displayName ?? null;

      return {
        externalEventId: `espn:${competition.id}:card:${index}:${detail.clock?.displayValue ?? "0"}:${detail.type?.id ?? eventType}:${detail.athletesInvolved?.[0]?.id ?? player ?? "unknown"}`,
        provider: "espn",
        minute: timing.minute,
        stoppageMinute: timing.stoppageMinute,
        sequenceNumber: goalEvents.length + index + 1,
        eventType,
        teamName,
        playerName: player,
        assistPlayerName: null,
        description: detail.text ?? null,
        createdAt: competition.date ?? new Date().toISOString(),
      };
    })
    .filter(Boolean);

  const shootoutEvents = (competition.details ?? [])
    .filter((detail) => detail.shootout)
    .map((detail, index) => {
      const teamName = teamById.get(String(detail.team?.id)) ?? detail.team?.displayName ?? null;
      const player = detail.athletesInvolved?.[0]?.displayName ?? null;
      const scored = isSuccessfulShootoutAttempt(detail);

      return {
        externalEventId: `espn:${competition.id}:shootout:${index}:${detail.type?.id ?? (scored ? "goal" : "miss")}:${detail.athletesInvolved?.[0]?.id ?? player ?? "unknown"}`,
        provider: "espn",
        minute: 120,
        stoppageMinute: null,
        sequenceNumber: goalEvents.length + cardEvents.length + index + 1,
        eventType: scored ? "penalty_shootout_goal" : "penalty_shootout_miss",
        teamName,
        playerName: player,
        assistPlayerName: null,
        description: detail.text ?? null,
        createdAt: competition.date ?? new Date().toISOString(),
      };
    });

  return [...goalEvents, ...cardEvents, ...shootoutEvents].sort((a, b) => {
    const minuteDiff = (a.minute ?? 0) - (b.minute ?? 0);
    if (minuteDiff !== 0) return minuteDiff;
    return (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0);
  });
}

function parseAssistFromText(text) {
  const match = String(text ?? "").match(/\bassist(?:ed by)?(?:\s*[:\-]\s*|\s+by\s+)([^.;,)]+)/i);
  return match?.[1]?.trim() ?? null;
}

function mapEspnCardEventType(detail) {
  const typeId = String(detail.type?.id ?? "").toLowerCase();
  const typeText = String(detail.type?.text ?? detail.type?.description ?? detail.text ?? "").toLowerCase();
  const combined = `${typeId} ${typeText}`;

  if (!combined.includes("card")) return null;
  if (combined.includes("second") && combined.includes("yellow")) return "second_yellow";
  if (combined.includes("red")) return "red_card";
  if (combined.includes("yellow")) return "yellow_card";
  return null;
}

function parsePlayerFromCardText(text) {
  const normalized = String(text ?? "").trim();
  const match = normalized.match(/^(.+?)\s+(?:is\s+)?(?:shown\s+)?(?:a\s+)?(?:yellow|red|second yellow)\s+card/i);
  return match?.[1]?.trim() ?? null;
}

function espnStat(competitor, name) {
  const stat = competitor.statistics?.find((item) => item.name === name);
  if (!stat) return null;

  const value = Number.parseFloat(String(stat.value ?? stat.displayValue).replace("%", ""));
  return Number.isFinite(value) ? value : null;
}

function countEspnCards(details, teamId, eventType) {
  return details.filter((detail) => String(detail.team?.id) === String(teamId) && mapEspnCardEventType(detail) === eventType).length;
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

async function upsertLiveState(fixture, match, options = {}) {
  const existingState = await getExistingLiveState(fixture.id);

  if (shouldSkipLiveStateUpdate(existingState, match)) {
    return;
  }

  const now = new Date().toISOString();
  const finalScoreConfirmedAt = match.status === "finished"
    ? existingState?.final_score_confirmed_at ?? match.providerUpdatedAt ?? now
    : null;
  const phase = normalizePhase(match.phase);
  const statistics = mergeMatchStatistics(match.statistics, statisticsFromEvents(match.events, fixture));
  const statisticColumns = mapStatisticColumns(statistics, existingState, options);
  const lineupColumns = mapLineupColumns(match.lineups ?? getKnownLineupsForFixture(fixture), existingState);
  const penaltyColumns = mapPenaltyScoreColumns(match, existingState);

  const { error } = await supabase.from("live_match_state").upsert(
    {
      match_id: fixture.id,
      home_team: fixture.home_team,
      away_team: fixture.away_team,
      home_score: match.homeScore,
      away_score: match.awayScore,
      ...penaltyColumns,
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
    .select("status, phase, period, home_score, away_score, home_penalty_score, away_penalty_score, minute, final_score_confirmed_at, provider_updated_at, updated_at, home_possession, away_possession, home_shots, away_shots, home_shots_on_target, away_shots_on_target, home_expected_goals, away_expected_goals, home_passes, away_passes, home_passing_accuracy, away_passing_accuracy, home_yellow_cards, away_yellow_cards, home_red_cards, away_red_cards, home_corners, away_corners, home_fouls, away_fouls, home_offsides, away_offsides, lineups, lineups_provider, lineups_updated_at")
    .eq("match_id", matchId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load existing live state for match ${matchId}: ${error.message}`);
  }

  return data;
}

function mapPenaltyScoreColumns(match, existingState) {
  const incomingHomePenaltyScore = firstFiniteNumber(match.homePenaltyScore);
  const incomingAwayPenaltyScore = firstFiniteNumber(match.awayPenaltyScore);
  const existingHomePenaltyScore = firstFiniteNumber(existingState?.home_penalty_score);
  const existingAwayPenaltyScore = firstFiniteNumber(existingState?.away_penalty_score);

  const incomingHasShootoutScore =
    incomingHomePenaltyScore != null &&
    incomingAwayPenaltyScore != null &&
    (incomingHomePenaltyScore > 0 || incomingAwayPenaltyScore > 0 || match.status === "penalties" || match.phase === "penalties");
  const existingHasShootoutScore =
    existingHomePenaltyScore != null &&
    existingAwayPenaltyScore != null &&
    (existingHomePenaltyScore > 0 || existingAwayPenaltyScore > 0);

  const homePenaltyScore = incomingHasShootoutScore ? incomingHomePenaltyScore : existingHasShootoutScore ? existingHomePenaltyScore : null;
  const awayPenaltyScore = incomingHasShootoutScore ? incomingAwayPenaltyScore : existingHasShootoutScore ? existingAwayPenaltyScore : null;

  if (homePenaltyScore == null || awayPenaltyScore == null) {
    return {};
  }

  return {
    home_penalty_score: homePenaltyScore,
    away_penalty_score: awayPenaltyScore,
  };
}

function shouldSkipLiveStateUpdate(existingState, incomingMatch) {
  if (!existingState) return false;

  const existingStatus = normalizeStatus(existingState.status);
  const incomingStatus = normalizeStatus(incomingMatch.status);
  const existingScore = scoreValue(existingState);
  const incomingScore = scoreValue(incomingMatch);

  if (hasConfirmedFinalScore(existingState) && incomingStatus !== "finished") {
    return true;
  }

  if (incomingStatus === "scheduled" && existingStatus !== "scheduled") {
    return true;
  }

  if (isActiveStatus(existingStatus) && incomingStatus === "scheduled") {
    return true;
  }

  if (
    isActiveStatus(existingStatus) &&
    isActiveStatus(incomingStatus) &&
    incomingScore < existingScore
  ) {
    return true;
  }

  if (
    existingStatus === "finished" &&
    existingScore > 0 &&
    incomingStatus === "finished" &&
    incomingScore < existingScore
  ) {
    return true;
  }

  return false;
}

function normalizeStatus(status) {
  if (status === "live" || status === "half_time" || status === "extra_time" || status === "penalties" || status === "finished") {
    return status;
  }
  return "scheduled";
}

function isActiveStatus(status) {
  return status === "live" || status === "half_time" || status === "extra_time" || status === "penalties";
}

function mapLineupColumns(lineups, existingState) {
  const incomingLineups = hasStoredLineups(lineups) ? lineups : null;
  const shouldKeepExistingProviderLineups =
    incomingLineups?.provider === "manual-verified" &&
    hasStoredLineups(existingState?.lineups) &&
    existingState?.lineups_provider &&
    existingState.lineups_provider !== "manual-verified";
  const nextLineups = shouldKeepExistingProviderLineups
    ? existingState.lineups
    : incomingLineups ?? existingState?.lineups;
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

function countLineupRatings(lineups) {
  if (!lineups?.home || !lineups?.away) return 0;

  const players = [
    ...(lineups.home.starters ?? []),
    ...(lineups.home.substitutes ?? []),
    ...(lineups.away.starters ?? []),
    ...(lineups.away.substitutes ?? []),
  ];

  return players.filter((player) => player.rating != null).length;
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

function statisticsFromEvents(events = [], fixture) {
  const statistics = {
    homeYellowCards: 0,
    awayYellowCards: 0,
    homeRedCards: 0,
    awayRedCards: 0,
  };
  let hasCardEvents = false;

  for (const event of events) {
    if (!["yellow_card", "red_card", "second_yellow"].includes(event.eventType)) continue;

    const teamKey = event.teamName ? normalizeTeamName(event.teamName) : null;
    const side = teamKey === normalizeTeamName(fixture.home_team)
      ? "home"
      : teamKey === normalizeTeamName(fixture.away_team)
        ? "away"
        : null;

    if (!side) continue;
    hasCardEvents = true;

    if (event.eventType === "yellow_card" || event.eventType === "second_yellow") {
      statistics[`${side}YellowCards`]++;
    }
    if (event.eventType === "red_card" || event.eventType === "second_yellow") {
      statistics[`${side}RedCards`]++;
    }
  }

  return hasCardEvents ? statistics : {};
}

function mapStatisticColumns(statistics, existingState, options = {}) {
  const preferExistingStats = options.preserveExistingStats && hasDetailedStatistics(existingState);
  const mergeStat = (incoming, existing) => (
    preferExistingStats ? preferExistingStat(existing, incoming) : firstDefined(incoming, existing)
  );

  return compactObject({
    home_possession: mergeStat(statistics.homePossession, existingState?.home_possession),
    away_possession: mergeStat(statistics.awayPossession, existingState?.away_possession),
    home_shots: mergeStat(statistics.homeShots, existingState?.home_shots),
    away_shots: mergeStat(statistics.awayShots, existingState?.away_shots),
    home_shots_on_target: mergeStat(statistics.homeShotsOnTarget, existingState?.home_shots_on_target),
    away_shots_on_target: mergeStat(statistics.awayShotsOnTarget, existingState?.away_shots_on_target),
    home_expected_goals: mergeStat(statistics.homeExpectedGoals, existingState?.home_expected_goals),
    away_expected_goals: mergeStat(statistics.awayExpectedGoals, existingState?.away_expected_goals),
    home_passes: mergeStat(statistics.homePasses, existingState?.home_passes),
    away_passes: mergeStat(statistics.awayPasses, existingState?.away_passes),
    home_passing_accuracy: mergeStat(statistics.homePassingAccuracy, existingState?.home_passing_accuracy),
    away_passing_accuracy: mergeStat(statistics.awayPassingAccuracy, existingState?.away_passing_accuracy),
    home_yellow_cards: mergeStat(statistics.homeYellowCards, existingState?.home_yellow_cards),
    away_yellow_cards: mergeStat(statistics.awayYellowCards, existingState?.away_yellow_cards),
    home_red_cards: mergeStat(statistics.homeRedCards, existingState?.home_red_cards),
    away_red_cards: mergeStat(statistics.awayRedCards, existingState?.away_red_cards),
    home_corners: mergeStat(statistics.homeCorners, existingState?.home_corners),
    away_corners: mergeStat(statistics.awayCorners, existingState?.away_corners),
    home_fouls: mergeStat(statistics.homeFouls, existingState?.home_fouls),
    away_fouls: mergeStat(statistics.awayFouls, existingState?.away_fouls),
    home_offsides: mergeStat(statistics.homeOffsides, existingState?.home_offsides),
    away_offsides: mergeStat(statistics.awayOffsides, existingState?.away_offsides),
  });
}

function preferExistingStat(existing, incoming) {
  if (existing == null) return incoming;
  if (incoming == null) return existing;
  if (Number(existing) === 0 && Number(incoming) > 0) return incoming;
  return existing;
}

function hasDetailedStatistics(state) {
  if (!state) return false;

  return [
    state.home_expected_goals,
    state.away_expected_goals,
    state.home_passes,
    state.away_passes,
    state.home_passing_accuracy,
    state.away_passing_accuracy,
    state.home_shots,
    state.away_shots,
    state.home_shots_on_target,
    state.away_shots_on_target,
    state.home_corners,
    state.away_corners,
    state.home_fouls,
    state.away_fouls,
  ].some((value) => value != null && value !== 0);
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

  const eventTypes = [...new Set(match.events.map((event) => event.eventType).filter(Boolean))];
  const { error: deleteError } = await supabase
    .from("match_events")
    .delete()
    .eq("match_id", fixture.id)
    .in("event_type", eventTypes);

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
    substitute_player_name: event.substitutePlayerName ?? null,
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

function normalizePlayerName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
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
