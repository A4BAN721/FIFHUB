"use client";

import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NationFlag } from "@/components/nation-flag";
import { normalizeCountryName } from "@/lib/country-utils";
import { createClient, getSupabaseConfig } from "@/lib/supabase/client";
import { getNations } from "@/lib/supabase/data";
import { completedMatchData } from "@/lib/live-data/completed-matches";
import { nations as fallbackNations } from "@/lib/world-cup-data";
import type { Nation } from "@/lib/world-cup-data";

type EventRow = {
  match_id?: string | null;
  provider?: string | null;
  event_type: string;
  team_name: string | null;
  player_name: string | null;
  assist_player_name: string | null;
  minute?: number | null;
};

type LineupPlayer = {
  name?: string | null;
  shirtNumber?: number | null;
};

type LineupTeam = {
  teamName?: string | null;
  starters?: LineupPlayer[] | null;
  substitutes?: LineupPlayer[] | null;
};

type LineupRow = {
  lineups: {
    home?: LineupTeam | null;
    away?: LineupTeam | null;
  } | null;
};

type StatCategory = "goals" | "assists" | "ga" | "yellow" | "red";

type Leader = {
  playerName: string;
  teamName: string | null;
  value: number;
  rank: number;
  jerseyNumber: number | null;
};

const categories: Array<{ value: StatCategory; label: string; heading: string }> = [
  { value: "goals", label: "Goals", heading: "Goals" },
  { value: "assists", label: "Assists", heading: "Assists" },
  { value: "ga", label: "Goals + Assists (G/A)", heading: "G/A" },
  { value: "yellow", label: "Yellow cards", heading: "Yellow cards" },
  { value: "red", label: "Red cards", heading: "Red cards" },
];

