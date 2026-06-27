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
  const { data: rows, error } = await supabase
    .from("fixture_live_scoreboard_view")
    .select("fixture_id,home_team,away_team,status,phase,home_score,away_score,minute,final_score_confirmed_at,updated_at")
    .in("status", ["finished", "live", "half_time", "extra_time", "penalties"])
    .order("fixture_id", { ascending: true });

  if (error) throw error;

  const activeOrFinished = rows ?? [];
  const unconfirmedFinished = activeOrFinished.filter(
    (row) => row.status === "finished" && !row.final_score_confirmed_at,
  );
  const suspiciousFinishedScoreless = activeOrFinished.filter(
    (row) => row.status === "finished" && row.home_score === 0 && row.away_score === 0,
  );

  console.log(`Active/finished scoreboard rows: ${activeOrFinished.length}`);
  console.log(`Finished rows without final_score_confirmed_at: ${unconfirmedFinished.length}`);
  console.log(`Confirmed finished 0-0 rows: ${suspiciousFinishedScoreless.length}`);

  for (const row of activeOrFinished.slice(0, 80)) {
    console.log(
      [
        `#${row.fixture_id}`,
        `${row.home_team} ${row.home_score}-${row.away_score} ${row.away_team}`,
        row.status,
        row.phase,
        row.final_score_confirmed_at ? "confirmed" : "unconfirmed",
      ].join(" | "),
    );
  }

  if (suspiciousFinishedScoreless.length > 0) {
    console.log("Confirmed 0-0 rows:");
    for (const row of suspiciousFinishedScoreless) {
      console.log(JSON.stringify(row));
    }
  }

  if (unconfirmedFinished.length > 0) {
    console.log("Rows needing review:");
    for (const row of unconfirmedFinished) {
      console.log(JSON.stringify(row));
    }
    process.exitCode = 1;
  }
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
