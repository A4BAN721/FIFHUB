"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/header";
import { NationsGrid } from "@/components/nations-grid";
import { TriondaBackground } from "@/components/trionda-background";
import { MatchFixtures } from "@/components/match-fixtures";
import { GroupStandingsTable } from "@/components/group-standings-table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLanguage } from "@/components/language-provider";
import { Instagram, Mail } from "lucide-react";

export default function Home() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState("squads");
  const [selectedNationId, setSelectedNationId] = useState<string | null>(null);
  const [returnTab, setReturnTab] = useState<string | null>(null);
  const [returnScrollY, setReturnScrollY] = useState<number | null>(null);
  const [fixturesView, setFixturesView] = useState({ search: "", selectedStage: "ALL" });

  useEffect(() => {
    const handleNationSelection = (event: CustomEvent) => {
      const detail = event.detail;
      const nationId = typeof detail === "string" ? detail : detail?.nationId;

      if (!nationId) return;

      setSelectedNationId(nationId);
      setReturnTab(typeof detail === "string" ? null : detail.returnTab ?? null);
      setReturnScrollY(typeof detail === "string" ? null : detail.returnScrollY ?? null);
      setActiveTab("squads");
    };

    window.addEventListener("nationSelected", handleNationSelection as EventListener);

    return () => {
      window.removeEventListener("nationSelected", handleNationSelection as EventListener);
    };
  }, []);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setReturnTab(null);
    setReturnScrollY(null);
    if (value === "squads") {
      setSelectedNationId(null);
    }
  };

  const handleNationBack = () => {
    setSelectedNationId(null);
    if (returnTab) {
      setActiveTab(returnTab);
      const scrollY = returnScrollY;
      window.setTimeout(() => {
        window.scrollTo({ top: scrollY ?? 0, left: 0, behavior: "auto" });
      }, 0);
      setReturnTab(null);
      setReturnScrollY(null);
    }
  };

  return (
    <main className="min-h-screen relative">
      <TriondaBackground />
      <div className="relative z-10">
        <Header />
        <div className="container mx-auto px-4 py-6">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="mx-auto mb-6">
              <TabsTrigger value="squads">{t("groups")}</TabsTrigger>
              <TabsTrigger value="fixtures">{t("fixtures")}</TabsTrigger>
              <TabsTrigger value="table">{t("table")}</TabsTrigger>
            </TabsList>
            <TabsContent value="squads" className="mt-0">
              <NationsGrid initialSelectedNationId={selectedNationId} onNationBack={handleNationBack} />
            </TabsContent>
            <TabsContent value="fixtures" className="mt-0">
              <MatchFixtures
                initialSearch={fixturesView.search}
                initialSelectedStage={fixturesView.selectedStage}
                onViewChange={setFixturesView}
              />
            </TabsContent>
            <TabsContent value="table" className="mt-0">
              <GroupStandingsTable />
            </TabsContent>
          </Tabs>
        </div>
        <footer className="border-t border-border/30 bg-card/60 backdrop-blur-xl">
          <div className="container mx-auto flex flex-col items-center justify-center gap-3 px-4 py-5 text-sm text-muted-foreground sm:flex-row sm:gap-6">
            <a
              className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
              href="mailto:md.aaban080511@gmail.com"
            >
              <Mail className="h-4 w-4" />
              md.aaban080511@gmail.com
            </a>
            <span className="hidden h-4 w-px bg-border/60 sm:block" />
            <a
              className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
              href="https://www.instagram.com/md.aaban721"
              rel="noreferrer"
              target="_blank"
            >
              <Instagram className="h-4 w-4" />
              md.aaban721
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}