export function TournamentStats() {
  const [events, setEvents] = useState<EventRow[]>(() => getFallbackEventRows());
  const [lineupRows, setLineupRows] = useState<LineupRow[]>([]);
  const [nations, setNations] = useState<Nation[]>(fallbackNations);

  useEffect(() => {
    let isMounted = true;

    getNations()
      .then((supabaseNations) => {
        if (isMounted && supabaseNations.length > 0) {
          setNations(supabaseNations);
        }
      })
      .catch((error) => {
        console.warn("Using local squads for tournament stats jersey numbers.", error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!getSupabaseConfig()) return;

    let isMounted = true;
    const supabase = createClient();
    const loadEvents = () => {
      supabase
        .from("match_events")
        .select("match_id,provider,event_type,team_name,player_name,assist_player_name,minute")
        .then(({ data, error }) => {
          if (!isMounted) return;
          if (error) {
            console.warn("Failed to load tournament stats.", error);
            return;
          }
          setEvents(mergeEventRows(preferFotmobEventRows((data ?? []) as EventRow[]), getFallbackEventRows()));
        });
    };
    const loadLineups = () => {
      supabase
        .from("live_match_state")
        .select("lineups")
        .not("lineups", "is", null)
        .then(({ data, error }) => {
          if (!isMounted) return;
          if (error) {
            console.warn("Failed to load tournament stats lineup numbers.", error);
            return;
          }
          setLineupRows((data ?? []) as LineupRow[]);
        });
    };

    loadEvents();
    loadLineups();
    const refreshInterval = window.setInterval(() => {
      loadEvents();
      loadLineups();
    }, 60_000);
    const channel = supabase
      .channel("tournament-stats-match-events")
      .on("postgres_changes", { event: "*", schema: "public", table: "match_events" }, loadEvents)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_match_state" }, loadLineups)
      .subscribe();


    return () => {
      isMounted = false;
      window.clearInterval(refreshInterval);
      supabase.removeChannel(channel);
    };
  }, []);

  const playerLookup = useMemo(() => buildPlayerLookup(nations, lineupRows), [nations, lineupRows]);

  const leaders = useMemo(() => {
    return {
      goals: buildLeaders(events, "goals", playerLookup),
      assists: buildLeaders(events, "assists", playerLookup),
      ga: buildLeaders(events, "ga", playerLookup),
      yellow: buildLeaders(events, "yellow", playerLookup),
      red: buildLeaders(events, "red", playerLookup),
    };
  }, [events, playerLookup]);

  return (
    <div className="mx-auto max-w-5xl px-2 py-4 sm:px-4">
      <Tabs defaultValue="goals" className="w-full">
        <TabsList className="mb-4 h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border/50 bg-transparent p-0">
          {categories.map((category) => (
            <TabsTrigger
              key={category.value}
              value={category.value}
              className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              {category.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {categories.map((category) => (
          <TabsContent key={category.value} value={category.value} className="mt-0">
            <Leaderboard leaders={leaders[category.value]} heading={category.heading} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function Leaderboard({ leaders, heading }: { leaders: Leader[]; heading: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/45 p-3 sm:p-5">
      <div className="grid grid-cols-[3rem_1fr_4rem] border-b border-border/50 px-1 pb-3 text-sm text-muted-foreground">
        <span />
        <span>Player</span>
        <span className="text-right">{heading}</span>
      </div>
      <div>
        {leaders.length > 0 ? (
          leaders.map((leader) => <LeaderRow key={`${leader.playerName}-${leader.teamName}`} leader={leader} />)
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No data available yet.</p>
        )}
      </div>
    </div>
  );
}

function LeaderRow({ leader }: { leader: Leader }) {
  const nationId = leader.teamName ? normalizeCountryName(leader.teamName) : null;

  return (
    <div className="grid min-h-[70px] grid-cols-[3rem_1fr_4rem] items-center border-b border-border/30 px-1 py-2 last:border-b-0">
      <span className="text-center text-sm font-black text-foreground">{leader.rank}</span>
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-muted text-sm font-black text-foreground">
          <span className="text-xl leading-none tabular-nums">
            {leader.jerseyNumber ?? "-"}
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">{leader.playerName}</p>
          {leader.teamName && (
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <NationFlag className="h-4 w-6" label={leader.teamName} nationId={nationId} fallbackClassName="text-base" />
              <span className="truncate">{leader.teamName}</span>
            </div>
          )}
        </div>
      </div>
      <span className="text-right text-lg font-semibold tabular-nums text-foreground">{leader.value}</span>
    </div>
  );
}

function buildLeaders(
  events: EventRow[],
  category: StatCategory,
  playerLookup: Map<string, number>
) {
  const totals = new Map<string, { playerName: string; teamName: string | null; value: number }>();
  const countedEvents = new Set<string>();

  for (const event of events) {
    const type = event.event_type.toLowerCase();
    if (category === "ga") {
      if (["goal", "penalty_goal"].includes(type)) {
        addLeaderValueOnce(totals, countedEvents, event, "goal", event.player_name, event.team_name ?? null);
      }
      addLeaderValueOnce(totals, countedEvents, event, "assist", event.assist_player_name, event.team_name ?? null);
      continue;
    }

    const playerName = statPlayerName(event, category, type);
    if (!playerName) continue;

    addLeaderValueOnce(totals, countedEvents, event, category, playerName, event.team_name ?? null);
  }

  let previousValue = -1;
  let previousRank = 0;
  return [...totals.values()]
    .sort((a, b) => b.value - a.value || a.playerName.localeCompare(b.playerName))
    .slice(0, 50)
    .map((leader, index) => {
      const rank = leader.value === previousValue ? previousRank : index + 1;
      previousValue = leader.value;
      previousRank = rank;
      return { ...leader, rank, jerseyNumber: playerLookup.get(playerKey(leader.playerName, leader.teamName)) ?? null };
    });
}

function addLeaderValue(
  totals: Map<string, { playerName: string; teamName: string | null; value: number }>,
  playerName: string | null | undefined,
  teamName: string | null,
  value: number
) {
  if (!playerName) return;
  const key = `${playerName}::${teamName ?? ""}`;
  const current = totals.get(key) ?? { playerName, teamName, value: 0 };
  current.value += value;
  totals.set(key, current);
}

function statPlayerName(event: EventRow, category: StatCategory, eventType: string) {
  if (category === "goals" && ["goal", "penalty_goal"].includes(eventType)) return event.player_name;
  if (category === "assists") return event.assist_player_name;
  if (category === "yellow" && ["yellow_card", "yellow"].includes(eventType)) return event.player_name;
  if (category === "red" && ["red_card", "second_yellow", "red"].includes(eventType)) return event.player_name;
  return null;
}

function preferFotmobEventRows(rows: EventRow[]) {
  const matchesWithFotmobEvents = new Set(
    rows
      .filter((row) => row.match_id && row.provider === "fotmob")
      .map((row) => row.match_id as string)
  );

  if (matchesWithFotmobEvents.size === 0) return rows;

  return rows.filter(
    (row) => !row.match_id || !matchesWithFotmobEvents.has(row.match_id) || row.provider === "fotmob"
  );
}

function addLeaderValueOnce(
  totals: Map<string, { playerName: string; teamName: string | null; value: number }>,
  countedEvents: Set<string>,
  event: EventRow,
  category: string,
  playerName: string | null | undefined,
  teamName: string | null
) {
  if (!playerName) return;

  const key = [
    category,
    normalizeName(event.match_id ?? ""),
    normalizeName(event.event_type),
    normalizeName(teamName ?? ""),
    normalizeName(playerName),
    event.minute ?? "",
  ].join("::");

  if (countedEvents.has(key)) return;
  countedEvents.add(key);
  addLeaderValue(totals, playerName, teamName, 1);
}

function mergeEventRows(primaryRows: EventRow[], fallbackRows: EventRow[]) {
  const rows = new Map<string, EventRow>();

  for (const row of fallbackRows) {
    rows.set(eventKey(row), row);
  }

  for (const row of primaryRows) {
    const key = eventKey(row);
    const fallbackRow = rows.get(key);
    rows.set(key, {
      ...fallbackRow,
      ...row,
      assist_player_name: row.assist_player_name ?? fallbackRow?.assist_player_name ?? null,
    });
  }

  return [...rows.values()];
}

function getFallbackEventRows(): EventRow[] {
  return Object.values(completedMatchData).flatMap((match) =>
    match.events.map((event) => ({
      event_type: event.eventType,
      match_id: match.matchId,
      provider: "static",
      team_name: event.teamName ?? null,
      player_name: event.playerName ?? null,
      assist_player_name: event.assistPlayerName ?? null,
      minute: event.minute ?? null,
    }))
  );
}

function eventKey(event: EventRow) {
  return [
    normalizeName(event.match_id ?? ""),
    normalizeName(event.event_type),
    normalizeName(event.team_name ?? ""),
    normalizeName(event.player_name ?? ""),
    event.minute ?? "",
  ].join("::");
}

function buildPlayerLookup(nations: Nation[], lineupRows: LineupRow[]) {
  const lookup = new Map<string, number>();

  for (const nation of nations) {
    for (const player of nation.players) {
      lookup.set(playerKey(player.fullName, nation.name), player.jerseyNumber);
      lookup.set(playerKey(player.fullName, nation.id), player.jerseyNumber);
      lookup.set(playerKey(player.fullName, nation.code), player.jerseyNumber);
    }
  }

  for (const row of lineupRows) {
    for (const team of [row.lineups?.home, row.lineups?.away]) {
      if (!team?.teamName) continue;
      for (const player of [...(team.starters ?? []), ...(team.substitutes ?? [])]) {
        if (!player.name || typeof player.shirtNumber !== "number") continue;
        lookup.set(playerKey(player.name, team.teamName), player.shirtNumber);
      }
    }
  }

  return lookup;
}

function playerKey(playerName: string, teamName: string | null) {
  return `${normalizeName(playerName)}::${normalizeName(teamName ?? "")}`;
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
