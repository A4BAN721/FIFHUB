"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Header } from "@/components/header";
import { NationsGrid } from "@/components/nations-grid";
import { TriondaBackground } from "@/components/trionda-background";
import { MatchFixtures } from "@/components/match-fixtures";
import { GroupStandingsTable } from "@/components/group-standings-table";
import { TournamentStats } from "@/components/tournament-stats";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/components/language-provider";
import {
  COMPETITIONS,
  CompetitionSidebar,
  type CompetitionId,
} from "@/components/competition-sidebar";
import { Instagram, Mail } from "lucide-react";

const MAIN_TABS = ["squads", "fixtures", "table", "stats"] as const;

const tabSlideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 72 : -72,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -72 : 72,
    opacity: 0,
  }),
};

function WorldCupExperience() {
  const { t } = useLanguage();
  const prefersReducedMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState("squads");
  const [tabDirection, setTabDirection] = useState(1);
  const [selectedNationId, setSelectedNationId] = useState<string | null>(null);
  const [selectedPlayerName, setSelectedPlayerName] = useState<string | null>(null);
  const [returnTab, setReturnTab] = useState<string | null>(null);
  const [returnScrollY, setReturnScrollY] = useState<number | null>(null);
  const [fixturesView, setFixturesView] = useState({ search: "", selectedStage: "ALL" });
  const [targetFixtureId, setTargetFixtureId] = useState<string | null>(null);
  const [showFloatingChrome, setShowFloatingChrome] = useState(false);
  const [hasScrolledAway, setHasScrolledAway] = useState(false);
  const [matchDetailsOpen, setMatchDetailsOpen] = useState(false);
  const tabsStartRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef(activeTab);

  const transitionToTab = useCallback((value: string) => {
    const currentTab = activeTabRef.current;
    if (currentTab === value) return;

    const currentIndex = MAIN_TABS.indexOf(currentTab as (typeof MAIN_TABS)[number]);
    const nextIndex = MAIN_TABS.indexOf(value as (typeof MAIN_TABS)[number]);
    setTabDirection(nextIndex >= currentIndex ? 1 : -1);
    activeTabRef.current = value;
    setActiveTab(value);
  }, []);

  useEffect(() => {
    const handleNationSelection = (event: CustomEvent) => {
      const detail = event.detail;
      const nationId = typeof detail === "string" ? detail : detail?.nationId;

      if (!nationId) return;

      setSelectedNationId(nationId);
      setSelectedPlayerName(typeof detail === "string" ? null : detail.playerName ?? null);
      setReturnTab(typeof detail === "string" ? null : detail.returnTab ?? null);
      setReturnScrollY(typeof detail === "string" ? null : detail.returnScrollY ?? null);
      transitionToTab("squads");
    };

    window.addEventListener("nationSelected", handleNationSelection as EventListener);

    return () => {
      window.removeEventListener("nationSelected", handleNationSelection as EventListener);
    };
  }, [transitionToTab]);

  useEffect(() => {
    const handleFixtureSelection = (event: CustomEvent) => {
      const detail = event.detail;
      const matchId = typeof detail?.matchId === "string" ? detail.matchId : null;
      if (!matchId) return;

      setFixturesView({
        search: typeof detail.search === "string" ? detail.search : "",
        selectedStage: typeof detail.selectedStage === "string" ? detail.selectedStage : "ALL",
      });
      setTargetFixtureId(matchId);
      transitionToTab("fixtures");
    };

    window.addEventListener("fixtureSelected", handleFixtureSelection as EventListener);
    return () => {
      window.removeEventListener("fixtureSelected", handleFixtureSelection as EventListener);
    };
  }, [transitionToTab]);

  useEffect(() => {
    let previousY = window.scrollY;

    const handleScroll = () => {
      if (matchDetailsOpen) {
        setShowFloatingChrome(false);
        previousY = window.scrollY;
        return;
      }

      const nextY = window.scrollY;
      const isAwayFromTop = nextY > 160;
      setHasScrolledAway(isAwayFromTop);

      if (!isAwayFromTop) {
        setShowFloatingChrome(false);
      } else if (nextY < previousY - 8) {
        setShowFloatingChrome(true);
      } else if (nextY > previousY + 8) {
        setShowFloatingChrome(false);
      }

      previousY = nextY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [matchDetailsOpen]);

  useEffect(() => {
    const handleMatchDetailsVisibility = (event: CustomEvent<{ open: boolean }>) => {
      setMatchDetailsOpen(Boolean(event.detail?.open));
      if (event.detail?.open) {
        setShowFloatingChrome(false);
      }
    };

    window.addEventListener("matchDetailsVisibilityChange", handleMatchDetailsVisibility as EventListener);
    return () => {
      window.removeEventListener("matchDetailsVisibilityChange", handleMatchDetailsVisibility as EventListener);
    };
  }, []);

  const handleTabChange = (value: string) => {
    transitionToTab(value);
    setReturnTab(null);
    setReturnScrollY(null);
    setShowFloatingChrome(false);
    window.requestAnimationFrame(() => {
      const tabsStartTop = tabsStartRef.current?.getBoundingClientRect().top ?? 0;
      window.scrollTo({
        top: window.scrollY + tabsStartTop,
        left: 0,
        behavior: "auto",
      });
    });
    if (value === "squads") {
      setSelectedNationId(null);
      setSelectedPlayerName(null);
    }
  };

  const handleNationBack = () => {
    setSelectedNationId(null);
    setSelectedPlayerName(null);
    if (returnTab) {
      transitionToTab(returnTab);
      const scrollY = returnScrollY;
      window.setTimeout(() => {
        window.scrollTo({ top: scrollY ?? 0, left: 0, behavior: "auto" });
      }, 0);
      setReturnTab(null);
      setReturnScrollY(null);
    }
  };

  const mountFloatingFixturesChrome = activeTab === "fixtures" && hasScrolledAway && !matchDetailsOpen;
  const showFloatingFixturesChrome = mountFloatingFixturesChrome && showFloatingChrome;

  return (
    <main className="min-h-screen relative">
      <TriondaBackground />
      <div className="relative z-10">
        <div className="container mx-auto px-4 py-6">
          <div ref={tabsStartRef} />
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList
              className={`mx-auto mb-6 transition-all duration-200 ${
                mountFloatingFixturesChrome
                  ? `fixed left-1/2 top-3 z-[90] border border-border/50 bg-background/95 shadow-2xl backdrop-blur-xl ${
                      showFloatingFixturesChrome
                        ? "-translate-x-1/2 translate-y-0 opacity-100"
                        : "-translate-x-1/2 -translate-y-24 opacity-0"
                    }`
                  : ""
              }`}
            >
              <TabsTrigger id="main-tab-squads" aria-controls="main-tabpanel-squads" value="squads">
                {t("groups")}
              </TabsTrigger>
              <TabsTrigger id="main-tab-fixtures" aria-controls="main-tabpanel-fixtures" value="fixtures">
                {t("fixtures")}
              </TabsTrigger>
              <TabsTrigger id="main-tab-table" aria-controls="main-tabpanel-table" value="table">
                {t("table")}
              </TabsTrigger>
              <TabsTrigger id="main-tab-stats" aria-controls="main-tabpanel-stats" value="stats">
                {t("stats")}
              </TabsTrigger>
            </TabsList>
            <div className="relative overflow-x-clip">
              <AnimatePresence initial={false} custom={tabDirection} mode="popLayout">
                <motion.div
                  key={activeTab}
                  id={`main-tabpanel-${activeTab}`}
                  role="tabpanel"
                  aria-labelledby={`main-tab-${activeTab}`}
                  tabIndex={0}
                  custom={tabDirection}
                  variants={prefersReducedMotion ? undefined : tabSlideVariants}
                  initial={prefersReducedMotion ? { opacity: 0 } : "enter"}
                  animate={prefersReducedMotion ? { opacity: 1 } : "center"}
                  exit={prefersReducedMotion ? { opacity: 0 } : "exit"}
                  transition={
                    prefersReducedMotion
                      ? { duration: 0.12 }
                      : { type: "spring", stiffness: 360, damping: 34, mass: 0.8 }
                  }
                  className="w-full outline-none"
                >
                  {activeTab === "squads" && (
                    <NationsGrid
                      initialSelectedNationId={selectedNationId}
                      initialSelectedPlayerName={selectedPlayerName}
                      onNationBack={handleNationBack}
                    />
                  )}
                  {activeTab === "fixtures" && (
                    <MatchFixtures
                      initialSearch={fixturesView.search}
                      initialSelectedStage={fixturesView.selectedStage}
                      targetMatchId={targetFixtureId}
                      onViewChange={setFixturesView}
                      mountFloatingControls={mountFloatingFixturesChrome}
                      showFloatingControls={showFloatingFixturesChrome}
                    />
                  )}
                  {activeTab === "table" && <GroupStandingsTable />}
                  {activeTab === "stats" && <TournamentStats />}
                </motion.div>
              </AnimatePresence>
            </div>
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

export default function Home() {
  const prefersReducedMotion = useReducedMotion();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedCompetition, setSelectedCompetition] = useState<CompetitionId | null>(null);

  const selectedCompetitionName = COMPETITIONS.find(
    (competition) => competition.id === selectedCompetition,
  )?.name;

  const handleCompetitionSelect = (competition: CompetitionId) => {
    setSelectedCompetition(competition);
    window.scrollTo({ top: 0, left: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
  };

  return (
    <div className="min-h-screen bg-black">
      <div className="sticky top-0 z-[120] h-[93px] bg-background">
        <Header />
      </div>

      <CompetitionSidebar
        isOpen={isSidebarOpen}
        selectedCompetition={selectedCompetition}
        onOpenChange={setIsSidebarOpen}
        onSelect={handleCompetitionSelect}
      />

      <div
        className={`min-h-[calc(100dvh-93px)] transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isSidebarOpen ? "md:pl-[272px]" : "md:pl-0"
        }`}
      >
        <AnimatePresence mode="wait" initial={false}>
          {selectedCompetition === "fifa-world-cup" ? (
            <motion.div
              key="fifa-world-cup"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.24 }}
            >
              <WorldCupExperience />
            </motion.div>
          ) : (
            <motion.main
              key={selectedCompetition ?? "competition-picker"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
              className="grid min-h-[calc(100dvh-93px)] place-items-center bg-black px-6 text-center text-white"
            >
              <div>
                {selectedCompetitionName && (
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-white/40">
                    {selectedCompetitionName}
                  </p>
                )}
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {selectedCompetition ? "Coming soon..." : "Choose a competition"}
                </h1>
              </div>
            </motion.main>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
