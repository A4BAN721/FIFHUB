import type { Match } from "@/lib/match-fixtures";
import type { Nation, Player } from "@/lib/world-cup-data";
import { createClient, getSupabaseConfig } from "./client";

type NationRow = {
  id: string;
  name: string;
  code: string;
  flag: string;
  confederation: string;
  total_squad_value: string;
  jersey_colors: Nation["jerseyColors"];
};

type PlayerRow = {
  id: string;
  nation_id: string;
  full_name: string;
  position: string;
  club: string;
  height: string;
  weight: string;
  strong_foot: string;
  market_value: string;
  jersey_number: number;
  age?: number | null;
};

type MatchFixtureRow = {
  id: string;
  match_date: string;
  match_time: string;
  stage: string;
  group_name: string | null;
  home_team: string;
  away_team: string;
  stadium: string;
};

type TranslationRow = {
  locale: string;
  translation_key: string;
  translation_value: string;
};

const nationColorOverrides: Record<string, Nation["jerseyColors"]> = {
  ghana: { primary: "#FFFFFF", secondary: "#FCD116", accent: "#006B3F" },
  jordan: { primary: "#FFFFFF", secondary: "#CE1126", accent: "#000000" },
  "south-africa": { primary: "#FFB612", secondary: "#007A4D", accent: "#000000" },
  spain: { primary: "#AA151B", secondary: "#F1BF00", accent: "#002B5C" },
  sweden: { primary: "#FECC00", secondary: "#006AA7", accent: "#FFFFFF" },
  usa: { primary: "#FFFFFF", secondary: "#BF0A30", accent: "#002868" },
};

function formatSupabaseError(error: unknown) {
  if (!error || typeof error !== "object") return error;

  const maybeError = error as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };

  return {
    code: maybeError.code,
    message: maybeError.message,
    details: maybeError.details,
    hint: maybeError.hint,
  };
}

export async function getNations(): Promise<Nation[]> {
  if (!getSupabaseConfig()) {
    return [];
  }

  const supabase = createClient();

  const [{ data: nationRows, error: nationError }, { data: playerRows, error: playerError }] =
    await Promise.all([
      supabase.from("nations").select("*"),
      supabase.from("squad_players").select("*"),
    ]);

  if (nationError) {
    throw new Error("Failed to fetch nations", { cause: formatSupabaseError(nationError) });
  }
  if (playerError) {
    throw new Error("Failed to fetch squad players", { cause: formatSupabaseError(playerError) });
  }

  const playersByNation = new Map<string, Player[]>();
  for (const row of (playerRows ?? []) as PlayerRow[]) {
    const player: Player = {
      id: row.id,
      fullName: row.full_name,
      position: row.position,
      club: row.club,
      height: row.height,
      weight: row.weight,
      strongFoot: row.strong_foot,
      marketValue: row.market_value,
      jerseyNumber: row.jersey_number,
      age: row.age ?? undefined,
    };

    const players = playersByNation.get(row.nation_id) ?? [];
    players.push(player);
    playersByNation.set(row.nation_id, players);
  }

  for (const players of playersByNation.values()) {
    players.sort((a, b) => a.jerseyNumber - b.jerseyNumber || a.fullName.localeCompare(b.fullName));
  }

  return ((nationRows ?? []) as NationRow[])
    .map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      flag: row.flag,
      confederation: row.confederation,
      totalSquadValue: row.total_squad_value,
      jerseyColors: nationColorOverrides[row.id] ?? row.jersey_colors,
      players: playersByNation.get(row.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getMatchFixtures(): Promise<Match[]> {
  if (!getSupabaseConfig()) {
    return [];
  }

  const supabase = createClient();
  const { data, error } = await supabase.from("match_fixtures").select("*");

  if (error) {
    throw new Error("Failed to fetch match fixtures", { cause: formatSupabaseError(error) });
  }

  return ((data ?? []) as MatchFixtureRow[])
    .map((row) => ({
      id: row.id,
      date: row.match_date,
      time: row.match_time,
      stage: row.stage,
      group: row.group_name ?? undefined,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      stadium: row.stadium,
    }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

export async function getTranslations(): Promise<Record<string, Record<string, string>>> {
  if (!getSupabaseConfig()) {
    return {};
  }

  const supabase = createClient();
  const { data, error } = await supabase.from("translations").select("*");

  if (error) {
    throw new Error("Failed to fetch translations", { cause: formatSupabaseError(error) });
  }

  return ((data ?? []) as TranslationRow[]).reduce<Record<string, Record<string, string>>>(
    (translations, row) => {
      translations[row.locale] ??= {};
      translations[row.locale][row.translation_key] = row.translation_value;
      return translations;
    },
    {},
  );
}
