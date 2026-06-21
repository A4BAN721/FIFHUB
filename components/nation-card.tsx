"use client";

import * as React from "react";
import type { Nation } from "@/lib/world-cup-data";
import { useLanguage } from "./language-provider";
import { Card } from "@/components/ui/card";
import { NationFlag } from "./nation-flag";
import { motion } from "framer-motion";

interface NationCardProps {
  nation: Nation;
  onClick: () => void;
  index: number;
}

type NationCardStyle = React.CSSProperties & {
  "--tab-color": string;
};

export function NationCard({ nation, onClick, index }: NationCardProps) {
  const { t, language } = useLanguage();
  const labelSpacingClass = language === "bn" ? "" : "uppercase tracking-[0.35em]";
  const mutedPillSpacingClass = language === "bn" ? "" : "uppercase tracking-[0.3em]";

  const formatSquadValue = (value: string): string => {
    if (language !== "bn") return value;

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

    const match = value.match(/^€([\d.]+)([MB])$/);
    if (!match) {
      return value.replace(/\d/g, (digit) => banglaNumerals[digit] || digit);
    }

    const amount = Number(match[1]);
    const millions = match[2] === "B" ? amount * 1000 : amount;
    const crores = millions / 10;
    const formattedCrores = Number.isInteger(crores)
      ? String(crores)
      : String(Number(crores.toFixed(1)));

    return `€${formattedCrores.replace(/\d/g, (digit) => banglaNumerals[digit] || digit)} কোটি`;
  };

  const getTranslatedCountryName = (nationId: string): string => {
    const translationKey = nationId.replace(/-/g, "");
    const translated = t(translationKey);
    // If in English mode and no translation found, return the original nation.name
    // If in Bangla mode and no translation found, return the original nation.name
    return translated || nation.name;
  };

  const getTranslatedConfederation = (confederation: string): string => {
    if (language !== "bn") return confederation;

    const confederationMap: Record<string, string> = {
      AFC: "এএফসি",
      CAF: "সিএএফ",
      CONCACAF: "কনকাকাফ",
      CONMEBOL: "কনমেবল",
      OFC: "ওএফসি",
      UEFA: "উয়েফা",
    };

    return confederationMap[confederation] || confederation;
  };

  const cardStyle: NationCardStyle = {
    borderColor: nation.jerseyColors.primary,
    backgroundImage: `linear-gradient(140deg, ${nation.jerseyColors.primary}22 0%, ${nation.jerseyColors.secondary}14 35%, ${nation.jerseyColors.accent}10 100%), radial-gradient(circle at top left, ${nation.jerseyColors.primary}10, transparent 38%)`,
    "--tab-color": nation.jerseyColors.primary,
  };

  const lowerPanelStyle: React.CSSProperties = {
    backgroundColor: nation.jerseyColors.primary,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.4 }}
    >
      <Card
        onClick={onClick}
        style={cardStyle}
        className="group relative cursor-pointer overflow-hidden rounded-xl border border-border/20 bg-card/20 py-0 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-[var(--tab-color)] hover:shadow-[0_24px_90px_-40px_rgba(0,0,0,0.25)] sm:rounded-[1.75rem]"
      >
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(0,0,0,0.08),transparent_40%)]" />

        <div className="relative p-2.5 pt-3 sm:p-5 sm:pt-6">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <NationFlag
                className="h-5 w-7 shrink-0 sm:h-8 sm:w-11"
                code={nation.code}
                emoji={nation.flag}
                fallbackClassName="text-xl sm:text-3xl"
                label={nation.name}
                nationId={nation.id}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                <h3 className="min-w-0 truncate text-[10px] font-semibold leading-tight text-foreground transition-colors group-hover:text-[var(--tab-color)] sm:text-lg">
                  {getTranslatedCountryName(nation.id)}
                </h3>
                <p className={`shrink-0 text-[8px] leading-none text-muted-foreground sm:text-xs ${language === "bn" ? "" : "uppercase tracking-[0.08em] sm:tracking-[0.24em]"}`}>
                  {getTranslatedConfederation(nation.confederation)}
                </p>
              </div>
            </div>
          </div>

          <div style={lowerPanelStyle} className="-mx-2.5 -mb-2.5 mt-3 space-y-2 p-2.5 sm:-mx-5 sm:-mb-5 sm:mt-6 sm:space-y-3 sm:p-5">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/75 p-2 shadow-[0_16px_45px_-28px_rgba(0,0,0,0.9)] sm:gap-3 sm:rounded-[1.5rem] sm:p-4">
              <div className="min-w-0">
                <div className="hidden">
                  <span className="text-foreground">⚽</span>
                </div>
                <div>
                  <p className={`truncate text-[6px] leading-none text-white/70 sm:text-[10px] ${labelSpacingClass}`}>{t("squadValue")}</p>
                  <p className="truncate text-[9px] font-semibold text-white sm:text-sm">{formatSquadValue(nation.totalSquadValue)}</p>
                </div>
              </div>
              <span className={`shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[7px] text-white sm:px-3 sm:py-1 sm:text-[11px] ${mutedPillSpacingClass}`}>
                {nation.players.length} {t("players").toLowerCase()}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
