"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Match } from "@/lib/match-fixtures";
import type { Nation } from "@/lib/world-cup-data";
import { matchFixtures as fallbackMatchFixtures } from "@/lib/match-fixtures";
import { nations as fallbackNations } from "@/lib/world-cup-data";
import { fifaGroups, qualifiedNationIds } from "@/lib/world-cup-groups";
import { normalizeCountryName } from "@/lib/country-utils";
import { completedMatchData } from "@/lib/live-data/completed-matches";
import { createClient, getSupabaseConfig } from "@/lib/supabase/client";
import { getMatchFixtures, getNations } from "@/lib/supabase/data";
import { getTeamDisplayName } from "@/lib/team-display";
import { useLanguage } from "./language-provider";
import { NationFlag } from "./nation-flag";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type StandingRow = {
  nation: Nation;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

type MatchWithOptionalScore = Match &
  Partial<{
    homeScore: number;
    awayScore: number;
    homePenaltyScore: number | null;
    awayPenaltyScore: number | null;
    status: string;
    period: string;
    finalScoreConfirmedAt: string | null;
    updatedAt: string | null;
  }>;

type NationHoverStyle = CSSProperties & {
  "--nation-primary": string;
};

type ScoreboardApiMatch = {
  id: string;
  matchDate: string;
  matchTime: string;
  stage: string;
  group?: string | null;
  homeTeam: string;
  awayTeam: string;
  stadium: string;
  status: string;
  period: string;
  homeScore: number;
  awayScore: number;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
  finalScoreConfirmedAt: string | null;
  updatedAt: string | null;
};

type ScoreboardApiResponse = {
  matches?: ScoreboardApiMatch[];
};

type KnockoutPlacement = {
  label: string;
  column: number;
  rowStart: number;
  rowSpan: number;
  matchId?: string;
};

type KnockoutTeam = {
  name: string;
  score?: number | null;
  penaltyScore?: number | null;
  isWinner?: boolean;
};

type KnockoutMatch = {
  matchId?: string;
  stage?: string;
  label: string;
  home: KnockoutTeam;
  away: KnockoutTeam;
};

const localDataNations = new Map(
  fallbackNations
    .filter((nation) => qualifiedNationIds.has(nation.id))
    .map((nation) => [nation.id, nation])
);

const knockoutRoundOf32Ids = [
  "75",
  "78",
  "73",
  "76",
  "84",
  "83",
  "82",
  "81",
  "74",
  "77",
  "79",
  "80",
  "87",
  "86",
  "85",
  "88",
];

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
} satisfies Record<string, [string, string]>;

const bronzeFinalSources = ["101", "102"] as const;

const leftKnockoutPlacements = [
  ...Array.from({ length: 8 }, (_, index) => ({
    label: `Round of 32 ${index + 1}`,
    column: 1,
    rowStart: index * 2 + 1,
    rowSpan: 2,
    matchId: knockoutRoundOf32Ids[index],
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    label: `Round of 16 ${index + 1}`,
    column: 2,
    rowStart: index * 4 + 1,
    rowSpan: 4,
    matchId: String(89 + index),
  })),
  ...Array.from({ length: 2 }, (_, index) => ({
    label: `Quarter Finals ${index + 1}`,
    column: 3,
    rowStart: index * 8 + 1,
    rowSpan: 8,
    matchId: String(97 + index),
  })),
  { label: "Semi Finals 1", column: 4, rowStart: 1, rowSpan: 16, matchId: "101" },
];

const rightKnockoutPlacements = [
  { label: "Semi Finals 2", column: 6, rowStart: 1, rowSpan: 16, matchId: "102" },
  ...Array.from({ length: 2 }, (_, index) => ({
    label: `Quarter Finals ${index + 3}`,
    column: 7,
    rowStart: index * 8 + 1,
    rowSpan: 8,
    matchId: String(99 + index),
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    label: `Round of 16 ${index + 5}`,
    column: 8,
    rowStart: index * 4 + 1,
    rowSpan: 4,
    matchId: String(93 + index),
  })),
  ...Array.from({ length: 8 }, (_, index) => ({
    label: `Round of 32 ${index + 9}`,
    column: 9,
    rowStart: index * 2 + 1,
    rowSpan: 2,
    matchId: knockoutRoundOf32Ids[index + 8],
  })),
];

