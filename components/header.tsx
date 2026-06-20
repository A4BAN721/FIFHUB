"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useLanguage } from "./language-provider";
import { LanguageSelector } from "./language-selector";
import { Button } from "@/components/ui/button";

export function Header() {
  const { t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const activeTheme = theme === "light" ? "light" : "dark";
  const nextTheme = activeTheme === "dark" ? "light" : "dark";

  return (
    <header className="relative z-10 overflow-hidden border-b border-border/30 bg-card/75 backdrop-blur-2xl shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-wc-blue/20 via-wc-green/25 to-wc-red/20" />
      <div className="container mx-auto px-4 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1 rounded-3xl bg-background/50 p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              <div className="h-3 w-3 rounded-full bg-wc-green" />
              <div className="h-3 w-3 rounded-full bg-wc-blue" />
              <div className="h-3 w-3 rounded-full bg-wc-red" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
                {t("title")}
              </h1>
              <p className="text-xs text-muted-foreground font-medium tracking-widest uppercase">
                {t("subtitle")}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            <Button
              variant="outline"
              size="icon"
              className="border-white/10 bg-background/70 text-foreground"
              onClick={() => setTheme(nextTheme)}
              aria-label="Toggle theme"
            >
              {activeTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <LanguageSelector />
          </div>
        </div>
      </div>
    </header>
  );
}
