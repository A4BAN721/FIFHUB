const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { Client } = require("pg");

const rootDir = path.resolve(__dirname, "..");

function getPostgresSslConfig(connectionString) {
  const url = new URL(connectionString);
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);

  return localHostnames.has(url.hostname) ? false : { rejectUnauthorized: false };
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);
    process.env[key] ??= value;
  }
}

function requireTypeScript(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      resolveJsonModule: true,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  mod._compile(output, filePath);
  return mod.exports;
}

function ensureEnv() {
  loadEnvFile(path.join(rootDir, ".env.local"));
  loadEnvFile(path.join(rootDir, ".env"));

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check your environment configuration.");
  }
}

async function createSchema(client) {
  const { rows } = await client.query(`
    select count(*)::int as existing_tables
    from pg_tables
    where schemaname = 'public'
      and tablename in ('nations', 'squad_players', 'match_fixtures', 'translations');
  `);

  const hasAllTables = rows[0]?.existing_tables === 4;

  if (!hasAllTables) {
    await client.query(`
      create table if not exists public.nations (
      id text primary key,
      name text not null,
      code text not null,
      flag text not null,
      confederation text not null,
      total_squad_value text not null,
      jersey_colors jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists public.squad_players (
      id text primary key,
      nation_id text not null references public.nations(id) on delete cascade,
      full_name text not null,
      position text not null,
      club text not null,
      height text not null,
      weight text not null,
      strong_foot text not null,
      market_value text not null,
      jersey_number integer not null,
      age integer,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists squad_players_nation_id_idx on public.squad_players(nation_id);

    create table if not exists public.match_fixtures (
      id text primary key,
      match_date text not null,
      match_time text not null,
      stage text not null,
      group_name text,
      home_team text not null,
      away_team text not null,
      stadium text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists public.translations (
      locale text not null,
      translation_key text not null,
      translation_value text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (locale, translation_key)
    );

    `);
  }

  await client.query(`
    alter table public.squad_players
      add column if not exists age integer;
  `);

  await client.query(`
      alter table public.nations enable row level security;
      alter table public.squad_players enable row level security;
      alter table public.match_fixtures enable row level security;
      alter table public.translations enable row level security;
    `);

  const policyStatements = [
    ["nations", "nations_select_public"],
    ["squad_players", "squad_players_select_public"],
    ["match_fixtures", "match_fixtures_select_public"],
    ["translations", "translations_select_public"],
  ];

  for (const [table, policy] of policyStatements) {
    await client.query(`drop policy if exists ${policy} on public.${table};`);
    await client.query(`
      create policy ${policy}
      on public.${table}
      for select
      to anon, authenticated
      using (true);
    `);
    await client.query(`grant select on public.${table} to anon, authenticated;`);
  }
}

async function seedData(client, data) {
  await client.query("begin");

  try {
    console.log("Creating schema...");
    await createSchema(client);
    console.log("Replacing existing website data...");
    await client.query("truncate table public.squad_players, public.nations, public.match_fixtures, public.translations cascade;");

    console.log("Uploading nations...");
    await client.query(
      `
        insert into public.nations (
          id, name, code, flag, confederation, total_squad_value, jersey_colors
        )
        select
          id,
          name,
          code,
          flag,
          confederation,
          total_squad_value,
          jersey_colors
        from jsonb_to_recordset($1::jsonb) as x(
          id text,
          name text,
          code text,
          flag text,
          confederation text,
          total_squad_value text,
          jersey_colors jsonb
        );
      `,
      [
        JSON.stringify(
          data.nations.map((nation) => ({
            id: nation.id,
            name: nation.name,
            code: nation.code,
            flag: nation.flag,
            confederation: nation.confederation,
            total_squad_value: nation.totalSquadValue,
            jersey_colors: nation.jerseyColors,
          })),
        ),
      ],
    );

    console.log("Uploading players...");
    await client.query(
      `
        insert into public.squad_players (
          id, nation_id, full_name, position, club, height, weight,
          strong_foot, market_value, jersey_number, age
        )
        select
          id,
          nation_id,
          full_name,
          position,
          club,
          height,
          weight,
          strong_foot,
          market_value,
          jersey_number,
          age
        from jsonb_to_recordset($1::jsonb) as x(
          id text,
          nation_id text,
          full_name text,
          position text,
          club text,
          height text,
          weight text,
          strong_foot text,
          market_value text,
          jersey_number integer,
          age integer
        );
      `,
      [
        JSON.stringify(
          data.nations.flatMap((nation) =>
            nation.players.map((player) => ({
              id: player.id,
              nation_id: nation.id,
              full_name: player.fullName,
              position: player.position,
              club: player.club,
              height: player.height,
              weight: player.weight,
              strong_foot: player.strongFoot,
              market_value: player.marketValue,
              jersey_number: player.jerseyNumber,
              age: player.age ?? null,
            })),
          ),
        ),
      ],
    );

    console.log("Uploading match fixtures...");
    await client.query(
      `
        insert into public.match_fixtures (
          id, match_date, match_time, stage, group_name, home_team, away_team, stadium
        )
        select
          id,
          match_date,
          match_time,
          stage,
          group_name,
          home_team,
          away_team,
          stadium
        from jsonb_to_recordset($1::jsonb) as x(
          id text,
          match_date text,
          match_time text,
          stage text,
          group_name text,
          home_team text,
          away_team text,
          stadium text
        );
      `,
      [
        JSON.stringify(
          data.matchFixtures.map((match) => ({
            id: match.id,
            match_date: match.date,
            match_time: match.time,
            stage: match.stage,
            group_name: match.group ?? null,
            home_team: match.homeTeam,
            away_team: match.awayTeam,
            stadium: match.stadium,
          })),
        ),
      ],
    );

    console.log("Uploading translations...");
    await client.query(
      `
        insert into public.translations (locale, translation_key, translation_value)
        select locale, translation_key, translation_value
        from jsonb_to_recordset($1::jsonb) as x(
          locale text,
          translation_key text,
          translation_value text
        );
      `,
      [
        JSON.stringify(
          Object.entries(data.translations).flatMap(([locale, values]) =>
            Object.entries(values).map(([key, value]) => ({
              locale,
              translation_key: key,
              translation_value: value,
            })),
          ),
        ),
      ],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  ensureEnv();

  const worldCupData = requireTypeScript(path.join(rootDir, "lib", "world-cup-data.ts"));
  const matchData = requireTypeScript(path.join(rootDir, "lib", "match-fixtures.ts"));

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15_000,
    ssl: getPostgresSslConfig(process.env.DATABASE_URL),
  });

  console.log("Connecting to Supabase Postgres...");
  await client.connect();

  try {
    await seedData(client, {
      nations: worldCupData.nations,
      translations: worldCupData.translations,
      matchFixtures: matchData.matchFixtures,
    });

    const { rows } = await client.query(`
      select
        (select count(*)::int from public.nations) as nations,
        (select count(*)::int from public.squad_players) as squad_players,
        (select count(*)::int from public.match_fixtures) as match_fixtures,
        (select count(*)::int from public.translations) as translations;
    `);

    console.log("Supabase seed complete:", rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