const centerKnockoutPlacements = [
  { label: "Final", column: 5, rowStart: 6, rowSpan: 3, matchId: "104" },
  { label: "Bronze Final", column: 5, rowStart: 9, rowSpan: 3, matchId: "103" },
];

const mobileKnockoutPlacements = [
  ...Array.from({ length: 16 }, (_, index) => ({
    label: `Round of 32 ${index + 1}`,
    column: 1,
    rowStart: index * 2 + 1,
    rowSpan: 2,
    matchId: knockoutRoundOf32Ids[index],
  })),
  ...Array.from({ length: 8 }, (_, index) => ({
    label: `Round of 16 ${index + 1}`,
    column: 2,
    rowStart: index * 4 + 1,
    rowSpan: 4,
    matchId: String(89 + index),
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    label: `Quarter Finals ${index + 1}`,
    column: 3,
    rowStart: index * 8 + 1,
    rowSpan: 8,
    matchId: String(97 + index),
  })),
  ...Array.from({ length: 2 }, (_, index) => ({
    label: `Semi Finals ${index + 1}`,
    column: 4,
    rowStart: index * 16 + 1,
    rowSpan: 16,
    matchId: String(101 + index),
  })),
  { label: "Final", column: 5, rowStart: 11, rowSpan: 5, matchId: "104" },
  { label: "Bronze Final", column: 5, rowStart: 17, rowSpan: 5, matchId: "103" },
];

function convertToBanglaNumerals(value: string | number): string {
  const banglaNumerals: Record<string, string> = {
    "0": "\u09e6",
    "1": "\u09e7",
    "2": "\u09e8",
    "3": "\u09e9",
    "4": "\u09ea",
    "5": "\u09eb",
    "6": "\u09ec",
    "7": "\u09ed",
    "8": "\u09ee",
    "9": "\u09ef",
  };

  return String(value).replace(/\d/g, (digit) => banglaNumerals[digit] || digit);
}

function createEmptyRow(nation: Nation): StandingRow {
  return {
    nation,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  };
}

function applyResult(row: StandingRow, goalsFor: number, goalsAgainst: number) {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  row.goalDifference = row.goalsFor - row.goalsAgainst;

  if (goalsFor > goalsAgainst) {
    row.wins += 1;
    row.points += 3;
  } else if (goalsFor === goalsAgainst) {
    row.draws += 1;
    row.points += 1;
  } else {
    row.losses += 1;
  }
}

function getMatchScore(match: MatchWithOptionalScore) {
  const hasScore =
    Number.isFinite(match.homeScore) &&
    Number.isFinite(match.awayScore) &&
    (match.status === "finished" || Boolean(match.finalScoreConfirmedAt));

  if (hasScore) {
    return {
      homeScore: match.homeScore as number,
      awayScore: match.awayScore as number,
      homePenaltyScore: match.homePenaltyScore ?? null,
      awayPenaltyScore: match.awayPenaltyScore ?? null,
    };
  }

  const completedMatch = completedMatchData[match.id];
  if (completedMatch) {
    return {
      homeScore: completedMatch.homeScore,
      awayScore: completedMatch.awayScore,
      homePenaltyScore: completedMatch.homePenaltyScore ?? null,
      awayPenaltyScore: completedMatch.awayPenaltyScore ?? null,
    };
  }

  return null;
}

function isLiveMatch(match: MatchWithOptionalScore) {
  return (
    match.status === "live" ||
    match.status === "half_time" ||
    match.status === "extra_time" ||
    match.status === "penalties"
  );
}

function mapScoreboardMatch(match: ScoreboardApiMatch): MatchWithOptionalScore {
  return {
    id: match.id,
    date: match.matchDate,
    time: match.matchTime,
    stage: match.stage,
    group: match.group ?? undefined,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    stadium: match.stadium,
    status: match.status,
    period: match.period,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homePenaltyScore: match.homePenaltyScore ?? null,
    awayPenaltyScore: match.awayPenaltyScore ?? null,
    finalScoreConfirmedAt: match.finalScoreConfirmedAt,
    updatedAt: match.updatedAt,
  };
}

function sortStandingRows(rows: StandingRow[]) {
  return rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.nation.name.localeCompare(b.nation.name);
  });
}

