import type { MatchStatistics } from "@/lib/live-data/types";

type LiveStatsPanelProps = {
  statistics: MatchStatistics;
};

const stats = [
  ["Possession", "homePossession", "awayPossession", "%"],
  ["Shots", "homeShots", "awayShots", ""],
  ["On Target", "homeShotsOnTarget", "awayShotsOnTarget", ""],
  ["Corners", "homeCorners", "awayCorners", ""],
  ["Fouls", "homeFouls", "awayFouls", ""],
] as const;

export function LiveStatsPanel({ statistics }: LiveStatsPanelProps) {
  const visibleStats = stats.filter(([, homeKey, awayKey]) => {
    return statistics[homeKey] != null || statistics[awayKey] != null;
  });

  return (
    <div className="space-y-1.5 border-t border-border/40 pt-2">
      <h4 className="text-[11px] font-bold uppercase tracking-normal text-muted-foreground">
        Match Stats
      </h4>
      {visibleStats.length > 0 ? (
        <div className="space-y-1">
          {visibleStats.map(([label, homeKey, awayKey, suffix]) => (
            <div key={label} className="grid grid-cols-[2rem_1fr_2rem] items-center gap-2 text-[11px]">
              <span className="text-left font-semibold tabular-nums text-foreground">
                {formatStat(statistics[homeKey], suffix)}
              </span>
              <span className="truncate text-center text-muted-foreground">{label}</span>
              <span className="text-right font-semibold tabular-nums text-foreground">
                {formatStat(statistics[awayKey], suffix)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] font-medium text-muted-foreground">
          Detailed stats are unavailable from the current data provider.
        </p>
      )}
    </div>
  );
}

function formatStat(value: number | null | undefined, suffix: string) {
  if (value == null) return "-";
  return `${value}${suffix}`;
}
