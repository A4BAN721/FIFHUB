import { cn } from "@/lib/utils";
import { formatMatchMinute } from "@/lib/live-data/status";
import type { LiveMatch, MatchPhase, MatchStatus } from "@/lib/live-data/types";

type MatchStatusBadgeProps = {
  liveMatch?: LiveMatch | null;
  status?: MatchStatus;
  phase?: MatchPhase;
  minute?: number | null;
  stoppageMinute?: number | null;
  className?: string;
};

export function MatchStatusBadge({
  liveMatch,
  status = liveMatch?.status ?? "scheduled",
  phase = liveMatch?.phase ?? "pre_match",
  minute = liveMatch?.minute,
  stoppageMinute = liveMatch?.stoppageMinute,
  className,
}: MatchStatusBadgeProps) {
  const label = getStatusLabel(status, phase, minute, stoppageMinute);

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2 text-[10px] font-bold uppercase tracking-normal",
        status === "live" && "bg-red-500 text-white shadow-sm shadow-red-500/30",
        status === "half_time" && "bg-amber-500 text-black",
        (status === "extra_time" || status === "penalties") && "bg-purple-600 text-white",
        status === "finished" && "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-950",
        (status === "postponed" || status === "cancelled" || status === "suspended" || status === "interrupted") &&
          "bg-muted text-muted-foreground",
        status === "scheduled" && "bg-primary/10 text-primary",
        className
      )}
    >
      {label}
    </span>
  );
}

function getStatusLabel(
  status: MatchStatus,
  phase: MatchPhase,
  minute?: number | null,
  stoppageMinute?: number | null
) {
  if (status === "finished" || phase === "full_time") return "FT";
  if (status === "half_time" || phase === "half_time") return (minute ?? 45) >= 90 ? "End 90" : "HT";
  if (status === "extra_time" || phase === "extra_time") {
    return `${extraTimeBadgeLabel(minute)} ${formatMatchMinute(minute, stoppageMinute)}`;
  }
  if (status === "penalties" || phase === "penalties") return "PEN";
  if (status === "postponed") return "Postponed";
  if (status === "cancelled") return "Cancelled";
  if (status === "suspended") return "Suspended";
  if (status === "interrupted") return "Interrupted";
  if (status === "live") return `LIVE ${formatMatchMinute(minute, stoppageMinute)}`;
  return "Scheduled";
}

function extraTimeBadgeLabel(minute?: number | null) {
  if (typeof minute === "number" && minute > 105) return "ET 2H";
  return "ET 1H";
}
