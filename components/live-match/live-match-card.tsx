"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Play, X } from "lucide-react";
import type { Match } from "@/lib/match-fixtures";
import { normalizeCountryName } from "@/lib/country-utils";
import { getCompletedMatch } from "@/lib/live-data/completed-matches";
import { formatMatchMinute, formatPhaseLabel, isVisibleLiveState } from "@/lib/live-data/status";
import type { LiveMatch, MatchEvent } from "@/lib/live-data/types";
import { getFifaAbbreviation, getTeamDisplayName } from "@/lib/team-display";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NationFlag } from "@/components/nation-flag";
import { useLiveMatch } from "@/hooks/use-live-match";
import { LineupsPanel } from "./lineups-panel";
import { LiveStatsPanel } from "./live-stats-panel";

type LiveMatchCardProps = {
  match: Match;
  children: ReactNode;
  enableLiveData?: boolean;
};

export function LiveMatchCard({ match, children, enableLiveData = true }: LiveMatchCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const detailsScrollRef = useRef<HTMLDivElement | null>(null);
  const { liveMatch } = useLiveMatch(match.id, {
    enabled: enableLiveData,
    fallbackMatch: match,
    intervalMs: enableLiveData ? 30000 : 120000,
  });
  const completedMatch = getCompletedMatch(match.id);
  const scheduledLiveMatch =
    (!liveMatch || liveMatch.status === "scheduled") && !completedMatch
      ? createScheduledLiveMatch(match, now, liveMatch)
      : null;
  const sourcedMatch = getBestMatchState({ completedMatch, liveMatch, scheduledLiveMatch });
  const displayMatch = sourcedMatch ? withDisplayClock(sourcedMatch, now, match) : null;
  const shouldRunTimer = Boolean(sourcedMatch && (isMatchInProgress(sourcedMatch) || scheduledLiveMatch));

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("matchDetailsVisibilityChange", { detail: { open: isExpanded } }));
    document.body.toggleAttribute("data-match-details-open", isExpanded);

    return () => {
      if (isExpanded) {
        window.dispatchEvent(new CustomEvent("matchDetailsVisibilityChange", { detail: { open: false } }));
        document.body.removeAttribute("data-match-details-open");
      }
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!shouldRunTimer) return;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 15_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [shouldRunTimer, sourcedMatch?.matchId]);

  if (!isVisibleLiveState(displayMatch)) {
    return <div className="relative transition-all duration-300 hover:-translate-y-1">{children}</div>;
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className="relative cursor-pointer transition-all duration-300 hover:-translate-y-1"
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("button,a,input,select,textarea")) return;
          setIsExpanded(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsExpanded(true);
          }
        }}
        aria-label={`Open ${displayMatch.homeTeam} versus ${displayMatch.awayTeam} match details`}
      >
        {children}
        <CompactScoreOverlay liveMatch={displayMatch} fixtureStage={match.stage} />
        <CompactHighlightsLink liveMatch={displayMatch} />
      </div>

      {isExpanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setIsExpanded(false)}
            aria-label="Close match details"
          />
          <Card
            ref={detailsScrollRef}
            className="relative max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl border-white/15 bg-card/95 p-4 shadow-2xl shadow-black/50 sm:p-6"
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 z-10"
              onClick={() => setIsExpanded(false)}
              aria-label="Close match details"
            >
              <X className="h-4 w-4" />
            </Button>

            <div className="space-y-5">
              <ExpandedMatchHeader liveMatch={displayMatch} stadium={match.stadium} />
              <ExpandedScoreboard liveMatch={displayMatch} />
              <TeamEventSummary liveMatch={displayMatch} />
              <MatchDetailsTabs liveMatch={displayMatch} scrollContainerRef={detailsScrollRef} />
              <MatchHighlightsLink liveMatch={displayMatch} />

              <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
                <span className="truncate">
                  {match.date} - {match.time}
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function CompactHighlightsLink({ liveMatch }: { liveMatch: LiveMatch }) {
  if (!liveMatch.highlightsUrl) return null;

  return (
    <a
      href={liveMatch.highlightsUrl}
      target="_blank"
      rel="noreferrer"
      className="pointer-events-auto absolute bottom-2 right-2 z-30 rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[7px] font-black uppercase tracking-[0.16em] text-red-500 shadow-md backdrop-blur-sm transition-colors hover:border-red-500/70 hover:bg-red-500/25 sm:px-2.5 sm:text-[9px]"
      aria-label={liveMatch.highlightsTitle ?? "Open match highlights"}
      onClick={(event) => event.stopPropagation()}
    >
      MATCH HIGHLIGHTS
    </a>
  );
}

