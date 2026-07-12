"use client";

import { cn } from "@/lib/utils";
import { formatMatchMinute } from "@/lib/live-data/status";
import type { LiveMatch, MatchPhase, MatchStatus } from "@/lib/live-data/types";
import { useLanguage } from "@/components/language-provider";

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
  const { t, language } = useLanguage();
  const label = getStatusLabel(status, phase, minute, stoppageMinute, language, t);

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
  stoppageMinute?: number | null,
  language: "en" | "bn" = "en",
  t: (key: string) => string = (key) => key,
) {
  if (status === "finished" || phase === "full_time") return t("fullTimeShort");
  if (isExtraTimeHalfTime(status, phase, minute)) return t("extraTimeHalfTimeShort");
  if (status === "half_time" || phase === "half_time") return (minute ?? 45) >= 90 ? t("endOf90Minutes") : t("halfTimeShort");
  if (status === "extra_time" || phase === "extra_time") {
    return `${extraTimeBadgeLabel(minute, t)} ${formatLocalizedNumber(formatMatchMinute(minute, stoppageMinute), language)}`;
  }
  if (status === "penalties" || phase === "penalties") return t("penaltiesShort");
  if (status === "postponed") return t("postponed");
  if (status === "cancelled") return t("cancelled");
  if (status === "suspended") return t("suspended");
  if (status === "interrupted") return t("interrupted");
  if (status === "live") return `${t("liveShort")} ${formatLocalizedNumber(formatMatchMinute(minute, stoppageMinute), language)}`;
  return t("scheduled");
}

function isExtraTimeHalfTime(status: MatchStatus, phase: MatchPhase, minute?: number | null) {
  return status === "half_time" && (phase === "extra_time" || (typeof minute === "number" && minute >= 105));
}

function extraTimeBadgeLabel(minute: number | null | undefined, t: (key: string) => string) {
  if (typeof minute === "number" && minute > 105) return `${t("extraTimeShort")} 2H`;
  return `${t("extraTimeShort")} 1H`;
}

function formatLocalizedNumber(value: string | number, language: "en" | "bn") {
  if (language !== "bn") return String(value);
  return String(value).replace(/\d/g, (digit) => banglaNumerals[digit] ?? digit);
}

const banglaNumerals: Record<string, string> = {
  "0": "০",
  "1": "১",
  "2": "২",
  "3": "৩",
  "4": "৪",
  "5": "৫",
  "6": "৬",
  "7": "৭",
  "8": "৮",
  "9": "৯",
};