function getKnockoutWinner(match: MatchWithOptionalScore | undefined) {
  return getKnockoutOutcome(match)?.winner ?? null;
}

function getKnockoutLoser(match: MatchWithOptionalScore | undefined) {
  return getKnockoutOutcome(match)?.loser ?? null;
}

function getKnockoutOutcome(match: MatchWithOptionalScore | undefined) {
  if (!match) return null;
  const score = getMatchScore(match);
  if (!score) return null;

  const hasPenaltyWinner =
    score.homePenaltyScore != null &&
    score.awayPenaltyScore != null &&
    score.homePenaltyScore !== score.awayPenaltyScore;

  if (score.homeScore === score.awayScore && !hasPenaltyWinner) return null;

  const homeWon =
    score.homeScore === score.awayScore
      ? Number(score.homePenaltyScore) > Number(score.awayPenaltyScore)
      : score.homeScore > score.awayScore;

  const home = {
    name: match.homeTeam,
    score: score.homeScore,
    penaltyScore: score.homePenaltyScore,
  };
  const away = {
    name: match.awayTeam,
    score: score.awayScore,
    penaltyScore: score.awayPenaltyScore,
  };

  return homeWon
    ? { winner: home, loser: away }
    : { winner: away, loser: home };
}

function buildKnockoutMatch(
  placement: KnockoutPlacement,
  matchById: Map<string, MatchWithOptionalScore>
): KnockoutMatch {
  const match = placement.matchId ? matchById.get(placement.matchId) : undefined;
  const score = match ? getMatchScore(match) : null;
  const outcome = getKnockoutOutcome(match);

  if (match && match.homeTeam !== "TBD" && match.awayTeam !== "TBD") {
    return {
      matchId: placement.matchId,
      stage: match.stage,
      label: placement.label,
      home: {
        name: match.homeTeam,
        score: score?.homeScore,
        penaltyScore: score?.homePenaltyScore,
        isWinner: outcome?.winner.name === match.homeTeam,
      },
      away: {
        name: match.awayTeam,
        score: score?.awayScore,
        penaltyScore: score?.awayPenaltyScore,
        isWinner: outcome?.winner.name === match.awayTeam,
      },
    };
  }

  if (placement.matchId === "103") {
    const [firstSemiFinalId, secondSemiFinalId] = bronzeFinalSources;
    const firstLoser = getKnockoutLoser(matchById.get(firstSemiFinalId));
    const secondLoser = getKnockoutLoser(matchById.get(secondSemiFinalId));

    return {
      matchId: placement.matchId,
      label: placement.label,
      home: { name: firstLoser?.name ?? "Loser Semi-Final 1" },
      away: { name: secondLoser?.name ?? "Loser Semi-Final 2" },
    };
  }

  const sources = placement.matchId
    ? knockoutProgression[placement.matchId as keyof typeof knockoutProgression]
    : undefined;

  if (sources) {
    const firstWinner = getKnockoutWinner(matchById.get(sources[0]));
    const secondWinner = getKnockoutWinner(matchById.get(sources[1]));

    return {
      matchId: placement.matchId,
      label: placement.label,
      home: { name: firstWinner?.name ?? `Winner Match ${sources[0]}` },
      away: { name: secondWinner?.name ?? `Winner Match ${sources[1]}` },
    };
  }

  return {
    matchId: placement.matchId,
    label: placement.label,
    home: { name: "TBD" },
    away: { name: "TBD" },
  };
}

