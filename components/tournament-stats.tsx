"use client";

import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NationFlag } from "@/components/nation-flag";
import { normalizeCountryName } from "@/lib/country-utils";
import { createClient, getSupabaseConfig } from "@/lib/supabase/client";

type EventRow = {
  event_type: string;
  team_name: string | null;
  player_name: string | null;
  assist_player_name: string | null;
};

type StatCategory = "goals" | "assists" | "yellow" | "red";

type Leader = {
  playerName: string;
  teamName: string | null;
  value: number;
  rank: number;
};

const categories: Array<{ value: StatCategory; label: string; heading: string }> = [
  { value: "goals", label: "Goals", heading: "Goals" },
  { value: "assists", label: "Assists", heading: "Assists" },
  { value: "yellow", label: "Yellow cards", heading: "Yellow cards" },
  { value: "red", label: "Red cards", heading: "Red cards" },
];

export function TournamentStats() {
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    if (!getSupabaseConfig()) return;

    let isMounted = true;
    const supabase = createClient();

    supabase
      .from("match_events")
      .select("event_type,team_name,player_name,assist_player_name")
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.warn("Failed to load tournament stats.", error);
          return;
        }
        setEvents((data ?? []) as EventRow[]);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const leaders = useMemo(() => {
    return {
      goals: buildLeaders(events, "goals"),
      assists: buildLeaders(events, "assists"),
      yellow: buildLeaders(events, "yellow"),
      red: buildLeaders(events, "red"),
    };
  }, [events]);

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
          {initials(leader.playerName)}
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

function buildLeaders(events: EventRow[], category: StatCategory) {
  const totals = new Map<string, { playerName: string; teamName: string | null; value: number }>();

  for (const event of events) {
    const type = event.event_type.toLowerCase();
    const playerName = statPlayerName(event, category, type);
    if (!playerName) continue;

    const teamName = event.team_name ?? null;
    const key = `${playerName}::${teamName ?? ""}`;
    const current = totals.get(key) ?? { playerName, teamName, value: 0 };
    current.value += 1;
    totals.set(key, current);
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
      return { ...leader, rank };
    });
}

function statPlayerName(event: EventRow, category: StatCategory, eventType: string) {
  if (category === "goals" && ["goal", "penalty_goal"].includes(eventType)) return event.player_name;
  if (category === "assists") return event.assist_player_name;
  if (category === "yellow" && ["yellow_card", "second_yellow"].includes(eventType)) return event.player_name;
  if (category === "red" && ["red_card", "second_yellow"].includes(eventType)) return event.player_name;
  return null;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
