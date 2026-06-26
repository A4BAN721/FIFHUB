const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

loadEnvFile(process.env.ENV_FILE_PATH ?? path.join(process.cwd(), ".env.local"));

const matchId = process.argv[2] ?? "1";
const usePublicKey = process.argv.includes("--public");
const scanMissing = process.argv.includes("--scan-missing");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = usePublicKey
  ? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  : process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(`Missing NEXT_PUBLIC_SUPABASE_URL or ${usePublicKey ? "public Supabase key" : "SUPABASE_SERVICE_ROLE_KEY"}.`);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (scanMissing) {
    await scanMissingLiveStats();
    return;
  }

  const { data, error } = await supabase
    .from("live_match_state")
    .select("match_id,home_team,away_team,home_possession,away_possession,home_expected_goals,away_expected_goals,home_shots,away_shots,home_shots_on_target,away_shots_on_target,home_passes,away_passes,home_passing_accuracy,away_passing_accuracy,home_corners,away_corners,home_offsides,away_offsides,home_fouls,away_fouls,home_yellow_cards,away_yellow_cards,home_red_cards,away_red_cards,lineups_provider,lineups_updated_at,lineups")
    .eq("match_id", matchId)
    .single();

  if (error) throw error;

  const players = [
    ...(data.lineups?.home?.starters ?? []),
    ...(data.lineups?.home?.substitutes ?? []),
    ...(data.lineups?.away?.starters ?? []),
    ...(data.lineups?.away?.substitutes ?? []),
  ];

  console.log(JSON.stringify({
    matchId: data.match_id,
    match: `${data.home_team} vs ${data.away_team}`,
    keyMode: usePublicKey ? "public" : "service",
    stats: {
      possession: [data.home_possession, data.away_possession],
      expectedGoals: [data.home_expected_goals, data.away_expected_goals],
      shots: [data.home_shots, data.away_shots],
      shotsOnTarget: [data.home_shots_on_target, data.away_shots_on_target],
      passes: [data.home_passes, data.away_passes],
      passingAccuracy: [data.home_passing_accuracy, data.away_passing_accuracy],
      corners: [data.home_corners, data.away_corners],
      offsides: [data.home_offsides, data.away_offsides],
      fouls: [data.home_fouls, data.away_fouls],
      yellowCards: [data.home_yellow_cards, data.away_yellow_cards],
      redCards: [data.home_red_cards, data.away_red_cards],
    },
    lineupsProvider: data.lineups_provider,
    lineupsUpdatedAt: data.lineups_updated_at,
    players: players.length,
    ratings: players.filter((player) => player.rating != null).length,
  }, null, 2));
}

async function scanMissingLiveStats() {
  const { data, error } = await supabase
    .from("live_match_state")
    .select("match_id,home_team,away_team,status,home_expected_goals,away_expected_goals,home_passes,away_passes,home_passing_accuracy,away_passing_accuracy,lineups_provider,lineups_updated_at")
    .order("match_id", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []).map((row) => {
    const missing = [];
    if (row.home_expected_goals == null || row.away_expected_goals == null) missing.push("xG");
    if (row.home_passes == null || row.away_passes == null) missing.push("passes");
    if (row.home_passing_accuracy == null || row.away_passing_accuracy == null) missing.push("passingAccuracy");

    return {
      matchId: row.match_id,
      match: `${row.home_team} vs ${row.away_team}`,
      status: row.status,
      provider: row.lineups_provider,
      missing,
      stats: {
        expectedGoals: [row.home_expected_goals, row.away_expected_goals],
        passes: [row.home_passes, row.away_passes],
        passingAccuracy: [row.home_passing_accuracy, row.away_passing_accuracy],
      },
    };
  });

  const incompleteRows = rows.filter((row) => row.missing.length > 0);

  console.log(JSON.stringify({
    keyMode: usePublicKey ? "public" : "service",
    checked: rows.length,
    incomplete: incompleteRows.length,
    sample: incompleteRows.slice(0, 30),
  }, null, 2));
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