function MatchHighlightsLink({ liveMatch }: { liveMatch: LiveMatch }) {
  if (!liveMatch.highlightsUrl) return null;

  return (
    <a
      href={liveMatch.highlightsUrl}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-black uppercase tracking-[0.22em] text-red-500 transition-colors hover:border-red-500/60 hover:bg-red-500/15 sm:px-4 sm:py-3 sm:text-sm"
      aria-label={liveMatch.highlightsTitle ?? "Open match highlights"}
    >
      <span>MATCH HIGHLIGHTS</span>
      <Play className="h-4 w-4 shrink-0 fill-current" />
    </a>
  );
}

function CompactScoreOverlay({ liveMatch, fixtureStage }: { liveMatch: LiveMatch; fixtureStage: string }) {
  const timerLabel = getTimerLabel(liveMatch);
  const showLiveIndicator = shouldShowLiveIndicator(liveMatch);
  const isGroupStage = fixtureStage === "GROUP STAGE";

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {showLiveIndicator && (
        <span
          className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border border-white/80 bg-red-600 shadow-lg shadow-red-600/60 live-dot-pulse sm:h-3 sm:w-3"
        aria-hidden="true"
        />
      )}
      <span
        className={`absolute left-2 rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 text-[8px] font-black text-zinc-950 shadow-md dark:border-zinc-700 dark:bg-zinc-950 dark:text-white sm:px-2 sm:text-[10px] ${
          isGroupStage ? "top-5 sm:top-2" : "top-2"
        }`}
      >
        {getPlayPeriodLabel(liveMatch)}
      </span>
      <div className="absolute left-1/2 top-[58%] flex -translate-x-1/2 flex-col items-center gap-0.5 sm:top-[53%]">
        <span className="min-w-[44px] -translate-y-1/2 rounded-md border border-zinc-200 bg-white px-1 py-0.5 text-center text-[10px] font-black tabular-nums leading-tight text-zinc-950 shadow-lg dark:border-zinc-700 dark:bg-zinc-950 dark:text-white sm:min-w-[68px] sm:rounded-lg sm:px-3 sm:py-1 sm:text-sm">
          {liveMatch.homeScore} - {liveMatch.awayScore}
        </span>
        {timerLabel && (
          <span className="-mt-3 rounded-full border border-zinc-200 bg-white/95 px-1.5 py-0.5 text-[9px] font-black uppercase tabular-nums text-red-600 shadow-md dark:border-zinc-700 dark:bg-zinc-950/95 sm:px-2 sm:text-[10px]">
            {timerLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function getBestMatchState({
  completedMatch,
  liveMatch,
  scheduledLiveMatch,
}: {
  completedMatch: LiveMatch | null;
  liveMatch: LiveMatch | null;
  scheduledLiveMatch: LiveMatch | null;
}) {
  // If the match is finished in completedMatch data AND there's no live match,
  // use completedMatch (past match with confirmed score).
  if (!liveMatch && completedMatch) {
    return completedMatch;
  }

  // If we have live match data, prefer it for all state including scores.
  // For finished matches, the liveMatch will have the same final score.
  // For in-progress matches, liveMatch has the real-time scores.
  if (liveMatch) {
    if (liveMatch.status === "scheduled" && scheduledLiveMatch) {
      return scheduledLiveMatch;
    }

    // Merge completed match static data (statistics, events) with live match scores
    if (completedMatch) {
      return mergeCompletedAndLiveMatch(completedMatch, liveMatch);
    }
    return liveMatch;
  }

  // No live or completed data - check if we can create a scheduled shell
  return scheduledLiveMatch;
}

function mergeCompletedAndLiveMatch(completedMatch: LiveMatch, liveMatch: LiveMatch): LiveMatch {
  // Always prefer liveMatch scores - they represent the current real-time state.
  // If the match is finished, liveMatch will have the final confirmed score.
  // If the match is in progress, liveMatch has the real-time score.
  return {
    ...completedMatch,
    homeScore: liveMatch.homeScore,
    awayScore: liveMatch.awayScore,
    status: liveMatch.status,
    phase: liveMatch.phase,
    minute: liveMatch.minute,
    stoppageMinute: liveMatch.stoppageMinute,
    startedAt: liveMatch.startedAt ?? completedMatch.startedAt,
    finalScoreConfirmedAt: liveMatch.finalScoreConfirmedAt ?? completedMatch.finalScoreConfirmedAt,
    highlightsUrl: liveMatch.highlightsUrl ?? completedMatch.highlightsUrl,
    highlightsTitle: liveMatch.highlightsTitle ?? completedMatch.highlightsTitle,
    highlightsPublishedAt: liveMatch.highlightsPublishedAt ?? completedMatch.highlightsPublishedAt,
    updatedAt: liveMatch.updatedAt ?? completedMatch.updatedAt,
    statistics: hasMatchStatistics(liveMatch.statistics)
      ? { ...completedMatch.statistics, ...liveMatch.statistics }
      : completedMatch.statistics,
    events: liveMatch.events.length > 0 ? liveMatch.events : completedMatch.events,
    lineups: liveMatch.lineups ?? completedMatch.lineups,
  };
}

function hasMatchStatistics(statistics: LiveMatch["statistics"]) {
  return Object.values(statistics).some((value) => value != null);
}

function ExpandedMatchHeader({ liveMatch, stadium }: { liveMatch: LiveMatch; stadium: string }) {
  return (
    <div className="px-10 text-center">
      <p className="text-xs font-bold uppercase text-muted-foreground">{getStatusLabel(liveMatch)}</p>
      <h3 className="mt-1 text-xl font-black tracking-normal text-foreground sm:text-2xl">
        <span className="sm:hidden">
          {getFifaAbbreviation(liveMatch.homeTeam)} vs {getFifaAbbreviation(liveMatch.awayTeam)}
        </span>
        <span className="hidden sm:inline">
          {getTeamDisplayName(liveMatch.homeTeam)} vs {getTeamDisplayName(liveMatch.awayTeam)}
        </span>
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{stadium}</p>
    </div>
  );
}

function MatchDetailsTabs({
  liveMatch,
  scrollContainerRef,
}: {
  liveMatch: LiveMatch;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
  const [activeDetailsTab, setActiveDetailsTab] = useState("stats");
  const tabPanelStartRef = useRef<HTMLDivElement | null>(null);

  const handleDetailsTabChange = (value: string) => {
    setActiveDetailsTab(value);
    window.requestAnimationFrame(() => {
      const scrollContainer = scrollContainerRef.current;
      const tabPanelStart = tabPanelStartRef.current;
      if (!scrollContainer || !tabPanelStart) return;

      const containerTop = scrollContainer.getBoundingClientRect().top;
      const panelTop = tabPanelStart.getBoundingClientRect().top;
      scrollContainer.scrollTo({
        top: scrollContainer.scrollTop + panelTop - containerTop,
        left: 0,
        behavior: "auto",
      });
    });
  };

  return (
    <Tabs value={activeDetailsTab} onValueChange={handleDetailsTabChange} className="border-t border-border/40 pt-3">
      <TabsList className="grid h-9 w-full grid-cols-2">
        <TabsTrigger value="stats" className="text-xs font-black uppercase">
          Match Stats
        </TabsTrigger>
        <TabsTrigger value="lineups" className="text-xs font-black uppercase">
          Line-ups
        </TabsTrigger>
      </TabsList>
      <div ref={tabPanelStartRef} />
      <TabsContent value="stats" className="mt-3">
        <LiveStatsPanel
          statistics={liveMatch.statistics}
          events={liveMatch.events}
          homeTeam={liveMatch.homeTeam}
          awayTeam={liveMatch.awayTeam}
        />
      </TabsContent>
      <TabsContent value="lineups" className="mt-3">
        <LineupsPanel
          lineups={liveMatch.lineups}
          events={liveMatch.events}
          homeTeam={liveMatch.homeTeam}
          awayTeam={liveMatch.awayTeam}
        />
      </TabsContent>
    </Tabs>
  );
}

function getStatusLabel(liveMatch: LiveMatch) {
  if (liveMatch.status === "finished") return "FT";
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") return "HT";

  const minute = formatMatchMinute(liveMatch.minute, liveMatch.stoppageMinute);
  if (minute && liveMatch.status !== "scheduled") return minute;

  if (isMatchInProgress(liveMatch)) return "LIVE";

  return formatPhaseLabel(liveMatch.phase);
}

function getPlayPeriodLabel(liveMatch: LiveMatch) {
  if (liveMatch.status === "finished" || liveMatch.phase === "full_time") return "Full Time";
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") return "Half Time";
  if (liveMatch.status === "penalties" || liveMatch.phase === "penalties") return "Penalties";

  if (liveMatch.status === "extra_time" || liveMatch.phase === "extra_time") {
    return getExtraTimeHalfLabel(liveMatch.minute);
  }

  if (liveMatch.status === "live") {
    return liveMatch.phase === "first_half" ? "First Half" : "Second Half";
  }

  return formatPhaseLabel(liveMatch.phase);
}

function getExtraTimeHalfLabel(minute?: number | null) {
  if (typeof minute === "number" && minute > 105) return "Extra Time Second Half";
  return "Extra Time First Half";
}

function getTimerLabel(liveMatch: LiveMatch) {
  if (!isMatchInProgress(liveMatch)) return "";
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") return "Half Time";

  return formatMatchMinute(liveMatch.minute, liveMatch.stoppageMinute);
}

function withDisplayClock(liveMatch: LiveMatch, now: number, fixture: Match): LiveMatch {
  const timer = estimateDisplayClock(liveMatch, now, fixture);
  if (!timer) return sanitizeMatchClock(liveMatch);

  return {
    ...liveMatch,
    status: timer.status,
    phase: timer.phase,
    minute: timer.minute,
    stoppageMinute: timer.stoppageMinute,
  };
}

function sanitizeMatchClock(liveMatch: LiveMatch): LiveMatch {
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") {
    return {
      ...liveMatch,
      status: "half_time",
      phase: "half_time",
      minute: 45,
      stoppageMinute: null,
    };
  }

  if (liveMatch.status === "finished" || liveMatch.phase === "full_time") {
    return {
      ...liveMatch,
      status: "finished",
      phase: "full_time",
      minute: 90,
      stoppageMinute: null,
    };
  }

  return {
    ...liveMatch,
    stoppageMinute: capStoppageMinute(liveMatch.stoppageMinute),
  };
}

function estimateDisplayClock(liveMatch: LiveMatch, now: number, fixture: Match) {
  if (!isMatchInProgress(liveMatch)) return null;

  const kickoffTime = getKickoffTime(liveMatch, fixture);
  if (!Number.isFinite(kickoffTime)) return phaseFallbackClock(liveMatch);

  const elapsed = Math.floor((now - kickoffTime) / 60_000);
  if (elapsed < 0) return null;

  if (elapsed < 45) {
    return {
      status: "live" as const,
      phase: "first_half" as const,
      minute: Math.max(1, elapsed + 1),
      stoppageMinute: null,
    };
  }

  if (elapsed < 60) {
    return {
      status: "half_time" as const,
      phase: "half_time" as const,
      minute: 45,
      stoppageMinute: null,
    };
  }

  if (elapsed < 105) {
    return {
      status: "live" as const,
      phase: "second_half" as const,
      minute: Math.min(90, Math.max(46, elapsed - 14)),
      stoppageMinute: null,
    };
  }

  if (liveMatch.status === "extra_time" || liveMatch.phase === "extra_time") {
    return extraTimeClock(elapsed);
  }

  return capInProgressClock(liveMatch);
}

function phaseFallbackClock(liveMatch: LiveMatch) {
  if (liveMatch.status === "half_time" || liveMatch.phase === "half_time") {
    return {
      status: "half_time" as const,
      phase: "half_time" as const,
      minute: 45,
      stoppageMinute: null,
    };
  }

  if (liveMatch.phase === "first_half") {
    return {
      status: "live" as const,
      phase: "first_half" as const,
      minute: Math.min(45, Math.max(1, liveMatch.minute ?? 1)),
      stoppageMinute: capStoppageMinute(liveMatch.stoppageMinute),
    };
  }

  if (liveMatch.phase === "second_half" || liveMatch.status === "live") {
    return {
      status: "live" as const,
      phase: "second_half" as const,
      minute: Math.min(90, Math.max(46, liveMatch.minute ?? 46)),
      stoppageMinute: capStoppageMinute(liveMatch.stoppageMinute),
    };
  }

  if (liveMatch.phase === "extra_time" || liveMatch.status === "extra_time") {
    return {
      status: "extra_time" as const,
      phase: "extra_time" as const,
      minute: Math.min(120, Math.max(91, liveMatch.minute ?? 91)),
      stoppageMinute: capStoppageMinute(liveMatch.stoppageMinute),
    };
  }

  return null;
}

function extraTimeClock(elapsed: number) {
  if (elapsed < 120) {
    return {
      status: "extra_time" as const,
      phase: "extra_time" as const,
      minute: Math.min(105, Math.max(91, elapsed - 14)),
      stoppageMinute: null,
    };
  }

  if (elapsed < 135) {
    return {
      status: "extra_time" as const,
      phase: "extra_time" as const,
      minute: Math.min(120, Math.max(106, elapsed - 14)),
      stoppageMinute: null,
    };
  }

  return {
    status: "finished" as const,
    phase: "full_time" as const,
    minute: 120,
    stoppageMinute: null,
  };
}

function capInProgressClock(liveMatch: LiveMatch) {
  if (liveMatch.status === "penalties" || liveMatch.phase === "penalties") {
    return {
      status: "penalties" as const,
      phase: "penalties" as const,
      minute: 120,
      stoppageMinute: capStoppageMinute(liveMatch.stoppageMinute),
    };
  }

  return {
    status: "live" as const,
    phase: "second_half" as const,
    minute: Math.min(90, Math.max(46, liveMatch.minute ?? 90)),
    stoppageMinute: capStoppageMinute(liveMatch.stoppageMinute),
  };
}

function getKickoffTime(liveMatch: LiveMatch, fixture: Match) {
  const startedAt = liveMatch.startedAt ? Date.parse(liveMatch.startedAt) : NaN;
  if (Number.isFinite(startedAt)) return startedAt;

  return parseFixtureDateTime(fixture.date, fixture.time);
}

function parseFixtureDateTime(date: string, time: string) {
  const withoutWeekday = date.includes(",") ? date.split(",").slice(1).join(",").trim() : date;
  const parsed = Date.parse(`${withoutWeekday} ${time}`);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function createScheduledLiveMatch(match: Match, now: number, existingLiveMatch?: LiveMatch | null): LiveMatch | null {
  const kickoffTime = parseFixtureDateTime(match.date, match.time);
  if (!Number.isFinite(kickoffTime)) return null;

  const elapsed = Math.floor((now - kickoffTime) / 60_000);
  if (elapsed < 0 || elapsed >= 105) return null;

  return {
    matchId: match.id,
    status: "live",
    phase: elapsed < 45 ? "first_half" : elapsed < 60 ? "half_time" : "second_half",
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: 0,
    awayScore: 0,
    minute: null,
    startedAt: new Date(kickoffTime).toISOString(),
    updatedAt: new Date(now).toISOString(),
    statistics: existingLiveMatch?.statistics ?? {},
    lineups: existingLiveMatch?.lineups ?? null,
    events: existingLiveMatch?.events ?? [],
  };
}

function capStoppageMinute(stoppageMinute?: number | null) {
  if (typeof stoppageMinute !== "number" || stoppageMinute <= 0) return null;
  return Math.min(stoppageMinute, 15);
}

function isMatchInProgress(liveMatch: LiveMatch) {
  return (
    liveMatch.status === "live" ||
    liveMatch.status === "half_time" ||
    liveMatch.status === "extra_time" ||
    liveMatch.status === "penalties"
  );
}

function shouldShowLiveIndicator(liveMatch: LiveMatch) {
  return isMatchInProgress(liveMatch);
}

function isSameTeam(eventTeamName: string | null | undefined, teamName: string) {
  if (!eventTeamName) return false;
  return normalizeCountryName(eventTeamName) === normalizeCountryName(teamName);
}

function ExpandedScoreboard({ liveMatch }: { liveMatch: LiveMatch }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-border/50 bg-background/45 p-3 sm:gap-5 sm:p-5">
      <ExpandedTeamName teamName={liveMatch.homeTeam} align="left" />
      <span className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-2xl font-black tabular-nums text-zinc-950 shadow-lg dark:border-zinc-700 dark:bg-zinc-950 dark:text-white sm:text-3xl">
        {liveMatch.homeScore} - {liveMatch.awayScore}
      </span>
      <ExpandedTeamName teamName={liveMatch.awayTeam} align="right" />
    </div>
  );
}

function ExpandedTeamName({ teamName, align }: { teamName: string; align: "left" | "right" }) {
  const nationId = teamName === "TBD" ? null : normalizeCountryName(teamName);

  return (
    <div
      className={`flex min-w-0 items-center gap-3 ${
        align === "right" ? "justify-end text-right" : "justify-start text-left"
      }`}
    >
      {align === "left" && (
        <NationFlag
          className="h-8 w-11 sm:h-10 sm:w-14"
          fallbackClassName="text-3xl sm:text-4xl"
          label={teamName}
          nationId={nationId}
        />
      )}
      <span className="min-w-0 truncate text-lg font-black text-foreground sm:text-2xl">
        <span className="sm:hidden">{getFifaAbbreviation(teamName)}</span>
        <span className="hidden sm:inline">{getTeamDisplayName(teamName)}</span>
      </span>
      {align === "right" && (
        <NationFlag
          className="h-8 w-11 sm:h-10 sm:w-14"
          fallbackClassName="text-3xl sm:text-4xl"
          label={teamName}
          nationId={nationId}
        />
      )}
    </div>
  );
}

function TeamEventSummary({ liveMatch }: { liveMatch: LiveMatch }) {
  const goals = sortEventsByMinute(
    liveMatch.events.filter((event) =>
      ["goal", "penalty_goal", "own_goal"].includes(event.eventType),
    ),
  );
  const redCards = liveMatch.events.filter((event) =>
    ["red_card", "second_yellow"].includes(event.eventType),
  );

  return (
    <div className="grid gap-4 border-t border-border/40 pt-4 sm:grid-cols-2">
      <TeamEventColumn
        teamName={liveMatch.homeTeam}
        goals={sortEventsByMinute(goals.filter((event) => isSameTeam(event.teamName, liveMatch.homeTeam)))}
        redCards={redCards.filter((event) => isSameTeam(event.teamName, liveMatch.homeTeam))}
        align="left"
      />
      <TeamEventColumn
        teamName={liveMatch.awayTeam}
        goals={sortEventsByMinute(goals.filter((event) => isSameTeam(event.teamName, liveMatch.awayTeam)))}
        redCards={redCards.filter((event) => isSameTeam(event.teamName, liveMatch.awayTeam))}
        align="right"
      />
    </div>
  );
}

function TeamEventColumn({
  teamName,
  goals,
  redCards,
  align,
}: {
  teamName: string;
  goals: MatchEvent[];
  redCards: MatchEvent[];
  align: "left" | "right";
}) {
  const alignClass = align === "right" ? "text-right sm:items-end" : "text-left sm:items-start";

  return (
    <div className={`flex flex-col gap-3 ${alignClass}`}>
      <h4 className="text-xs font-black uppercase text-muted-foreground">
        <span className="sm:hidden">{getFifaAbbreviation(teamName)}</span>
        <span className="hidden sm:inline">{getTeamDisplayName(teamName)}</span>
      </h4>
      <div className="space-y-1.5">
        {goals.length > 0 ? (
          goals.map((goal) => (
            <p key={goal.id} className="text-sm font-semibold text-foreground">
              {formatGoalLine(goal)}
            </p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No goals</p>
        )}
      </div>
      {redCards.length > 0 && (
        <div className="space-y-1">
          {redCards.map((card) => (
            <RedCardRow key={card.id} card={card} align={align} />
          ))}
        </div>
      )}
    </div>
  );
}

function RedCardRow({ card, align }: { card: MatchEvent; align: "left" | "right" }) {
  return (
    <p
      className={`flex items-center gap-2 text-sm font-bold text-red-500 ${
        align === "right" ? "justify-end" : "justify-start"
      }`}
    >
      {align === "left" && <span className="h-4 w-2 rounded-[2px] bg-red-600" aria-label="Red card" />}
      <span>
        {card.playerName ?? "Unknown player"} {formatMinute(card)}
      </span>
      {align === "right" && <span className="h-4 w-2 rounded-[2px] bg-red-600" aria-label="Red card" />}
    </p>
  );
}

function formatGoalLine(goal: MatchEvent) {
  if (goal.eventType === "own_goal") {
    return `${goal.playerName ?? "Unknown player"} ${formatMinute(goal)} (OG)`;
  }

  const penaltyMarker = goal.eventType === "penalty_goal" ? " (P)" : "";
  const assist = goal.assistPlayerName ? `, assist: ${goal.assistPlayerName}` : "";
  return `${goal.playerName ?? "Unknown scorer"}${penaltyMarker} ${formatMinute(goal)}${assist}`;
}

function formatMinute(event: MatchEvent) {
  return `${event.minute}${event.stoppageMinute ? `+${event.stoppageMinute}` : ""}'`;
}

function sortEventsByMinute(events: MatchEvent[]) {
  return [...events].sort((a, b) => {
    const minuteDiff = a.minute - b.minute;
    if (minuteDiff !== 0) return minuteDiff;

    const stoppageDiff = (a.stoppageMinute ?? 0) - (b.stoppageMinute ?? 0);
    if (stoppageDiff !== 0) return stoppageDiff;

    return (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0);
  });
}