function KnockoutTeamRow({
  team,
  nationMap,
  onOpenNation,
}: {
  team: KnockoutTeam;
  nationMap: Map<string, Nation>;
  onOpenNation: (nationId: string) => void;
}) {
  const nationId = normalizeCountryName(team.name);
  const nation = nationMap.get(nationId) ?? localDataNations.get(nationId);
  const isPlaceholder = !nation || team.name.startsWith("Winner ") || team.name.startsWith("Loser ") || team.name === "TBD";
  const isEliminated = team.score != null && !team.isWinner;
  const scoreText = formatKnockoutScore(team);

  return (
    <div className="flex items-center justify-between gap-1 px-1.5 py-1.5 sm:py-1 lg:px-2">
      <div className="flex min-w-0 items-center gap-1.5">
        {!isPlaceholder && (
          <NationFlag
            className={`h-3 w-4 shrink-0 transition-opacity sm:h-3.5 sm:w-5 ${isEliminated ? "opacity-35" : ""}`}
            emoji={nation.flag}
            fallbackClassName="text-xs"
            label={nation.name}
            nationId={nation.id}
          />
        )}
        {isPlaceholder ? (
          <span className="truncate text-[10px] font-medium text-muted-foreground sm:text-xs">
            {team.name}
          </span>
        ) : (
          <button
            className={`cursor-pointer truncate text-left text-[10px] font-medium transition-colors hover:text-[var(--nation-primary)] sm:text-xs ${
              isEliminated ? "text-muted-foreground line-through decoration-2" : "text-foreground"
            }`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenNation(nation.id);
            }}
            style={{ "--nation-primary": nation.jerseyColors.primary } as NationHoverStyle}
            type="button"
          >
            {getKnockoutTeamDisplayName(team.name)}
          </button>
        )}
      </div>
      <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
        {scoreText}
      </span>
    </div>
  );
}

function formatKnockoutScore(team: KnockoutTeam) {
  if (team.score == null) return "-";
  if (team.penaltyScore != null) return `${team.score}(${team.penaltyScore})`;
  return team.score;
}

function getKnockoutTeamDisplayName(teamName: string) {
  const nationId = normalizeCountryName(teamName);
  if (nationId === "bosnia-herzegovina") return "Bosnia";
  if (nationId === "usa") return "USA";
  if (nationId === "cape-verde") return "Cape Verde";
  return getTeamDisplayName(teamName);
}

function KnockoutMatchCard({
  match,
  nationMap,
  onOpenMatch,
  onOpenNation,
}: {
  match: KnockoutMatch;
  nationMap: Map<string, Nation>;
  onOpenMatch: (match: KnockoutMatch) => void;
  onOpenNation: (nationId: string) => void;
}) {
  const canOpenMatch = Boolean(match.matchId);

  return (
    <div
      className="w-full cursor-pointer overflow-hidden rounded-md border border-border/50 bg-background/90 text-left shadow-sm transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => {
        if (canOpenMatch) onOpenMatch(match);
      }}
      onKeyDown={(event) => {
        if (!canOpenMatch || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpenMatch(match);
      }}
      role={canOpenMatch ? "button" : undefined}
      tabIndex={canOpenMatch ? 0 : undefined}
    >
      <div className="border-b border-border/40 px-1.5 py-1.5 leading-none sm:py-1 lg:px-2">
        <div className="truncate text-[8px] font-semibold uppercase text-muted-foreground sm:text-[9px] lg:text-[10px]">
          {match.label}
        </div>
      </div>
      <div className="divide-y divide-border/40">
        <KnockoutTeamRow team={match.home} nationMap={nationMap} onOpenNation={onOpenNation} />
        <KnockoutTeamRow team={match.away} nationMap={nationMap} onOpenNation={onOpenNation} />
      </div>
    </div>
  );
}

