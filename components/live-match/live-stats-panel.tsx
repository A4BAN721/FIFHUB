import { normalizeCountryName } from "@/lib/country-utils";
import { getFifaAbbreviation } from "@/lib/team-display";
import type { MatchEvent, MatchStatistics } from "@/lib/live-data/types";

type LiveStatsPanelProps = {
  statistics?: MatchStatistics | null;
  events?: MatchEvent[];
  homeTeam?: string;
  awayTeam?: string;
};

const stats = [
  ["Possession", "homePossession", "awayPossession", "%"],
  ["Expected Goals (xG)", "homeExpectedGoals", "awayExpectedGoals", ""],
  ["Shots", "homeShots", "awayShots", ""],
  ["Shots On Target", "homeShotsOnTarget", "awayShotsOnTarget", ""],
  ["Passes", "homePasses", "awayPasses", ""],
  ["Passing Accuracy", "homePassingAccuracy", "awayPassingAccuracy", "%"],
  ["Corners", "homeCorners", "awayCorners", ""],
  ["Offsides", "homeOffsides", "awayOffsides", ""],
  ["Fouls", "homeFouls", "awayFouls", ""],
  ["Yellow Cards", "homeYellowCards", "awayYellowCards", ""],
  ["Red Cards", "homeRedCards", "awayRedCards", ""],
] as const;

export function LiveStatsPanel({ statistics, events = [], homeTeam = "Home", awayTeam = "Away" }: LiveStatsPanelProps) {
  const hasDetailedStats = stats.some(([, homeKey, awayKey]) => {
    return statistics?.[homeKey] != null || statistics?.[awayKey] != null;
  });
  const homeAssists = getAssistLines(events, homeTeam);
  const awayAssists = getAssistLines(events, awayTeam);

  return (
    <div className="space-y-2">
      <div className="space-y-1 rounded-lg border border-border/40 bg-background/45 p-2">
        {stats.map(([label, homeKey, awayKey, suffix]) => (
          <div key={label} className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 text-[11px]">
            <span className="text-left font-semibold tabular-nums text-foreground">
              {formatStat(statistics?.[homeKey], suffix)}
            </span>
            <span className="truncate text-center text-muted-foreground">{label}</span>
            <span className="text-right font-semibold tabular-nums text-foreground">
              {formatStat(statistics?.[awayKey], suffix)}
            </span>
          </div>
        ))}
      </div>
      {!hasDetailedStats && (
        <p className="text-[11px] font-medium leading-snug text-foreground/80">
          Detailed match stats are not available from the current live data provider.
        </p>
      )}
      {(homeAssists.length > 0 || awayAssists.length > 0) && (
        <div className="rounded-lg border border-border/40 bg-background/45 p-2">
          <p className="mb-2 text-center text-[11px] font-black uppercase text-muted-foreground">Goal Assists</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <AssistColumn teamName={homeTeam} assists={homeAssists} align="left" />
            <AssistColumn teamName={awayTeam} assists={awayAssists} align="right" />
          </div>
        </div>
      )}
    </div>
  );
}

function formatStat(value: number | null | undefined, suffix: string) {
  if (value == null) return "N/A";
  if (suffix === "%" && !Number.isInteger(value)) return `${value.toFixed(1)}${suffix}`;
  if (suffix === "" && !Number.isInteger(value)) return value.toFixed(2);
  return `${value}${suffix}`;
}

function AssistColumn({
  teamName,
  assists,
  align,
}: {
  teamName: string;
  assists: string[];
  align: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <p className="mb-1 text-[10px] font-black uppercase text-muted-foreground">{getFifaAbbreviation(teamName)}</p>
      {assists.length > 0 ? (
        <div className="space-y-1">
          {assists.map((line) => (
            <p key={line} className="text-[11px] font-semibold text-foreground">{line}</p>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">No assists</p>
      )}
    </div>
  );
}

function getAssistLines(events: MatchEvent[], teamName: string) {
  const teamKey = normalizeCountryName(teamName);

  return events
    .filter((event) => {
      if (!event.assistPlayerName || event.eventType === "own_goal") return false;
      return event.teamName ? normalizeCountryName(event.teamName) === teamKey : false;
    })
    .map((event) => {
      const minute = `${event.minute}${event.stoppageMinute ? `+${event.stoppageMinute}` : ""}'`;
      return `${event.assistPlayerName} for ${event.playerName ?? "goal"} ${minute}`;
    });
}
