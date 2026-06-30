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
  void events;
  void homeTeam;
  void awayTeam;

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
    </div>
  );
}

function formatStat(value: number | null | undefined, suffix: string) {
  if (value == null) return "N/A";
  if (suffix === "%" && !Number.isInteger(value)) return `${value.toFixed(1)}${suffix}`;
  if (suffix === "" && !Number.isInteger(value)) return value.toFixed(2);
  return `${value}${suffix}`;
}
