"use client";

import { useState, useMemo } from "react";
import { nations } from "@/lib/world-cup-data";
import { useLanguage } from "./language-provider";
import { NationCard } from "./nation-card";
import { NationDetail } from "./nation-detail";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

const fifaGroups: Record<string, string[]> = {
  A: ["mexico", "south-africa", "south-korea", "czechia"],
  B: ["canada", "bosnia-herzegovina", "qatar", "switzerland"],
  C: ["brazil", "morocco", "haiti", "scotland"],
  D: ["usa", "paraguay", "australia", "turkiye"],
  E: ["germany", "curacao", "ivory-coast", "ecuador"],
  F: ["netherlands", "japan", "sweden", "tunisia"],
  G: ["belgium", "egypt", "iran", "new-zealand"],
  H: ["spain", "cape-verde", "saudi-arabia", "uruguay"],
  I: ["france", "senegal", "iraq", "norway"],
  J: ["argentina", "algeria", "austria", "jordan"],
  K: ["portugal", "dr-congo", "uzbekistan", "colombia"],
  L: ["england", "croatia", "ghana", "panama"],
};

const qualifiedNationIds = new Set(Object.values(fifaGroups).flat());

export function NationsGrid() {
  const { t } = useLanguage();
  const [selectedNationId, setSelectedNationId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const qualifiedNations = useMemo(
    () => nations.filter((nation) => qualifiedNationIds.has(nation.id)),
    []
  );

  const filteredNations = useMemo(() => {
    if (!search.trim()) return qualifiedNations;
    const query = search.toLowerCase();
    return qualifiedNations.filter(
      (n) =>
        n.name.toLowerCase().includes(query) ||
        n.code.toLowerCase().includes(query) ||
        n.confederation.toLowerCase().includes(query)
    );
  }, [search, qualifiedNations]);

  const groupedNations = useMemo(() => {
    const nationMap = new Map(filteredNations.map((nation) => [nation.id, nation]));
    const groups: Record<string, typeof nations> = {};

    Object.entries(fifaGroups).forEach(([group, teamIds]) => {
      const teams = teamIds
        .map((teamId) => nationMap.get(teamId))
        .filter(Boolean) as typeof nations;
      if (teams.length > 0) {
        groups[`Group ${group}`] = teams;
      }
    });

    return groups;
  }, [filteredNations]);

  const selectedNation = selectedNationId
    ? qualifiedNations.find((n) => n.id === selectedNationId)
    : null;

  if (selectedNation) {
    return (
      <NationDetail
        nation={selectedNation}
        onBack={() => setSelectedNationId(null)}
      />
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Search */}
      <div className="mb-8">
        <div className="relative max-w-md mx-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-card/80 backdrop-blur-sm border-border/50"
          />
        </div>
      </div>

      {/* Title */}
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
          {t("allNationsTitle")}
        </h2>
        <p className="text-muted-foreground">
          {filteredNations.length} {t("allNationsSubtitle")}
        </p>
      </div>

      {/* Nations by Confederation */}
      <div className="space-y-10">
        {Object.entries(groupedNations).map(([confederation, confNations]) => (
          <section key={confederation}>
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                {confederation}
              </h3>
              <div className="flex-1 h-px bg-border/50" />
              <span className="text-sm text-muted-foreground">
                {confNations.length} teams
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {confNations.map((nation, index) => (
                <NationCard
                  key={nation.id}
                  nation={nation}
                  onClick={() => setSelectedNationId(nation.id)}
                  index={index}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
