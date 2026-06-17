"use client";

import { useState, useMemo } from "react";
import { useEffect } from "react";
import type { Match } from "@/lib/match-fixtures";
import type { Nation } from "@/lib/world-cup-data";
import { matchFixtures as fallbackMatchFixtures } from "@/lib/match-fixtures";
import { nations as fallbackNations } from "@/lib/world-cup-data";
import { normalizeCountryName } from "@/lib/country-utils";
import { getTeamDisplayName } from "@/lib/team-display";
import { getMatchFixtures, getNations } from "@/lib/supabase/data";
import { useLanguage } from "./language-provider";
import { useTheme } from "next-themes";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LiveMatchCard } from "@/components/live-match";
import { NationFlag } from "./nation-flag";
import { Search, Calendar, MapPin, Clock } from "lucide-react";
import { motion } from "framer-motion";

interface MatchFixturesProps {
  initialSearch?: string;
  initialSelectedStage?: string;
  onViewChange?: (view: { search: string; selectedStage: string }) => void;
}

export function MatchFixtures({
  initialSearch = "",
  initialSelectedStage = "ALL",
  onViewChange,
}: MatchFixturesProps) {
  const { t, language } = useLanguage();
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState(initialSearch);
  const [selectedStage, setSelectedStage] = useState<string>(initialSelectedStage);
  const [matchFixtures, setMatchFixtures] = useState<Match[]>(fallbackMatchFixtures);
  const [nations, setNations] = useState<Nation[]>(fallbackNations);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let isMounted = true;

    Promise.allSettled([getMatchFixtures(), getNations()])
      .then(([matchesResult, nationsResult]) => {
        if (!isMounted) return;

        if (matchesResult.status === "fulfilled" && matchesResult.value.length > 0) {
          setMatchFixtures(matchesResult.value);
        }

        if (nationsResult.status === "fulfilled" && nationsResult.value.length > 0) {
          setNations(nationsResult.value);
        }

        if (matchesResult.status === "rejected" || nationsResult.status === "rejected") {
          console.warn("Using local World Cup data because Supabase data could not be loaded.", {
            matchFixtures: matchesResult.status === "rejected" ? matchesResult.reason : "loaded",
            nations: nationsResult.status === "rejected" ? nationsResult.reason : "loaded",
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    onViewChange?.({ search, selectedStage });
  }, [onViewChange, search, selectedStage]);

  const stages = useMemo(() => {
    const uniqueStages = Array.from(new Set(matchFixtures.map((m) => m.stage)));
    return ["ALL", ...uniqueStages];
  }, [matchFixtures]);

  const filteredMatches = useMemo(() => {
    let matches = matchFixtures;

    if (selectedStage !== "ALL") {
      matches = matches.filter((m) => m.stage === selectedStage);
    }

    if (search.trim()) {
      const query = search.toLowerCase();
      matches = matches.filter(
        (m) =>
          m.homeTeam.toLowerCase().includes(query) ||
          m.awayTeam.toLowerCase().includes(query) ||
          m.stadium.toLowerCase().includes(query) ||
          m.date.toLowerCase().includes(query)
      );
    }

    return matches;
  }, [matchFixtures, search, selectedStage]);

  const matchesByStage = useMemo(() => {
    const grouped: Record<string, Match[]> = {};
    filteredMatches.forEach((match) => {
      if (!grouped[match.stage]) {
        grouped[match.stage] = [];
      }
      grouped[match.stage].push(match);
    });
    return grouped;
  }, [filteredMatches]);

  const getGroupStageMatchdays = (matches: Match[]) => {
    const matchday1 = matches.slice(0, 24);
    const matchday2 = matches.slice(24, 48);
    const matchday3 = matches.slice(48, 72);
    return [
      { name: "Matchday 1", matches: matchday1 },
      { name: "Matchday 2", matches: matchday2 },
      { name: "Matchday 3", matches: matchday3 },
    ];
  };

  const getNationId = (teamName: string): string | null => {
    if (teamName === "TBD") return null;
    const normalized = normalizeCountryName(teamName);
    const nation = nations.find((n) => n.id === normalized);
    return nation ? nation.id : null;
  };

  const getNationFlag = (teamName: string): string => {
    if (teamName === "TBD") return "❓";
    const nationId = getNationId(teamName);
    if (nationId) {
      const nation = nations.find((n) => n.id === nationId);
      return nation ? nation.flag : "🏳️";
    }
    return "🏳️";
  };

  const getNationColor = (teamName: string): string => {
    if (teamName === "TBD") return "#666";
    const nationId = getNationId(teamName);
    if (nationId) {
      const nation = nations.find((n) => n.id === nationId);
      return nation ? nation.jerseyColors.primary : "#666";
    }
    return "#666";
  };

  const getTranslatedTeamName = (teamName: string): string => {
    if (teamName === "TBD") return "TBD";
    const normalized = normalizeCountryName(teamName);
    if (language === "en" && normalized === "bosnia-herzegovina") return "Bosnia";
    if (language === "bn" && normalized === "bosnia-herzegovina") return "বসনিয়া";
    const translationKey = normalized.replace(/-/g, "");
    const translated = t(translationKey);
    if (translated !== translationKey) return translated;
    return getTeamDisplayName(teamName);
  };

  const getTranslatedStage = (stage: string): string => {
    const stageMap: Record<string, string> = {
      ALL: t("all"),
      "GROUP STAGE": t("groupStage"),
      "ROUND OF 32": t("roundOf32"),
      "ROUND OF 16": t("roundOf16"),
      "QUARTER-FINALS": t("quarterFinals"),
      "SEMI-FINALS": t("semiFinals"),
      "BRONZE FINAL": t("bronzeFinal"),
      "FINAL": t("final"),
    };
    return stageMap[stage] || stage;
  };

  const getMatchCountText = (count: number): string => {
    const value = language === "bn" ? convertToBanglaNumerals(String(count)) : String(count);
    return `${value} ${t("matches")}`;
  };

  const convertToBanglaNumerals = (str: string): string => {
    const banglaNumerals: Record<string, string> = {
      '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
      '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯'
    };
    return str.replace(/\d/g, (digit) => banglaNumerals[digit] || digit);
  };

  const getTranslatedDate = (date: string): string => {
    if (language === "en") return date;
    
    // Parse date like "Friday, 12 June 2026"
    const parts = date.split(", ");
    if (parts.length < 2) return date;
    
    const dayName = parts[0].toLowerCase();
    const datePart = parts[1];
    const dateParts = datePart.split(" ");
    
    if (dateParts.length < 3) return date;
    
    const day = convertToBanglaNumerals(dateParts[0]);
    const month = dateParts[1].toLowerCase();
    const year = convertToBanglaNumerals(dateParts[2]);
    
    const translatedDay = t(dayName) || dayName;
    const translatedMonth = t(month) || month;
    
    return `${translatedDay}, ${day} ${translatedMonth} ${year}`;
  };

  const getTranslatedTime = (time: string): string => {
    if (language === "en") return time;
    
    // Parse time like "1:00 AM" or "11:30 PM"
    const parts = time.split(" ");
    if (parts.length < 2) return time;
    
    const timePart = parts[0];
    const period = parts[1].toLowerCase();
    
    const translatedTime = convertToBanglaNumerals(timePart);
    const translatedPeriod = t(period) || period;
    
    return `${translatedTime} ${translatedPeriod}`;
  };

  const getTranslatedStadium = (stadium: string): string => {
    if (language === "en") return stadium;

    const stadiumMap: Record<string, string> = {
      "Atlanta Stadium": "আটলান্টা স্টেডিয়াম",
      "BC Place Vancouver": "বিসি প্লেস ভ্যাঙ্কুভার",
      "Boston Stadium": "বস্টন স্টেডিয়াম",
      "Dallas Stadium": "ডালাস স্টেডিয়াম",
      "Estadio Guadalajara": "এস্তাদিও গুয়াদালাহারা",
      "Estadio Monterrey": "এস্তাদিও মন্টেরে",
      "Houston Stadium": "হিউস্টন স্টেডিয়াম",
      "Kansas City Stadium": "কানসাস সিটি স্টেডিয়াম",
      "Los Angeles Stadium": "লস অ্যাঞ্জেলেস স্টেডিয়াম",
      "Mexico City Stadium": "মেক্সিকো সিটি স্টেডিয়াম",
      "Miami Stadium": "মায়ামি স্টেডিয়াম",
      "New York New Jersey Stadium": "নিউ ইয়র্ক নিউ জার্সি স্টেডিয়াম",
      "Philadelphia Stadium": "ফিলাডেলফিয়া স্টেডিয়াম",
      "San Francisco Bay Area Stadium": "সান ফ্রান্সিসকো বে এরিয়া স্টেডিয়াম",
      "Seattle Stadium": "সিয়াটল স্টেডিয়াম",
      "Toronto Stadium": "টরন্টো স্টেডিয়াম",
    };

    if (stadiumMap[stadium]) return stadiumMap[stadium];
    
    // Convert stadium name to translation key (lowercase, no spaces, no special chars)
    const translationKey = stadium
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .replace(/\s+/g, "");
    
    const translated = t(translationKey);
    return translated === translationKey ? stadium : translated;
  };

  const getTranslatedGroup = (group: string): string => {
    if (language === "en") return group;
    
    // Translate group names like "Group A" to "গ্রুপ এ"
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
    return groupMap[group] || group;
  };

  const getCardBackgroundColor = () => {
    const activeTheme = mounted ? theme : "dark";
    return activeTheme === "dark" ? "rgba(30, 30, 35, 0.6)" : "rgba(255, 255, 255, 0.7)";
  };

  const getCardBorderColor = () => {
    const activeTheme = mounted ? theme : "dark";
    return activeTheme === "dark" ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.1)";
  };

  const getTextShadowColor = () => {
    const activeTheme = mounted ? theme : "dark";
    return activeTheme === "dark" ? "rgba(0, 0, 0, 0.8)" : "rgba(255, 255, 255, 0.9)";
  };

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Search and Stage Filter */}
      <div className="mb-4 space-y-3">
        <div className="relative max-w-md mx-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchMatches")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-card/80 backdrop-blur-sm border-border/50"
          />
        </div>

        {/* Stage Filter */}
        <div className="flex flex-wrap gap-2 justify-center">
          {stages.map((stage) => (
            <button
              key={stage}
              onClick={() => setSelectedStage(stage)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                selectedStage === stage
                  ? "bg-primary text-primary-foreground"
                  : "bg-card/80 text-muted-foreground hover:bg-card"
              }`}
            >
              {getTranslatedStage(stage)}
            </button>
          ))}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          {t("clickNationToViewSquad")}
        </p>
      </div>

      {/* Matches by Stage */}
      <div className="space-y-6">
        {Object.entries(matchesByStage).map(([stage, matches], stageIndex) => {
          const isGroupStage = stage === "GROUP STAGE";
          
          if (isGroupStage) {
            const matchdays = getGroupStageMatchdays(matches);
            
            return (
              <motion.div
                key={stage}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: stageIndex * 0.02, duration: 0.3 }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">
                    {getTranslatedStage("GROUP STAGE")}
                  </h3>
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-xs text-muted-foreground">
                    {getMatchCountText(matches.length)}
                  </span>
                </div>

                {matchdays.map((matchday, mdIndex) => (
                  <div key={matchday.name} className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <h4 className="text-xs font-semibold text-muted-foreground">
                        {t("matchday")} {mdIndex + 1}
                      </h4>
                      <div className="flex-1 h-px bg-border/30" />
                      <span className="text-[10px] text-muted-foreground">
                        {getMatchCountText(matchday.matches.length)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {matchday.matches.map((match: Match, matchIndex: number) => {
                        const homeNationId = getNationId(match.homeTeam);
                        const awayNationId = getNationId(match.awayTeam);
                        const homeColor = getNationColor(match.homeTeam);
                        const awayColor = getNationColor(match.awayTeam);

                        return (
                          <motion.div
                            key={match.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: stageIndex * 0.02 + mdIndex * 0.01 + matchIndex * 0.005, duration: 0.2 }}
                          >
                            <LiveMatchCard match={match}>
                              <Card 
                                className="group relative overflow-hidden rounded-2xl backdrop-blur-xl transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
                                style={{
                                  backgroundColor: getCardBackgroundColor(),
                                  borderColor: getCardBorderColor()
                                }}
                              >
                              <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.08),transparent_15%),radial-gradient(circle_at_bottom_right,_rgba(0,0,0,0.03),transparent_20%)]" />
                              
                              <div className="relative flex min-h-[126px] flex-col justify-between p-3">
                                {/* Group name at top right for Group Stage */}
                                <div className="absolute top-2 right-2">
                                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                    {getTranslatedGroup(match.group || "")}
                                  </span>
                                </div>

                                {/* Date and Time for Group Stage */}
                                <div className="flex items-center justify-center pt-4">
                                  <span className="text-[10px] text-muted-foreground">
                                    {getTranslatedDate(match.date)} • {getTranslatedTime(match.time)}
                                  </span>
                                </div>

                                {/* Teams - Horizontal Layout */}
                                <div className="flex items-center justify-between gap-2 py-3">
                                  {/* Home Team */}
                                  <div className="min-w-0 flex-1">
                                    {homeNationId ? (
                                      <button
                                        onClick={() => {
                                          window.dispatchEvent(
                                            new CustomEvent("nationSelected", {
                                              detail: { nationId: homeNationId, returnTab: "fixtures", returnScrollY: window.scrollY },
                                            })
                                          );
                                        }}
                                        className="flex w-full min-w-0 items-center gap-2"
                                        style={{ ['--team-color' as any]: homeColor, ['--shadow-color' as any]: getTextShadowColor() }}
                                      >
                                        <NationFlag
                                          className="h-5 w-7"
                                          emoji={getNationFlag(match.homeTeam)}
                                          fallbackClassName="text-xl"
                                          label={match.homeTeam}
                                          nationId={homeNationId}
                                        />
                                        <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                                          <span className="block truncate hover:text-[var(--team-color)] transition-colors cursor-pointer hover:drop-shadow-[0_0_2px_var(--shadow-color)]">
                                            {getTranslatedTeamName(match.homeTeam)}
                                          </span>
                                        </span>
                                      </button>
                                    ) : (
                                      <div className="flex min-w-0 items-center gap-2">
                                        <NationFlag
                                          className="h-5 w-7"
                                          emoji={getNationFlag(match.homeTeam)}
                                          fallbackClassName="text-xl"
                                          label={match.homeTeam}
                                          nationId={homeNationId}
                                        />
                                        <span className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
                                          {getTranslatedTeamName(match.homeTeam)}
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {/* VS */}
                                  <div className="text-muted-foreground font-bold text-xs px-1">
                                    {t("vs")}
                                  </div>

                                  {/* Away Team */}
                                  <div className="min-w-0 flex-1">
                                    {awayNationId ? (
                                      <button
                                        onClick={() => {
                                          window.dispatchEvent(
                                            new CustomEvent("nationSelected", {
                                              detail: { nationId: awayNationId, returnTab: "fixtures", returnScrollY: window.scrollY },
                                            })
                                          );
                                        }}
                                        className="flex w-full min-w-0 items-center justify-end gap-2"
                                        style={{ ['--team-color' as any]: awayColor, ['--shadow-color' as any]: getTextShadowColor() }}
                                      >
                                        <span className="min-w-0 truncate text-right text-xs font-semibold text-foreground">
                                          <span className="block truncate hover:text-[var(--team-color)] transition-colors cursor-pointer hover:drop-shadow-[0_0_2px_var(--shadow-color)]">
                                            {getTranslatedTeamName(match.awayTeam)}
                                          </span>
                                        </span>
                                        <NationFlag
                                          className="h-5 w-7"
                                          emoji={getNationFlag(match.awayTeam)}
                                          fallbackClassName="text-xl"
                                          label={match.awayTeam}
                                          nationId={awayNationId}
                                        />
                                      </button>
                                    ) : (
                                      <div className="flex min-w-0 items-center justify-end gap-2">
                                        <span className="min-w-0 truncate text-right text-xs font-semibold text-muted-foreground">
                                          {getTranslatedTeamName(match.awayTeam)}
                                        </span>
                                        <NationFlag
                                          className="h-5 w-7"
                                          emoji={getNationFlag(match.awayTeam)}
                                          fallbackClassName="text-xl"
                                          label={match.awayTeam}
                                          nationId={awayNationId}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Stadium */}
                                <div className="flex items-center gap-1 border-t border-border/20 pt-2 text-xs text-muted-foreground">
                                  <MapPin className="h-3 w-3" />
                                  <span className="truncate">{getTranslatedStadium(match.stadium)}</span>
                                </div>
                              </div>
                              </Card>
                            </LiveMatchCard>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </motion.div>
            );
          }
          
          return (
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: stageIndex * 0.02, duration: 0.3 }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  {getTranslatedStage(stage)}
                </h3>
                <div className="flex-1 h-px bg-border/50" />
                {matches.length > 1 && (
                  <span className="text-xs text-muted-foreground">
                    {getMatchCountText(matches.length)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {matches.map((match: Match, matchIndex: number) => {
                  const homeNationId = getNationId(match.homeTeam);
                  const awayNationId = getNationId(match.awayTeam);
                  const homeColor = getNationColor(match.homeTeam);
                  const awayColor = getNationColor(match.awayTeam);

                  return (
                    <motion.div
                      key={match.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: stageIndex * 0.02 + matchIndex * 0.01, duration: 0.2 }}
                    >
                      <LiveMatchCard match={match}>
                        <Card 
                          className="group relative overflow-hidden rounded-2xl backdrop-blur-xl transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
                          style={{
                            backgroundColor: getCardBackgroundColor(),
                            borderColor: getCardBorderColor()
                          }}
                        >
                        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.08),transparent_15%),radial-gradient(circle_at_bottom_right,_rgba(0,0,0,0.03),transparent_20%)]" />
                        
                        <div className="relative flex min-h-[126px] flex-col justify-between p-3">
                          {/* Header: Time and Info */}
                          <div className="flex items-center justify-between border-b border-border/20 pb-2">
                            <span className="text-xs font-semibold text-muted-foreground">{getTranslatedTime(match.time)}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                              {getTranslatedDate(match.date)}
                            </span>
                          </div>

                          {/* Teams - Horizontal Layout */}
                          <div className="flex items-center justify-between gap-2 py-3">
                            {/* Home Team */}
                            <div className="min-w-0 flex-1">
                              {homeNationId ? (
                                <button
                                  onClick={() => {
                                    window.dispatchEvent(
                                      new CustomEvent("nationSelected", {
                                        detail: { nationId: homeNationId, returnTab: "fixtures", returnScrollY: window.scrollY },
                                      })
                                    );
                                  }}
                                  className="flex w-full min-w-0 items-center gap-2"
                                  style={{ ['--team-color' as any]: homeColor, ['--shadow-color' as any]: getTextShadowColor() }}
                                >
                                  <NationFlag
                                    className="h-5 w-7"
                                    emoji={getNationFlag(match.homeTeam)}
                                    fallbackClassName="text-xl"
                                    label={match.homeTeam}
                                    nationId={homeNationId}
                                  />
                                  <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                                    <span className="block truncate hover:text-[var(--team-color)] transition-colors cursor-pointer hover:drop-shadow-[0_0_2px_var(--shadow-color)]">
                                      {getTranslatedTeamName(match.homeTeam)}
                                    </span>
                                  </span>
                                </button>
                              ) : (
                                <div className="flex min-w-0 items-center gap-2">
                                  <NationFlag
                                    className="h-5 w-7"
                                    emoji={getNationFlag(match.homeTeam)}
                                    fallbackClassName="text-xl"
                                    label={match.homeTeam}
                                    nationId={homeNationId}
                                  />
                                  <span className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
                                    {getTranslatedTeamName(match.homeTeam)}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* VS */}
                            <div className="text-muted-foreground font-bold text-xs px-1">
                              {t("vs")}
                            </div>

                            {/* Away Team */}
                            <div className="min-w-0 flex-1">
                              {awayNationId ? (
                                <button
                                  onClick={() => {
                                    window.dispatchEvent(
                                      new CustomEvent("nationSelected", {
                                        detail: { nationId: awayNationId, returnTab: "fixtures", returnScrollY: window.scrollY },
                                      })
                                    );
                                  }}
                                  className="flex w-full min-w-0 items-center justify-end gap-2"
                                  style={{ ['--team-color' as any]: awayColor, ['--shadow-color' as any]: getTextShadowColor() }}
                                >
                                  <span className="min-w-0 truncate text-right text-xs font-semibold text-foreground">
                                    <span className="block truncate hover:text-[var(--team-color)] transition-colors cursor-pointer hover:drop-shadow-[0_0_2px_var(--shadow-color)]">
                                      {getTranslatedTeamName(match.awayTeam)}
                                    </span>
                                  </span>
                                  <NationFlag
                                    className="h-5 w-7"
                                    emoji={getNationFlag(match.awayTeam)}
                                    fallbackClassName="text-xl"
                                    label={match.awayTeam}
                                    nationId={awayNationId}
                                  />
                                </button>
                              ) : (
                                <div className="flex min-w-0 items-center justify-end gap-2">
                                  <span className="min-w-0 truncate text-right text-xs font-semibold text-muted-foreground">
                                    {getTranslatedTeamName(match.awayTeam)}
                                  </span>
                                  <NationFlag
                                    className="h-5 w-7"
                                    emoji={getNationFlag(match.awayTeam)}
                                    fallbackClassName="text-xl"
                                    label={match.awayTeam}
                                    nationId={awayNationId}
                                  />
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Stadium */}
                          <div className="flex items-center gap-1 border-t border-border/20 pt-2 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">{getTranslatedStadium(match.stadium)}</span>
                          </div>
                        </div>
                        </Card>
                      </LiveMatchCard>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>

      {filteredMatches.length === 0 && (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No matches found</p>
        </div>
      )}
    </div>
  );
}
