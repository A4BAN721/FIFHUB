"use client";

import { useEffect, useState, type ComponentType } from "react";
import {
  Badge,
  ChevronLeft,
  ChevronRight,
  CircleDotDashed,
  Crown,
  Flame,
  Shield,
  Sparkles,
  Trophy,
} from "lucide-react";

export type CompetitionId =
  | "premier-league"
  | "champions-league"
  | "la-liga"
  | "fifa-world-cup"
  | "bundesliga"
  | "ligue-1"
  | "serie-a"
  | "europa-league";

type Competition = {
  id: CompetitionId;
  name: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  iconClassName: string;
};

export const COMPETITIONS: Competition[] = [
  { id: "premier-league", name: "Premier League", icon: Crown, iconClassName: "text-violet-300" },
  { id: "champions-league", name: "Champions League", icon: Sparkles, iconClassName: "text-slate-100" },
  { id: "la-liga", name: "La Liga", icon: Flame, iconClassName: "text-rose-500" },
  { id: "fifa-world-cup", name: "FIFA World Cup", icon: Trophy, iconClassName: "text-amber-300" },
  { id: "bundesliga", name: "Bundesliga", icon: Badge, iconClassName: "text-red-500" },
  { id: "ligue-1", name: "Ligue 1", icon: CircleDotDashed, iconClassName: "text-lime-300" },
  { id: "serie-a", name: "Serie A", icon: Shield, iconClassName: "text-sky-400" },
  { id: "europa-league", name: "Europa League", icon: CircleDotDashed, iconClassName: "text-orange-500" },
];

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
        className={`fixed bottom-0 left-0 top-[93px] z-[110] w-[272px] border-r border-t border-white/10 bg-[#171719] text-white shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-white/75 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
            </button>
          </div>

          <nav aria-label="Select a competition" className="space-y-1">
            {COMPETITIONS.map((competition) => {
              const Icon = competition.icon;
              const isActive = selectedCompetition === competition.id;

              return (
                <button
                  key={competition.id}
                  type="button"
                  onClick={() => onSelect(competition.id)}
                  aria-current={isActive ? "page" : undefined}
                  tabIndex={isOpen ? 0 : -1}
                  className={`group flex min-h-12 w-full items-center gap-4 rounded-xl px-3 text-left text-[16px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                    isActive ? "bg-white/10 text-white" : "text-white/90 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-transform group-hover:scale-105 ${
                      isActive ? "bg-white/10" : "bg-white/[0.04]"
                    }`}
                    aria-hidden="true"
                  >
                    <Icon className={`h-[19px] w-[19px] ${competition.iconClassName}`} strokeWidth={2.35} />
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
        className={`fixed left-0 top-[109px] z-[109] flex h-11 items-center gap-1 rounded-r-xl border border-l-0 border-white/10 bg-[#171719] px-3 text-sm font-semibold text-white shadow-xl transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
          showOpenButton
            ? "translate-x-0 opacity-100"
            : "pointer-events-none -translate-x-4 opacity-0"
        }`}
      >
        <ChevronRight className="h-5 w-5" strokeWidth={2.2} />
        <span className="hidden sm:inline">Competitions</span>
      </button>
    </>
  );
}
