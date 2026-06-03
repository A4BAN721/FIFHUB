"use client";

import { Nation, Player } from "@/lib/world-cup-data";
import { useLanguage } from "./language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { useState, useMemo } from "react";

interface NationDetailProps {
  nation: Nation;
  onBack: () => void;
}

export function NationDetail({ nation, onBack }: NationDetailProps) {
  const { t } = useLanguage();
  const [filterPosition, setFilterPosition] = useState<string>("all");

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
        <div className="absolute inset-0 opacity-20">
          <div
            className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl"
            style={{ backgroundColor: accentColor }}
          />
          <div
            className="absolute bottom-0 left-0 w-64 h-64 rounded-full blur-2xl"
            style={{ backgroundColor: secondaryColor }}
          />
        </div>

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
            <span className="text-7xl md:text-8xl">{nation.flag}</span>
            <div>
              <h1
                className="text-4xl md:text-5xl font-bold mb-2"
                style={{ color: isLightPrimary ? "#000" : "#fff" }}
              >
                {nation.name}
              </h1>
              <div
                className="flex items-center gap-4 text-sm"
                style={{ color: isLightPrimary ? "#333" : "#ddd" }}
              >
                <span className="font-medium">{nation.confederation}</span>
                <span>|</span>
                <span>
                  {t("squadValue")}: <strong>{nation.totalSquadValue}</strong>
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
              Jersey Colors:
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
                {pos === "all" ? "All" : t(pos.toLowerCase())}
              </Button>
            )
          )}
        </div>
      </div>

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
              className="w-20 h-20 rounded-lg flex-shrink-0 border-2 bg-muted/70 flex items-center justify-center text-sm font-semibold uppercase text-foreground"
              style={{
                borderColor: `${nationColors.primary}30`,
                backgroundColor: `${nationColors.secondary}15`,
              }}
            >
              {player.fullName
                .split(" ")
                .slice(0, 2)
                .map((part) => part[0] || "")
                .join("")
                .toUpperCase()}
            </div>

            {/* Player Info */}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-foreground truncate group-hover:text-primary transition-colors">
                {player.fullName}
              </h3>
              <p
                className="text-sm font-medium mb-1"
                style={{ color: nationColors.primary }}
              >
                {player.position}
              </p>
              <p className="text-xs text-muted-foreground truncate">
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
              <span className="font-medium text-foreground">{player.strongFoot}</span>
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
