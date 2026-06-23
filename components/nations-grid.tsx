"use client";

import { useEffect, useMemo, useState } from "react";
import type { Nation } from "@/lib/world-cup-data";
import { nations as fallbackNations } from "@/lib/world-cup-data";
import { qualifiedNationIds } from "@/lib/world-cup-groups";
import { getNations } from "@/lib/supabase/data";
import { useLanguage } from "./language-provider";
import { NationCard } from "./nation-card";
import { NationDetail } from "./nation-detail";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

const hostNationIds = ["mexico", "canada", "usa"];
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
  const { t } = useLanguage();
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
      (nation) =>
        nation.name.toLowerCase().includes(query) ||
        nation.code.toLowerCase().includes(query) ||
        nation.confederation.toLowerCase().includes(query)
    );
  }, [search, qualifiedNations]);

  const nationSections = useMemo(() => {
    const nationMap = new Map(filteredNations.map((nation) => [nation.id, nation]));
    const hostNations = hostNationIds
      .map((nationId) => nationMap.get(nationId))
      .filter(Boolean) as Nation[];
    const remainingNations = filteredNations
      .filter((nation) => !hostNationIds.includes(nation.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    return [
      { title: t("hostNations"), nations: hostNations },
      { title: t("allOtherNations"), nations: remainingNations },
    ].filter((section) => section.nations.length > 0);
  }, [filteredNations, t]);

  const selectedNation = selectedNationId
    ? qualifiedNations.find((nation) => nation.id === selectedNationId)
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
    <div className="container mx-auto px-2 py-5 sm:px-4 sm:py-8">
      <div className="mb-5 sm:mb-8">
        <div className="relative max-w-md mx-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-10 bg-card/80 backdrop-blur-sm border-border/50"
          />
        </div>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {t("clickNationToViewSquad")}
        </p>
      </div>

      <div className="space-y-6 sm:space-y-10">
        {nationSections.map((section) => (
          <section key={section.title}>
            <div className="mb-3 flex items-center gap-3 sm:mb-4">
              <h3 className="text-sm font-semibold text-foreground sm:text-lg">
                {section.title}
              </h3>
              <div className="flex-1 h-px bg-border/50" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
              {section.nations.map((nation, index) => (
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
