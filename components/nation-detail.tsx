"use client";

import type { Nation, Player } from "@/lib/world-cup-data";
import { useLanguage } from "./language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NationFlag } from "./nation-flag";
import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { useState, useMemo } from "react";

interface NationDetailProps {
  nation: Nation;
  onBack: () => void;
}

export function NationDetail({ nation, onBack }: NationDetailProps) {
  const { t, language } = useLanguage();
  const [filterPosition, setFilterPosition] = useState<string>("all");

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

  const filteredPlayers = useMemo(() => {
    if (filterPosition === "all") return nation.players;
    return nation.players.filter((p) =>
      p.position.toLowerCase().includes(filterPosition.toLowerCase())
    );
  }, [nation.players, filterPosition]);

  const groupedPlayers = useMemo(() => {
    const groups: Record<string, Player[]> = {
      Goalkeeper: [],
      Defender: [],
      Midfielder: [],
      Forward: [],
    };
    filteredPlayers.forEach((player) => {
      if (groups[player.position]) {
        groups[player.position].push(player);
      }
    });
    // Sort players within each position by jersey number ascending
    Object.keys(groups).forEach((pos) => {
      groups[pos].sort((a, b) => a.jerseyNumber - b.jerseyNumber);
    });
    return groups;
  }, [filteredPlayers]);

  // Dynamic styles based on nation jersey
  const primaryColor = nation.jerseyColors.primary;
  const secondaryColor = nation.jerseyColors.secondary;
  const accentColor = nation.jerseyColors.accent;

  // Determine if primary is light or dark for text contrast
  const isLightPrimary = isLightColor(primaryColor);

  return (
    <div
      className="min-h-screen transition-colors duration-500"
      style={{
        background: `linear-gradient(135deg, ${primaryColor}10 0%, transparent 50%, ${accentColor}10 100%)`,
      }}
    >
      {/* Header with nation colors */}
      <div
        className="relative overflow-hidden"
        style={{ backgroundColor: primaryColor }}
      >
        <div className="container mx-auto px-4 py-8 relative z-10">
          <Button
            onClick={onBack}
            variant="ghost"
            className="mb-4 gap-2"
            style={{ color: isLightPrimary ? "#000" : "#fff" }}
          >
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Button>

          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="flex h-20 w-28 items-center justify-center rounded-xl border border-white/20 bg-white/15 p-2 shadow-inner md:h-24 md:w-32">
              <NationFlag
                className="h-full w-full"
                code={nation.code}
                emoji={nation.flag}
                fallbackClassName="text-7xl md:text-8xl"
                label={nation.name}
                nationId={nation.id}
                showBrazilStars
              />
            </div>
            <div>
              <h1
                className="text-4xl md:text-5xl font-bold mb-2"
                style={{ color: isLightPrimary ? "#000" : "#fff" }}
              >
                {getTranslatedCountryName(nation.id)}
              </h1>
              <div
                className="flex items-center gap-4 text-sm"
                style={{ color: isLightPrimary ? "#333" : "#ddd" }}
              >
                <span className="font-medium">{getTranslatedConfederation(nation.confederation)}</span>
                <span>|</span>
                <span>
                  {t("squadValue")}: <strong>{formatSquadValue(nation.totalSquadValue)}</strong>
                </span>
                <span>|</span>
                <span>
                  {nation.players.length} {t("players")}
                </span>
              </div>
            </div>
          </div>

          {/* Jersey color palette */}
          <div className="mt-6 flex items-center gap-2">
            <span
              className="text-xs font-medium"
              style={{ color: isLightPrimary ? "#333" : "#ddd" }}
            >
              {t("jerseyColors")}:
            </span>
            <div className="flex gap-1">
              <div
                className="w-6 h-6 rounded-full border-2"
                style={{
                  backgroundColor: primaryColor,
                  borderColor: isLightPrimary ? "#00000030" : "#ffffff30",
                }}
              />
              <div
                className="w-6 h-6 rounded-full border-2"
                style={{
                  backgroundColor: secondaryColor,
                  borderColor: "#00000030",
                }}
              />
              <div
                className="w-6 h-6 rounded-full border-2"
                style={{
                  backgroundColor: accentColor,
                  borderColor: "#00000030",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Position Filter */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-wrap gap-2 justify-center">
          {["all", "Goalkeeper", "Defender", "Midfielder", "Forward"].map(
            (pos) => (
              <Button
                key={pos}
                variant={filterPosition === pos ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterPosition(pos)}
                className="transition-all"
                style={
                  filterPosition === pos
                    ? { backgroundColor: primaryColor, color: isLightPrimary ? "#000" : "#fff" }
                    : {}
                }
              >
                {pos === "all" ? t("all") : t(pos.toLowerCase())}
              </Button>
            )
          )}
        </div>
      </div>

      {/* Head Coach */}
      {nation.headCoach && (
        <div className="container mx-auto px-4 pb-8">
          <div
            className="rounded-xl p-6 border backdrop-blur-sm"
            style={{
              borderColor: `${primaryColor}20`,
              backgroundColor: `${primaryColor}08`,
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-full text-white text-lg font-bold shrink-0"
                style={{ backgroundColor: primaryColor }}
              >
                HC
              </div>
              <div>
                <p className="text-sm text-muted-foreground uppercase tracking-wider font-medium">
                  Head Coach
                </p>
                <p
                  className="font-bold text-2xl sm:text-3xl"
                  style={{ color: primaryColor }}
                >
                  {nation.headCoach}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Players Grid by Position */}
      <div className="container mx-auto px-4 pb-12">
        {Object.entries(groupedPlayers).map(
          ([position, players]) =>
            players.length > 0 && (
              <section key={position} className="mb-10">
                <div className="flex items-center gap-3 mb-4">
                  <h2
                    className="text-lg font-semibold"
                    style={{ color: primaryColor }}
                  >
                    {t(position.toLowerCase())}s
                  </h2>
                  <div
                    className="flex-1 h-px"
                    style={{ backgroundColor: `${primaryColor}30` }}
                  />
                  <span className="text-sm text-muted-foreground">
                    {players.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {players.map((player, index) => (
                    <PlayerCard
                      key={player.id}
                      player={player}
                      nationColors={nation.jerseyColors}
                      index={index}
                      t={t}
                    />
                  ))}
                </div>
              </section>
            )
        )}
      </div>
    </div>
  );
}

interface PlayerCardProps {
  player: Player;
  nationColors: Nation["jerseyColors"];
  index: number;
  t: (key: string) => string;
}

function PlayerCard({ player, nationColors, index, t }: PlayerCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.3 }}
    >
      <Card className="overflow-hidden bg-card/90 backdrop-blur-sm border-border/50 hover:shadow-lg transition-all group">
        <div
          className="h-1"
          style={{ backgroundColor: nationColors.primary }}
        />
        <div className="p-4">
          <div className="flex gap-4">
            <div
              className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg border-2 bg-muted/70 text-[2.75rem] font-black leading-none text-foreground tabular-nums tracking-tight"
              style={{
                borderColor: `${nationColors.primary}30`,
                backgroundColor: `${nationColors.secondary}15`,
              }}
            >
              {player.jerseyNumber}
            </div>

            {/* Player Info */}
            <div className="flex-1 min-w-0">
              <h3 className="truncate font-bold uppercase text-foreground transition-colors group-hover:text-primary">
                {player.fullName}
              </h3>
              <p
                className="text-sm font-medium mb-1"
                style={{ color: nationColors.primary }}
              >
                {t(player.position.toLowerCase())}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {player.club}
              </p>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between p-2 rounded bg-muted/50">
              <span className="text-muted-foreground">{t("height")}</span>
              <span className="font-medium text-foreground">{player.height}</span>
            </div>
            <div className="flex justify-between p-2 rounded bg-muted/50">
              <span className="text-muted-foreground">{t("weight")}</span>
              <span className="font-medium text-foreground">{player.weight}</span>
            </div>
            <div className="flex justify-between p-2 rounded bg-muted/50">
              <span className="text-muted-foreground">{t("strongFoot")}</span>
              <span className="font-medium text-foreground">{t(player.strongFoot.toLowerCase())}</span>
            </div>
            <div className="flex justify-between p-2 rounded bg-muted/50">
              <span className="text-muted-foreground">{t("marketValue")}</span>
              <span
                className="font-bold"
                style={{ color: nationColors.primary }}
              >
                {player.marketValue}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

// Helper function to determine if a color is light
function isLightColor(color: string): boolean {
  // Handle hex colors
  if (color.startsWith("#")) {
    const hex = color.replace("#", "");
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 155;
  }
  return false;
}