function KnockoutStageBracket({
  matchFixtures,
  nationMap,
}: {
  matchFixtures: MatchWithOptionalScore[];
  nationMap: Map<string, Nation>;
}) {
  const bracketPlacements = [
    ...leftKnockoutPlacements,
    ...centerKnockoutPlacements,
    ...rightKnockoutPlacements,
  ] as KnockoutPlacement[];
  const matchById = new Map(matchFixtures.map((match) => [match.id, match]));
  const openMatch = (match: KnockoutMatch) => {
    const fixture = match.matchId ? matchById.get(match.matchId) : null;
    if (!match.matchId || !fixture) return;
    window.dispatchEvent(
      new CustomEvent("fixtureSelected", {
        detail: {
          matchId: match.matchId,
          search: `${fixture.homeTeam} ${fixture.awayTeam}`,
          selectedStage: fixture.stage,
        },
      })
    );
  };
  const openNation = (nationId: string) => {
    window.dispatchEvent(
      new CustomEvent("nationSelected", {
        detail: { nationId, returnTab: "table", returnScrollY: window.scrollY },
      })
    );
  };

  return (
    <>
      <section className="overflow-x-auto rounded-lg border border-border/50 bg-card/75 p-2 backdrop-blur-xl sm:hidden">
        <div className="relative grid h-[1120px] min-w-[660px] grid-cols-5 grid-rows-[repeat(32,minmax(0,1fr))] gap-x-2">
          {mobileKnockoutPlacements.map((placement) => (
            <div
              key={placement.label}
              className="relative z-10 flex items-center"
              style={{
                gridColumn: placement.column,
                gridRow: `${placement.rowStart} / span ${placement.rowSpan}`,
              }}
            >
              <KnockoutMatchCard match={buildKnockoutMatch(placement, matchById)} nationMap={nationMap} onOpenMatch={openMatch} onOpenNation={openNation} />
            </div>
          ))}
        </div>
      </section>

      <section className="hidden overflow-x-auto rounded-lg border border-border/50 bg-card/75 p-2 backdrop-blur-xl sm:block sm:overflow-hidden sm:p-3">
        <div className="relative grid h-[620px] min-w-[860px] grid-cols-9 grid-rows-[repeat(16,minmax(0,1fr))] gap-x-2 sm:min-w-0 lg:h-[700px] lg:gap-x-3">
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 h-full w-full"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <g fill="none" stroke="rgb(59 130 246 / 0.72)" strokeLinecap="round" strokeWidth="0.35">
              <path d="M10.8 6.25H12.7V12.5H16.3M10.8 18.75H12.7V12.5" />
              <path d="M10.8 31.25H12.7V37.5H16.3M10.8 43.75H12.7V37.5" />
              <path d="M10.8 56.25H12.7V62.5H16.3M10.8 68.75H12.7V62.5" />
              <path d="M10.8 81.25H12.7V87.5H16.3M10.8 93.75H12.7V87.5" />
              <path d="M21.9 12.5H24V25H27.4M21.9 37.5H24V25" />
              <path d="M21.9 62.5H24V75H27.4M21.9 87.5H24V75" />
              <path d="M33 25H35.2V50H38.5M33 75H35.2V50" />
              <path d="M44.1 50H46.3V43.75H49.4M46.3 50V56.25H49.4" />

              <path d="M89.2 6.25H87.3V12.5H83.7M89.2 18.75H87.3V12.5" />
              <path d="M89.2 31.25H87.3V37.5H83.7M89.2 43.75H87.3V37.5" />
              <path d="M89.2 56.25H87.3V62.5H83.7M89.2 68.75H87.3V62.5" />
              <path d="M89.2 81.25H87.3V87.5H83.7M89.2 93.75H87.3V87.5" />
              <path d="M78.1 12.5H76V25H72.6M78.1 37.5H76V25" />
              <path d="M78.1 62.5H76V75H72.6M78.1 87.5H76V75" />
              <path d="M67 25H64.8V50H61.5M67 75H64.8V50" />
              <path d="M55.9 50H53.7V43.75H50.6M53.7 50V56.25H50.6" />
            </g>
          </svg>

          {bracketPlacements.map((placement) => (
            <div
              key={placement.label}
              className="relative z-10 flex items-center"
              style={{
                gridColumn: placement.column,
                gridRow: `${placement.rowStart} / span ${placement.rowSpan}`,
              }}
            >
              <KnockoutMatchCard match={buildKnockoutMatch(placement, matchById)} nationMap={nationMap} onOpenMatch={openMatch} onOpenNation={openNation} />
            </div>
            ))}
        </div>
      </section>
    </>
  );
}

