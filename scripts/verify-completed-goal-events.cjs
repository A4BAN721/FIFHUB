const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

loadEnvFile(process.env.ENV_FILE_PATH ?? path.join(process.cwd(), ".env.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  const { data: matches, error: matchError } = await supabase
    .from("live_match_state")
    .select("match_id,home_team,away_team,home_score,away_score,status")
    .eq("status", "finished")
    .order("match_id", { ascending: true });

  if (matchError) throw matchError;

  const matchIds = (matches ?? []).map((match) => match.match_id);
  const { data: events, error: eventError } = await supabase
    .from("match_events")
    .select("match_id,event_type,team_name,player_name,assist_player_name,minute,stoppage_minute,sequence_number,provider")
    .in("match_id", matchIds)
    .in("event_type", ["goal", "penalty_goal", "own_goal"])
    .order("match_id", { ascending: true })
    .order("minute", { ascending: true })
    .order("stoppage_minute", { ascending: true });

  if (eventError) throw eventError;

  const eventsByMatch = new Map();
  for (const event of events ?? []) {
    if (!eventsByMatch.has(event.match_id)) eventsByMatch.set(event.match_id, []);
    eventsByMatch.get(event.match_id).push(event);
  }

  const summary = (matches ?? []).map((match) => {
    const goals = eventsByMatch.get(match.match_id) ?? [];
    const assists = goals.filter((goal) => goal.assist_player_name).length;
    const penalties = goals.filter((goal) => goal.event_type === "penalty_goal").length;

    return {
      matchId: match.match_id,
      match: `${match.home_team} vs ${match.away_team}`,
      score: `${match.home_score}-${match.away_score}`,
      goals: goals.length,
      assists,
      penalties,
      providers: [...new Set(goals.map((goal) => goal.provider).filter(Boolean))],
      homeGoals: formatTeamGoals(goals, match.home_team),
      awayGoals: formatTeamGoals(goals, match.away_team),
    };
  });

  console.log(JSON.stringify({
    completedMatches: summary.length,
    totalGoals: summary.reduce((total, match) => total + match.goals, 0),
    totalAssists: summary.reduce((total, match) => total + match.assists, 0),
    totalPenalties: summary.reduce((total, match) => total + match.penalties, 0),
    missingGoalEvents: summary.filter((match) => match.goals === 0 && match.score !== "0-0").slice(0, 20),
    sample: summary.slice(0, 20),
  }, null, 2));
}

function formatTeamGoals(goals, teamName) {
  return goals
    .filter((goal) => isSameTeam(goal.team_name, teamName))
    .sort(compareGoalEvents)
    .map((goal) => {
      const penaltyMarker = goal.event_type === "penalty_goal" ? " (P)" : "";
      const assist = goal.assist_player_name ? `, assist: ${goal.assist_player_name}` : "";
      return `${goal.player_name ?? "Unknown scorer"}${penaltyMarker} ${formatMinute(goal)}${assist}`;
    });
}

function compareGoalEvents(a, b) {
  return (
    (a.minute ?? 0) - (b.minute ?? 0) ||
    (a.stoppage_minute ?? 0) - (b.stoppage_minute ?? 0) ||
    (a.sequence_number ?? 0) - (b.sequence_number ?? 0)
  );
}

function formatMinute(event) {
  return `${event.minute ?? 0}${event.stoppage_minute ? `+${event.stoppage_minute}` : ""}'`;
}

function isSameTeam(eventTeamName, teamName) {
  return normalizeTeamName(eventTeamName) === normalizeTeamName(teamName);
}

function normalizeTeamName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
