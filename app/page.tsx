"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Header } from "@/components/header";
import { NationsGrid } from "@/components/nations-grid";
import { TriondaBackground } from "@/components/trionda-background";
import { MatchFixtures } from "@/components/match-fixtures";
import { GroupStandingsTable } from "@/components/group-standings-table";
import { TournamentStats } from "@/components/tournament-stats";
import { ClubCompetitionContent } from "@/components/club-competition-content";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/components/language-provider";
import {
  COMPETITIONS,
  CompetitionLogo,
  CompetitionSidebar,
  type Competition,
  type CompetitionId,
} from "@/components/competition-sidebar";
import { Instagram, Mail } from "lucide-react";
import type { ClubCompetitionId } from "@/lib/fotmob-competition-types";

const MAIN_TABS = ["squads", "fixtures", "table", "stats"] as const;
const MAIN_TAB_TRIGGER_CLASS =
  "relative h-12 flex-none rounded-none border-0 bg-transparent px-1 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-center after:scale-x-0 after:bg-emerald-400 after:transition-transform data-[state=active]:bg-transparent data-[state=active]:after:scale-x-100 dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent sm:px-2";

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

type CompetitionExperienceProps = {
  competition: Competition;
};

function CompetitionExperience({ competition }: CompetitionExperienceProps) {
  const { t } = useLanguage();
  const hasData = competition.id === "fifa-world-cup";
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
        <div ref={tabsStartRef} />
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full gap-0">
          <section className="relative overflow-hidden border-b border-border/40 bg-card/55 backdrop-blur-xl">
            <div
              aria-hidden="true"
              className="absolute -left-24 -top-52 h-80 w-[30rem] rounded-full bg-gradient-to-r from-emerald-500/25 via-amber-500/20 to-red-500/30 blur-2xl"
            />
            <div
              aria-hidden="true"
              className="absolute inset-y-0 right-0 w-2/3 bg-gradient-to-l from-blue-950/35 to-transparent dark:from-blue-950/45"
            />
            <div className="container relative mx-auto px-4 pt-5 sm:pt-6">
              <div className="flex items-center gap-3 pb-6 sm:gap-4 sm:pb-7">
                <span
                  aria-hidden="true"
                  className="grid h-12 w-12 shrink-0 place-items-center sm:h-14 sm:w-14"
                >
                  <CompetitionLogo competition={competition} className="h-7 w-7 sm:h-8 sm:w-8" />
                </span>
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                    {competition.name}
                  </h1>
                  <p className="mt-0.5 text-sm font-medium text-muted-foreground sm:text-base">
                    {competition.category}
                  </p>
                </div>
              </div>
              <TabsList
                aria-label={`${competition.name} sections`}
                className={`transition-all duration-200 ${
                  mountFloatingFixturesChrome
                    ? `fixed left-1/2 top-[105px] z-[90] h-12 w-fit border border-border/50 bg-background/95 p-[3px] shadow-2xl backdrop-blur-xl ${
                        showFloatingFixturesChrome
                          ? "-translate-x-1/2 translate-y-0 opacity-100"
                          : "-translate-x-1/2 -translate-y-24 opacity-0"
                      }`
                    : "h-12 w-full justify-start gap-6 rounded-none bg-transparent p-0 sm:gap-10"
                }`}
              >
                <TabsTrigger
                  className={MAIN_TAB_TRIGGER_CLASS}
                  id="main-tab-squads"
                  aria-controls="main-tabpanel-squads"
                  value="squads"
                >
                  {t("groups")}
                </TabsTrigger>
                <TabsTrigger
                  className={MAIN_TAB_TRIGGER_CLASS}
                  id="main-tab-fixtures"
                  aria-controls="main-tabpanel-fixtures"
                  value="fixtures"
                >
                  {t("fixtures")}
                </TabsTrigger>
                <TabsTrigger
                  className={MAIN_TAB_TRIGGER_CLASS}
                  id="main-tab-table"
                  aria-controls="main-tabpanel-table"
                  value="table"
                >
                  {t("table")}
                </TabsTrigger>
                <TabsTrigger
                  className={MAIN_TAB_TRIGGER_CLASS}
                  id="main-tab-stats"
                  aria-controls="main-tabpanel-stats"
                  value="stats"
                >
                  {t("stats")}
                </TabsTrigger>
              </TabsList>
            </div>
          </section>
          <div className="container mx-auto px-4 py-6">
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
                  {hasData && activeTab === "squads" && (
                    <NationsGrid
                      initialSelectedNationId={selectedNationId}
                      initialSelectedPlayerName={selectedPlayerName}
                      onNationBack={handleNationBack}
                    />
                  )}
                  {hasData && activeTab === "fixtures" && (
                    <MatchFixtures
                      initialSearch={fixturesView.search}
                      initialSelectedStage={fixturesView.selectedStage}
                      targetMatchId={targetFixtureId}
                      onViewChange={setFixturesView}
                      mountFloatingControls={mountFloatingFixturesChrome}
                      showFloatingControls={showFloatingFixturesChrome}
                    />
                  )}
                  {hasData && activeTab === "table" && <GroupStandingsTable />}
                  {hasData && activeTab === "stats" && <TournamentStats />}
                  {!hasData && (
                    <ClubCompetitionContent
                      competitionId={competition.id as ClubCompetitionId}
                      activeTab={activeTab}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </Tabs>
        <footer className="border-t border-border/30 bg-card/60 backdrop-blur-xl">
          <div className="container mx-auto flex flex-col gap-6 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-3xl text-xs leading-relaxed sm:text-sm">
              <strong className="font-semibold text-foreground">Legal Disclaimer:</strong>{" "}
              FLICK90 is an independent, unofficial fan platform dedicated to football. This website is not
              affiliated with, associated with, endorsed by, or in any way officially connected to any official
              football governing bodies, leagues, or individual clubs. All registered trademarks, logos, and
              competition names displayed on this site are the sole property of their respective intellectual
              property holders.
            </p>
            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
              <a
                className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
                href="mailto:md.aaban080511@gmail.com"
              >
                <Mail className="h-4 w-4" />
                md.aaban080511@gmail.com
              </a>
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
  const selectedCompetitionDetails = COMPETITIONS.find(
    (competition) => competition.id === selectedCompetition,
  ) ?? null;

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
          isSidebarOpen ? "pt-0 md:pl-[272px]" : "pt-9 md:pl-0"
        }`}
      >
        <AnimatePresence mode="wait" initial={false}>
          {selectedCompetitionDetails ? (
            <motion.div
              key={selectedCompetitionDetails.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.24 }}
            >
              <CompetitionExperience competition={selectedCompetitionDetails} />
            </motion.div>
          ) : (
            <motion.main
              key="competition-picker"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
              className="grid min-h-[calc(100dvh-93px)] place-items-center bg-black px-6 text-center text-white"
            >
              <div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Select a competition
                </h1>
              </div>
            </motion.main>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
