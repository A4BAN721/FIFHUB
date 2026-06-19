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
        className="group relative cursor-pointer overflow-hidden rounded-[1.75rem] border border-border/20 bg-card/20 py-0 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-[var(--tab-color)] hover:shadow-[0_24px_90px_-40px_rgba(0,0,0,0.25)]"
      >
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(0,0,0,0.08),transparent_40%)]" />

        <div className="relative p-5 pt-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <NationFlag
                className="h-8 w-11"
                code={nation.code}
                emoji={nation.flag}
                fallbackClassName="text-3xl"
                label={nation.name}
                nationId={nation.id}
              />
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <h3 className="min-w-0 truncate text-lg font-semibold text-foreground transition-colors group-hover:text-[var(--tab-color)]">
                  {getTranslatedCountryName(nation.id)}
                </h3>
                <p className={`shrink-0 text-xs text-muted-foreground ${language === "bn" ? "" : "uppercase tracking-[0.24em]"}`}>
                  {getTranslatedConfederation(nation.confederation)}
                </p>
              </div>
            </div>
          </div>

          <div style={lowerPanelStyle} className="-mx-5 -mb-5 mt-6 space-y-3 p-5">
            <div className="flex items-center justify-between gap-3 rounded-[1.5rem] border border-white/10 bg-black/75 p-4 shadow-[0_16px_45px_-28px_rgba(0,0,0,0.9)]">
              <div className="flex items-center gap-3">
                <div className="hidden">
                  <span className="text-foreground">⚽</span>
                </div>
                <div>
                  <p className={`text-[10px] text-white/70 ${labelSpacingClass}`}>{t("squadValue")}</p>
                  <p className="text-sm font-semibold text-white">{formatSquadValue(nation.totalSquadValue)}</p>
                </div>
              </div>
              <span className={`rounded-full bg-white/10 px-3 py-1 text-[11px] text-white ${mutedPillSpacingClass}`}>
                {nation.players.length} {t("players").toLowerCase()}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
