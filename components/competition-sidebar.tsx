"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type CompetitionId =
  | "premier-league"
  | "champions-league"
  | "la-liga"
  | "fifa-world-cup"
  | "bundesliga"
  | "ligue-1"
  | "serie-a"
  | "europa-league";

export type Competition = {
  id: CompetitionId;
  name: string;
  category: "International" | "Club";
  logoSrc: string;
  darkLogoSrc?: string;
  logoClassName?: string;
  logoScaleClassName?: string;
};

export const COMPETITIONS: Competition[] = [
  { id: "premier-league", name: "Premier League", category: "Club", logoSrc: "/competition-logos/premier-league.png", logoClassName: "competition-logo--dark-outline", logoScaleClassName: "scale-[1.45]" },
  { id: "champions-league", name: "Champions League", category: "Club", logoSrc: "/competition-logos/champions-league.png", logoClassName: "competition-logo--dark-outline" },
  { id: "la-liga", name: "La Liga", category: "Club", logoSrc: "/competition-logos/la-liga.png" },
  { id: "fifa-world-cup", name: "FIFA World Cup 2026", category: "International", logoSrc: "/competition-logos/fifa-world-cup-light.png", darkLogoSrc: "/competition-logos/fifa-world-cup-dark.png", logoScaleClassName: "scale-[1.65]" },
  { id: "bundesliga", name: "Bundesliga", category: "Club", logoSrc: "/competition-logos/bundesliga.jpg" },
  { id: "ligue-1", name: "Ligue 1", category: "Club", logoSrc: "/competition-logos/ligue-1-transparent.png", logoClassName: "competition-logo--dark-invert" },
  { id: "serie-a", name: "Serie A", category: "Club", logoSrc: "/competition-logos/serie-a-transparent.png" },
  { id: "europa-league", name: "Europa League", category: "Club", logoSrc: "/competition-logos/europa-league.png" },
];

type CompetitionLogoProps = {
  competition: Competition;
  className: string;
};

export function CompetitionLogo({ competition, className }: CompetitionLogoProps) {
  const logoClassName = `${className} object-contain ${competition.logoClassName ?? ""} ${competition.logoScaleClassName ?? ""}`;

  return (
    <>
      <Image
        src={competition.logoSrc}
        alt=""
        width={64}
        height={64}
        className={`${logoClassName} ${competition.darkLogoSrc ? "dark:hidden" : ""}`}
      />
      {competition.darkLogoSrc ? (
        <Image
          src={competition.darkLogoSrc}
          alt=""
          width={64}
          height={64}
          className={`${logoClassName} hidden dark:block`}
        />
      ) : null}
    </>
  );
}

type CompetitionSidebarProps = {
  isOpen: boolean;
  selectedCompetition: CompetitionId | null;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (competition: CompetitionId) => void;
};

export function CompetitionSidebar({
  isOpen,
  selectedCompetition,
  onOpenChange,
  onSelect,
}: CompetitionSidebarProps) {
  const [isPageTop, setIsPageTop] = useState(true);

  useEffect(() => {
    const updatePagePosition = () => setIsPageTop(window.scrollY < 12);

    updatePagePosition();
    window.addEventListener("scroll", updatePagePosition, { passive: true });
    return () => window.removeEventListener("scroll", updatePagePosition);
  }, []);

  const showOpenButton = !isOpen && isPageTop;

  return (
    <>
      <aside
        id="competition-sidebar"
        aria-label="Football competitions"
        aria-hidden={!isOpen}
        className={`fixed bottom-0 left-0 top-[93px] z-[110] w-[272px] border-r border-t border-border/60 bg-background text-foreground shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col overflow-y-auto px-3 pb-5 pt-4">
          <div className="mb-5 flex min-h-10 items-center justify-between gap-3 pl-3">
            <h2 className="text-sm font-bold uppercase tracking-[0.16em]">Competitions</h2>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Hide competitions"
              aria-controls="competition-sidebar"
              aria-expanded={isOpen}
              tabIndex={isOpen ? 0 : -1}
              className="grid h-9 w-9 place-items-center rounded-xl border border-border/60 bg-muted/50 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
            </button>
          </div>

          <nav aria-label="Select a competition" className="space-y-1">
            {COMPETITIONS.map((competition) => {
              const isActive = selectedCompetition === competition.id;

              return (
                <button
                  key={competition.id}
                  type="button"
                  onClick={() => onSelect(competition.id)}
                  aria-current={isActive ? "page" : undefined}
                  tabIndex={isOpen ? 0 : -1}
                  className={`group flex min-h-12 w-full items-center gap-4 rounded-xl px-3 text-left text-[16px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isActive ? "bg-muted text-foreground" : "text-foreground/90 hover:bg-muted/70 hover:text-foreground"
                  }`}
                >
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center transition-transform group-hover:scale-105"
                    aria-hidden="true"
                  >
                    <CompetitionLogo competition={competition} className="h-[19px] w-[19px]" />
                  </span>
                  <span>{competition.name}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="Show competitions"
        aria-controls="competition-sidebar"
        aria-expanded={isOpen}
        tabIndex={showOpenButton ? 0 : -1}
        className={`fixed left-0 top-[93px] z-[109] flex h-9 items-center gap-0.5 rounded-r-lg border border-l-0 border-border/60 bg-background px-2 text-xs font-semibold text-foreground shadow-xl transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          showOpenButton
            ? "translate-x-0 opacity-100"
            : "pointer-events-none -translate-x-4 opacity-0"
        }`}
      >
        <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
        <span className="hidden sm:inline">Competitions</span>
      </button>
    </>
  );
}
