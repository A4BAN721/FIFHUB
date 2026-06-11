"use client";

import { useState, useMemo, useEffect } from "react";
import type { Nation } from "@/lib/world-cup-data";
import { nations as fallbackNations } from "@/lib/world-cup-data";
import { getNations } from "@/lib/supabase/data";
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
const localDataNationIds = new Set(qualifiedNationIds);
const localDataNations = new Map(
  fallbackNations
    .filter((nation) => localDataNationIds.has(nation.id))
    .map((nation) => [nation.id, nation])
);

interface NationsGridProps {
  initialSelectedNationId?: string | null;
  onNationBack?: () => void;
}

export function NationsGrid({ initialSelectedNationId, onNationBack }: NationsGridProps) {
  const { t, language } = useLanguage();
  const [selectedNationId, setSelectedNationId] = useState<string | null>(initialSelectedNationId || null);
  const [groupScrollY, setGroupScrollY] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [nations, setNations] = useState<Nation[]>(fallbackNations);

  useEffect(() => {
    let isMounted = true;

    getNations()
      .then((supabaseNations) => {
        if (isMounted && supabaseNations.length > 0) {
          const mergedNations = supabaseNations.map(
            (nation) => localDataNations.get(nation.id) ?? nation
          );

          for (const [nationId, nation] of localDataNations) {
            if (!mergedNations.some((item) => item.id === nationId)) {
              mergedNations.push(nation);
            }
          }

          setNations(mergedNations);
        }
      })
      .catch((error) => {
        console.error("Failed to load nations from Supabase:", error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (initialSelectedNationId) {
      setSelectedNationId(initialSelectedNationId);
    }
  }, [initialSelectedNationId]);

  useEffect(() => {
    const handleNationSelection = (event: CustomEvent) => {
      const detail = event.detail;
      const nationId = typeof detail === "string" ? detail : detail?.nationId;

      if (!nationId) return;

      setGroupScrollY(null);
      setSelectedNationId(nationId);
    };

    window.addEventListener("nationSelected", handleNationSelection as EventListener);

    return () => {
      window.removeEventListener("nationSelected", handleNationSelection as EventListener);
    };
  }, []);

  useEffect(() => {
    if (selectedNationId) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [selectedNationId]);

  const qualifiedNations = useMemo(
    () => nations.filter((nation) => qualifiedNationIds.has(nation.id)),
    [nations]
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
    const groups: Record<string, Nation[]> = {};

    Object.entries(fifaGroups).forEach(([group, teamIds]) => {
      const teams = teamIds
        .map((teamId) => nationMap.get(teamId))
        .filter(Boolean) as Nation[];
      if (teams.length > 0) {
        groups[`Group ${group}`] = teams;
      }
    });

    return groups;
  }, [filteredNations]);

  const getTranslatedGroupName = (groupName: string): string => {
    const groupMap: Record<string, string> = {
      "Group A": "গ্রুপ এ",
      "Group B": "গ্রুপ বি",
      "Group C": "গ্রুপ সি",
      "Group D": "গ্রুপ ডি",
      "Group E": "গ্রুপ ই",
      "Group F": "গ্রুপ এফ",
      "Group G": "গ্রুপ জি",
      "Group H": "গ্রুপ এইচ",
      "Group I": "গ্রুপ আই",
      "Group J": "গ্রুপ জে",
      "Group K": "গ্রুপ কে",
      "Group L": "গ্রুপ এল",
    };
    return groupMap[groupName] || groupName;
  };

  const selectedNation = selectedNationId
    ? qualifiedNations.find((n) => n.id === selectedNationId)
    : null;

  const handleOpenNation = (nationId: string) => {
    setGroupScrollY(window.scrollY);
    setSelectedNationId(nationId);
  };

  const handleBackFromNation = () => {
    const scrollY = groupScrollY;

    setSelectedNationId(null);
    setGroupScrollY(null);
    onNationBack?.();

    if (scrollY !== null) {
      window.setTimeout(() => {
        window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
      }, 0);
    }
  };

  if (selectedNation) {
    return (
      <NationDetail
        nation={selectedNation}
        onBack={handleBackFromNation}
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
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {t("clickNationToViewSquad")}
        </p>
      </div>

      {/* Nations by Confederation */}
      <div className="space-y-10">
        {Object.entries(groupedNations).map(([confederation, confNations]) => (
          <section key={confederation}>
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                {language === "bn" ? getTranslatedGroupName(confederation) : confederation}
              </h3>
              <div className="flex-1 h-px bg-border/50" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {confNations.map((nation, index) => (
                <NationCard
                  key={nation.id}
                  nation={nation}
                  onClick={() => handleOpenNation(nation.id)}
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
