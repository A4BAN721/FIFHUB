"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
    status: string;
    period: string;
    finalScoreConfirmedAt: string | null;
    updatedAt: string | null;
  }>;

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
  finalScoreConfirmedAt: string | null;
  updatedAt: string | null;
};

type ScoreboardApiResponse = {
  matches?: ScoreboardApiMatch[];
};

const localDataNations = new Map(
  fallbackNations
    .filter((nation) => qualifiedNationIds.has(nation.id))
    .map((nation) => [nation.id, nation])
);

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
    };
  }

  const completedMatch = completedMatchData[match.id];
  if (completedMatch) {
    return {
      homeScore: completedMatch.homeScore,
      awayScore: completedMatch.awayScore,
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
    finalScoreConfirmedAt: match.finalScoreConfirmedAt,
    updatedAt: match.updatedAt,
  };
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

      groupTables[`Group ${group}`] = rows.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.nation.name.localeCompare(b.nation.name);
      });
    }

    return groupTables;
  }, [matchFixtures, nationMap]);

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

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {Object.entries(standingsByGroup).map(([groupName, rows]) => (
          <section
            key={groupName}
            className="overflow-hidden rounded-lg border border-border/50 bg-card/75 backdrop-blur-xl"
          >
            <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                {getTranslatedGroupName(groupName)}
              </h3>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-36">{t("nation")}</TableHead>
                  <TableHead className="text-center">{t("playedShort")}</TableHead>
                  <TableHead className="text-center">{t("winsShort")}</TableHead>
                  <TableHead className="text-center">{t("drawsShort")}</TableHead>
                  <TableHead className="text-center">{t("lossesShort")}</TableHead>
                  <TableHead className="text-center">{t("goalsForShort")}</TableHead>
                  <TableHead className="text-center">{t("goalsAgainstShort")}</TableHead>
                  <TableHead className="text-center">{t("goalDifferenceShort")}</TableHead>
                  <TableHead className="text-center font-semibold">{t("pointsShort")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.nation.id}>
                    <TableCell>
                      <button
                        className="flex min-w-0 items-center gap-2 text-left"
                        onClick={() => openNation(row.nation.id)}
                      >
                        <span className="w-5 text-xs font-semibold text-muted-foreground">
                          {formatNumber(index + 1)}
                        </span>
                        <NationFlag
                          className="h-4 w-6"
                          emoji={row.nation.flag}
                          fallbackClassName="text-base"
                          label={row.nation.name}
                          nationId={row.nation.id}
                        />
                        <span className="max-w-32 truncate text-sm font-medium text-foreground">
                          {getTranslatedTeamName(row.nation)}
                        </span>
                        {liveNationIds.has(row.nation.id) && (
                          <span
                            aria-label="Currently playing"
                            className="relative ml-auto flex h-2.5 w-2.5 shrink-0"
                            title="Currently playing"
                          >
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
                          </span>
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="text-center">{formatNumber(row.played)}</TableCell>
                    <TableCell className="text-center">{formatNumber(row.wins)}</TableCell>
                    <TableCell className="text-center">{formatNumber(row.draws)}</TableCell>
                    <TableCell className="text-center">{formatNumber(row.losses)}</TableCell>
                    <TableCell className="text-center">{formatNumber(row.goalsFor)}</TableCell>
                    <TableCell className="text-center">{formatNumber(row.goalsAgainst)}</TableCell>
                    <TableCell className="text-center">
                      {formatGoalDifference(row.goalDifference)}
                    </TableCell>
                    <TableCell className="text-center font-semibold text-foreground">
                      {formatNumber(row.points)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ))}
      </div>
    </div>
  );
}
