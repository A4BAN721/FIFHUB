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

const roundOf32Fixtures = [
  fixture("73", "Monday, 29 June 2026", "1:00 AM", "South Africa", "Canada"),
  fixture("74", "Monday, 29 June 2026", "11:00 PM", "Brazil", "Japan"),
  fixture("75", "Tuesday, 30 June 2026", "2:30 AM", "Germany", "Paraguay"),
  fixture("76", "Tuesday, 30 June 2026", "7:00 AM", "Netherlands", "Morocco"),
  fixture("77", "Tuesday, 30 June 2026", "11:00 PM", "Ivory Coast", "Norway"),
  fixture("78", "Wednesday, 1 July 2026", "3:00 AM", "France", "Sweden"),
  fixture("79", "Wednesday, 1 July 2026", "7:00 AM", "Mexico", "Ecuador"),
  fixture("80", "Wednesday, 1 July 2026", "10:00 PM", "England", "DR Congo"),
  fixture("81", "Thursday, 2 July 2026", "2:00 AM", "Belgium", "Senegal"),
  fixture("82", "Thursday, 2 July 2026", "6:00 AM", "USA", "Bosnia & Herzegovina"),
  fixture("83", "Friday, 3 July 2026", "1:00 AM", "Spain", "Austria"),
  fixture("84", "Friday, 3 July 2026", "5:00 AM", "Portugal", "Croatia"),
  fixture("85", "Friday, 3 July 2026", "9:00 AM", "Switzerland", "Algeria"),
  fixture("86", "Saturday, 4 July 2026", "12:00 AM", "Australia", "Egypt"),
  fixture("87", "Saturday, 4 July 2026", "4:00 AM", "Argentina", "Cabo Verde"),
  fixture("88", "Saturday, 4 July 2026", "7:30 AM", "Colombia", "Ghana"),
];

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  let updated = 0;
  for (const row of roundOf32Fixtures) {
    const { error } = await supabase
      .from("match_fixtures")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (error) {
      throw new Error(`Failed to update fixture ${row.id}: ${error.message}`);
    }

    updated++;
  }

  console.log(`Updated ${updated} Round of 32 fixtures.`);
}

function fixture(id, matchDate, matchTime, homeTeam, awayTeam) {
  return {
    id,
    match_date: matchDate,
    match_time: matchTime,
    stage: "ROUND OF 32",
    group_name: null,
    home_team: homeTeam,
    away_team: awayTeam,
  };
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    if (process.env[key]) continue;
    process.env[key] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}