export function GroupStandingsTable() {
  const { t, language } = useLanguage();
  const [matchFixtures, setMatchFixtures] = useState<MatchWithOptionalScore[]>(fallbackMatchFixtures);
  const [nations, setNations] = useState<Nation[]>(fallbackNations);

  const fetchScoreboardMatches = useCallback(async () => {
    const response = await fetch("/api/matches?limit=120&fresh=1", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Failed to refresh standings matches");
    }

    const data = (await response.json()) as ScoreboardApiResponse;
    if (Array.isArray(data.matches) && data.matches.length > 0) {
      return data.matches.map(mapScoreboardMatch);
    }

    return [];
  }, []);

  const refreshScoreboardMatches = useCallback(async () => {
    const matches = await fetchScoreboardMatches();
    if (matches.length > 0) {
      setMatchFixtures(matches);
    }
  }, [fetchScoreboardMatches]);

  useEffect(() => {
    let isMounted = true;

    Promise.allSettled([fetchScoreboardMatches(), getMatchFixtures(), getNations()])
      .then(([scoreboardResult, matchesResult, nationsResult]) => {
        if (!isMounted) return;

        if (scoreboardResult.status === "fulfilled" && scoreboardResult.value.length > 0) {
          setMatchFixtures(scoreboardResult.value);
        } else if (matchesResult.status === "fulfilled" && matchesResult.value.length > 0) {
          setMatchFixtures(matchesResult.value);
        }

        if (nationsResult.status === "fulfilled" && nationsResult.value.length > 0) {
          const mergedNations = nationsResult.value.map(
            (nation) => localDataNations.get(nation.id) ?? nation
          );

          for (const [nationId, nation] of localDataNations) {
            if (!mergedNations.some((item) => item.id === nationId)) {
              mergedNations.push(nation);
            }
          }

          setNations(mergedNations);
        }
      })
      .catch((error) => {
        console.warn("Using local standings data because Supabase data could not be loaded.", error);
      });

    return () => {
      isMounted = false;
    };
  }, [fetchScoreboardMatches]);

  useEffect(() => {
    let isMounted = true;
    const interval = window.setInterval(() => {
      refreshScoreboardMatches().catch((error) => {
        console.warn("Failed to refresh standings matches.", error);
      });
    }, 15000);

    const supabase = getSupabaseConfig() ? createClient() : null;
    const channel = supabase
      ?.channel("standings-live-updates")
      .on("broadcast", { event: "match.update" }, () => {
        if (isMounted) void refreshScoreboardMatches();
      })
      .on("broadcast", { event: "match.status" }, () => {
        if (isMounted) void refreshScoreboardMatches();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_match_state" },
        () => {
          if (isMounted) void refreshScoreboardMatches();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      window.clearInterval(interval);
      if (supabase && channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [refreshScoreboardMatches]);

  const nationMap = useMemo(() => new Map(nations.map((nation) => [nation.id, nation])), [nations]);

  const standingsByGroup = useMemo(() => {
    const groupTables: Record<string, StandingRow[]> = {};

    for (const [group, nationIds] of Object.entries(fifaGroups)) {
      const rows = nationIds
        .map((nationId) => nationMap.get(nationId) ?? localDataNations.get(nationId))
        .filter(Boolean)
        .map((nation) => createEmptyRow(nation as Nation));

      const rowMap = new Map(rows.map((row) => [row.nation.id, row]));

      matchFixtures
        .filter((match) => match.stage === "GROUP STAGE" && match.group === `Group ${group}`)
        .forEach((match) => {
          const score = getMatchScore(match as MatchWithOptionalScore);
          if (!score) return;

          const homeNationId = normalizeCountryName(match.homeTeam);
          const awayNationId = normalizeCountryName(match.awayTeam);
          const homeRow = rowMap.get(homeNationId);
          const awayRow = rowMap.get(awayNationId);

          if (!homeRow || !awayRow) return;

          applyResult(homeRow, score.homeScore, score.awayScore);
          applyResult(awayRow, score.awayScore, score.homeScore);
        });

      groupTables[`Group ${group}`] = sortStandingRows(rows);
    }

    return groupTables;
  }, [matchFixtures, nationMap]);

  const thirdPlaceRows = useMemo(() => {
    return sortStandingRows(
      Object.values(standingsByGroup)
        .map((rows) => rows[2])
        .filter(Boolean)
        .map((row) => ({ ...row }))
    );
  }, [standingsByGroup]);

  const qualifiedThirdPlaceNationIds = useMemo(() => {
    return new Set(thirdPlaceRows.slice(0, 8).map((row) => row.nation.id));
  }, [thirdPlaceRows]);

  const liveNationIds = useMemo(() => {
    const ids = new Set<string>();

    for (const match of matchFixtures) {
      if (!isLiveMatch(match)) continue;
      ids.add(normalizeCountryName(match.homeTeam));
      ids.add(normalizeCountryName(match.awayTeam));
    }

    return ids;
  }, [matchFixtures]);

  const getTranslatedTeamName = (nation: Nation): string => {
    const translationKey = nation.id.replace(/-/g, "");
    const translated = t(translationKey);
    if (translated !== translationKey) return translated;
    return getTeamDisplayName(nation.name);
  };

  const getTranslatedGroupName = (groupName: string): string => {
    if (language === "en") return groupName;

    const groupLetter = groupName.replace("Group ", "");
    const banglaGroupLetters: Record<string, string> = {
      A: "\u098f",
      B: "\u09ac\u09bf",
      C: "\u09b8\u09bf",
      D: "\u09a1\u09bf",
      E: "\u0987",
      F: "\u098f\u09ab",
      G: "\u099c\u09bf",
      H: "\u098f\u0987\u099a",
      I: "\u0986\u0987",
      J: "\u099c\u09c7",
      K: "\u0995\u09c7",
      L: "\u098f\u09b2",
    };

    if (banglaGroupLetters[groupLetter]) {
      return `\u0997\u09cd\u09b0\u09c1\u09aa ${banglaGroupLetters[groupLetter]}`;
    }

    return groupName;
  };

  const formatNumber = (value: string | number) => {
    return language === "bn" ? convertToBanglaNumerals(value) : String(value);
  };

  const formatGoalDifference = (value: number) => {
    return formatNumber(value > 0 ? `+${value}` : value);
  };

  const openNation = (nationId: string) => {
    window.dispatchEvent(
      new CustomEvent("nationSelected", {
        detail: { nationId, returnTab: "table", returnScrollY: window.scrollY },
      })
    );
  };

  const getNationHoverStyle = (nation: Nation): NationHoverStyle => ({
    "--nation-primary": nation.jerseyColors?.primary ?? "hsl(var(--primary))",
  });

  const renderStandingsTable = (
    title: string,
    rows: StandingRow[],
    qualifiedCount: number,
    subtitle?: string,
    highlightedNationIds = new Set<string>()
  ) => (
    <section className="overflow-hidden rounded-lg border border-border/50 bg-card/75 backdrop-blur-xl">
      <div className="flex min-h-10 items-center justify-between border-b border-border/50 px-1.5 py-1.5 sm:px-4 sm:py-3">
        <div>
          <h3 className="text-[11px] font-semibold leading-tight text-foreground sm:text-sm">{title}</h3>
          {subtitle && <p className="mt-1 text-[10px] leading-tight text-muted-foreground sm:text-xs">{subtitle}</p>}
        </div>
      </div>

      <Table className="table-fixed text-[9px] sm:text-sm">
        <colgroup>
          <col className="w-[42%] sm:w-[42%]" />
          <col className="w-[7.25%] sm:w-auto" />
          <col className="w-[7.25%] sm:w-auto" />
          <col className="w-[7.25%] sm:w-auto" />
          <col className="w-[7.25%] sm:w-auto" />
          <col className="w-[7.25%] sm:w-auto" />
          <col className="w-[7.25%] sm:w-auto" />
          <col className="w-[7.25%] sm:w-auto" />
          <col className="w-[7.25%] sm:w-auto" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-6 px-0.5 text-[8px] leading-none sm:h-10 sm:px-2 sm:text-sm">{t("nation")}</TableHead>
            <TableHead className="h-6 px-0 text-center text-[8px] leading-none sm:h-10 sm:px-2 sm:text-sm">{t("playedShort")}</TableHead>
            <TableHead className="h-6 px-0 text-center text-[8px] leading-none sm:h-10 sm:px-2 sm:text-sm">{t("winsShort")}</TableHead>
            <TableHead className="h-6 px-0 text-center text-[8px] leading-none sm:h-10 sm:px-2 sm:text-sm">{t("drawsShort")}</TableHead>
            <TableHead className="h-6 px-0 text-center text-[8px] leading-none sm:h-10 sm:px-2 sm:text-sm">{t("lossesShort")}</TableHead>
            <TableHead className="h-6 px-0 text-center text-[8px] leading-none sm:h-10 sm:px-2 sm:text-sm">{t("goalsForShort")}</TableHead>
            <TableHead className="h-6 px-0 text-center text-[8px] leading-none sm:h-10 sm:px-2 sm:text-sm">{t("goalsAgainstShort")}</TableHead>
            <TableHead className="h-6 px-0 text-center text-[8px] leading-none sm:h-10 sm:px-2 sm:text-sm">{t("goalDifferenceShort")}</TableHead>
            <TableHead className="h-6 px-0 text-center text-[8px] font-semibold leading-none sm:h-10 sm:px-2 sm:text-sm">{t("pointsShort")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const isQualified =
              index < qualifiedCount || highlightedNationIds.has(row.nation.id);

            return (
              <TableRow
                key={row.nation.id}
                className={
                  isQualified
                    ? "bg-blue-500/[0.03] [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-blue-500 sm:[&>td:first-child]:border-l-4 sm:[&>td:first-child]:pl-1"
                    : undefined
                }
              >
                <TableCell className="p-0.5 sm:p-2">
                  <button
                    className="group flex min-w-0 cursor-pointer items-center gap-0.5 text-left sm:gap-2"
                    style={getNationHoverStyle(row.nation)}
                    onClick={() => openNation(row.nation.id)}
                  >
                    <span className="w-2.5 shrink-0 text-[8px] font-semibold text-muted-foreground sm:w-5 sm:text-xs">
                      {formatNumber(index + 1)}
                    </span>
                    <NationFlag
                      className="h-3 w-4 shrink-0 sm:h-4 sm:w-6"
                      emoji={row.nation.flag}
                      fallbackClassName="text-xs sm:text-base"
                      label={row.nation.name}
                      nationId={row.nation.id}
                    />
                    <span className="min-w-0 whitespace-normal break-words text-[8.5px] font-semibold leading-tight text-foreground transition-colors group-hover:text-[var(--nation-primary)] sm:hidden">
                      {getTranslatedTeamName(row.nation)}
                    </span>
                    <span className="hidden min-w-0 truncate text-sm font-medium text-foreground transition-colors group-hover:text-[var(--nation-primary)] sm:inline">
                      {getTranslatedTeamName(row.nation)}
                    </span>
                    {liveNationIds.has(row.nation.id) && (
                      <span
                        aria-label="Currently playing"
                        className="relative ml-auto flex h-1.5 w-1.5 shrink-0 sm:h-2.5 sm:w-2.5"
                        title="Currently playing"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-600 sm:h-2.5 sm:w-2.5" />
                      </span>
                    )}
                  </button>
                </TableCell>
                <TableCell className="p-0 text-center leading-none sm:p-2 sm:leading-normal">{formatNumber(row.played)}</TableCell>
                <TableCell className="p-0 text-center leading-none sm:p-2 sm:leading-normal">{formatNumber(row.wins)}</TableCell>
                <TableCell className="p-0 text-center leading-none sm:p-2 sm:leading-normal">{formatNumber(row.draws)}</TableCell>
                <TableCell className="p-0 text-center leading-none sm:p-2 sm:leading-normal">{formatNumber(row.losses)}</TableCell>
                <TableCell className="p-0 text-center leading-none sm:p-2 sm:leading-normal">{formatNumber(row.goalsFor)}</TableCell>
                <TableCell className="p-0 text-center leading-none sm:p-2 sm:leading-normal">{formatNumber(row.goalsAgainst)}</TableCell>
                <TableCell className="p-0 text-center leading-none sm:p-2 sm:leading-normal">
                  {formatGoalDifference(row.goalDifference)}
                </TableCell>
                <TableCell className="p-0 text-center font-semibold leading-none text-foreground sm:p-2 sm:leading-normal">
                  {formatNumber(row.points)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );

  return (
    <div className="container mx-auto px-0 py-4 sm:px-4 sm:py-6">
      <Tabs defaultValue="group-stage" className="w-full">
        <TabsList className="mb-4 h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border/50 bg-transparent p-0">
          <TabsTrigger
            value="group-stage"
            className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            {t("groupStage")}
          </TabsTrigger>
          <TabsTrigger
            value="knockout-stage"
            className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            {t("knockoutStage")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="group-stage" className="mt-0">
          <div className="space-y-3 sm:space-y-6">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-6">
              {Object.entries(standingsByGroup).map(([groupName, rows]) => (
                <div key={groupName}>
                  {renderStandingsTable(
                    getTranslatedGroupName(groupName),
                    rows,
                    2,
                    undefined,
                    qualifiedThirdPlaceNationIds
                  )}
                </div>
              ))}
            </div>

            {renderStandingsTable(
              t("bestThirdPlaceTeams"),
              thirdPlaceRows,
              8,
              t("bestThirdPlaceDescription")
            )}
          </div>
        </TabsContent>

        <TabsContent value="knockout-stage" className="mt-0">
          <KnockoutStageBracket matchFixtures={matchFixtures} nationMap={nationMap} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
