"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getTranslations } from "@/lib/supabase/data";
import { translations as fallbackTranslations } from "@/lib/world-cup-data";

type Language = "en" | "bn";

const translationOverrides: Record<Language, Record<string, string>> = {
  en: {
    title: "FIFHUB",
    subtitle: "World Cup 2026",
    allNationsSubtitle: "12 Groups, 48 Nations",
    groups: "Nations",
    hostNations: "Host Nations",
    allOtherNations: "Qualified Nations",
    fixtures: "Fixtures",
    table: "Table",
    all: "All",
    players: "Players",
    position: "Position",
    club: "Club",
    height: "Height",
    weight: "Weight",
    strongFoot: "Strong Foot",
    marketValue: "Market Value",
    squadValue: "Squad Value",
    back: "Back",
    searchPlaceholder: "Search nations...",
    goalkeeper: "Goalkeeper",
    defender: "Defender",
    midfielder: "Midfielder",
    forward: "Forward",
    left: "Left",
    right: "Right",
    both: "Both",
    language: "Language",
    hosted: "Hosted by",
    jerseyColors: "Jersey Colors",
    days: "Days",
    hours: "Hours",
    minutes: "Minutes",
    seconds: "Seconds",
    untilWorldCup: "UNTIL WORLD CUP 2026",
    matchFixtures: "Match Fixtures",
    schedule: "FIFA World Cup 2026 Schedule",
    searchMatches: "Search matches, teams, or stadiums...",
    groupStage: "Group Stage",
    roundOf32: "ROUND OF 32",
    roundOf16: "ROUND OF 16",
    quarterFinals: "QUARTER-FINALS",
    semiFinals: "SEMI-FINALS",
    bronzeFinal: "BRONZE FINAL",
    final: "FINAL",
    matchday: "Matchday",
    matches: "Matches",
    vs: "VS",
    clickNationToViewSquad: "Click a nation to view their squad",
    groupTable: "Group Table",
    groupTableDescription: "Wins, draws, losses, goals, goal difference, and points by group",
    nation: "Nation",
    playedShort: "P",
    winsShort: "W",
    drawsShort: "D",
    lossesShort: "L",
    goalsForShort: "GF",
    goalsAgainstShort: "GA",
    goalDifferenceShort: "GD",
    pointsShort: "PTS",
  },
  bn: {
    title: "ফিফহাব ২৬",
    subtitle: "বিশ্বকাপ ২০২৬",
    allNationsSubtitle: "১২টি গ্রুপ, ৪৮টি দেশ",
    groups: "দেশসমূহ",
    hostNations: "আয়োজক দেশ",
    allOtherNations: "অন্যান্য দেশ",
    fixtures: "ফিক্সচার",
    table: "টেবিল",
    all: "সব",
    players: "খেলোয়াড়",
    position: "পজিশন",
    club: "ক্লাব",
    height: "উচ্চতা",
    weight: "ওজন",
    strongFoot: "শক্তিশালী পা",
    marketValue: "বাজার মূল্য",
    squadValue: "স্কোয়াড মূল্য",
    back: "ফিরে যান",
    searchPlaceholder: "দেশ খুঁজুন...",
    goalkeeper: "গোলরক্ষক",
    defender: "ডিফেন্ডার",
    midfielder: "মিডফিল্ডার",
    forward: "ফরোয়ার্ড",
    left: "বাম",
    right: "ডান",
    both: "উভয়",
    language: "ভাষা",
    hosted: "আয়োজক",
    jerseyColors: "জার্সির রং",
    days: "দিন",
    hours: "ঘণ্টা",
    minutes: "মিনিট",
    seconds: "সেকেন্ড",
    untilWorldCup: "বিশ্বকাপ ২০২৬ পর্যন্ত",
    matchFixtures: "ম্যাচ ফিক্সচার",
    schedule: "ফিফা বিশ্বকাপ ২০২৬ সূচি",
    searchMatches: "ম্যাচ, দল বা স্টেডিয়াম খুঁজুন...",
    groupStage: "গ্রুপ পর্ব",
    roundOf32: "৩২ দলের পর্ব",
    roundOf16: "১৬ দলের পর্ব",
    quarterFinals: "কোয়ার্টার-ফাইনাল",
    semiFinals: "সেমি-ফাইনাল",
    bronzeFinal: "ব্রোঞ্জ ফাইনাল",
    final: "ফাইনাল",
    matchday: "ম্যাচডে",
    matches: "ম্যাচ",
    vs: "বনাম",
    clickNationToViewSquad: "স্কোয়াড দেখতে একটি দেশ নির্বাচন করুন",
    groupTable: "গ্রুপ টেবিল",
    groupTableDescription: "জয়, ড্র, হার, গোল, গোল ব্যবধান ও পয়েন্ট",
    nation: "দেশ",
    playedShort: "খে",
    winsShort: "জ",
    drawsShort: "ড্র",
    lossesShort: "হা",
    goalsForShort: "পগ",
    goalsAgainstShort: "বিগ",
    goalDifferenceShort: "ব্যব",
    pointsShort: "পয়েন্ট",
    argentina: "আর্জেন্টিনা",
    australia: "অস্ট্রেলিয়া",
    austria: "অস্ট্রিয়া",
    belgium: "বেলজিয়াম",
    bosniaherzegovina: "বসনিয়া ও হার্জেগোভিনা",
    brazil: "ব্রাজিল",
    capeverde: "কেপ ভার্দে",
    canada: "কানাডা",
    colombia: "কলম্বিয়া",
    croatia: "ক্রোয়েশিয়া",
    curacao: "কুরাসাও",
    czechia: "চেকিয়া",
    drcongo: "ডিআর কঙ্গো",
    ecuador: "ইকুয়েডর",
    egypt: "মিশর",
    england: "ইংল্যান্ড",
    france: "ফ্রান্স",
    germany: "জার্মানি",
    ghana: "ঘানা",
    haiti: "হাইতি",
    iran: "ইরান",
    iraq: "ইরাক",
    ivorycoast: "আইভরি কোস্ট",
    japan: "জাপান",
    jordan: "জর্ডান",
    mexico: "মেক্সিকো",
    morocco: "মরক্কো",
    netherlands: "নেদারল্যান্ডস",
    newzealand: "নিউজিল্যান্ড",
    norway: "নরওয়ে",
    panama: "পানামা",
    paraguay: "প্যারাগুয়ে",
    portugal: "পর্তুগাল",
    qatar: "কাতার",
    saudiarabia: "সৌদি আরব",
    scotland: "স্কটল্যান্ড",
    senegal: "সেনেগাল",
    southafrica: "দক্ষিণ আফ্রিকা",
    southkorea: "দক্ষিণ কোরিয়া",
    spain: "স্পেন",
    sweden: "সুইডেন",
    switzerland: "সুইজারল্যান্ড",
    tunisia: "তিউনিসিয়া",
    turkiye: "তুরস্ক",
    uruguay: "উরুগুয়ে",
    usa: "যুক্তরাষ্ট্র",
    uzbekistan: "উজবেকিস্তান",
    algeria: "আলজেরিয়া",
    friday: "শুক্রবার",
    saturday: "শনিবার",
    sunday: "রবিবার",
    monday: "সোমবার",
    tuesday: "মঙ্গলবার",
    wednesday: "বুধবার",
    thursday: "বৃহস্পতিবার",
    june: "জুন",
    july: "জুলাই",
    am: "এএম",
    pm: "পিএম",
  },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");
  const [translations, setTranslations] = useState(fallbackTranslations);

  useEffect(() => {
    let isMounted = true;

    getTranslations()
      .then((supabaseTranslations) => {
        if (isMounted && Object.keys(supabaseTranslations).length > 0) {
          setTranslations(supabaseTranslations);
        }
      })
      .catch((error) => {
        console.error("Failed to load translations from Supabase:", error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const t = (key: string): string => {
    const override = translationOverrides[language]?.[key];
    if (override) return override;

    return translations[language]?.[key] || translationOverrides.en[key] || translations.en[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}

export const languageNames: Record<Language, string> = {
  en: "English",
  bn: "বাংলা",
};
