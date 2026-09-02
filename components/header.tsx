"use client";

import Image from "next/image";
import { Moon, Sun } from "lucide-react";
import { LanguageSelector } from "./language-selector";
import { useAppTheme } from "./theme-provider";
import { Button } from "@/components/ui/button";

export function Header() {
  const { theme, setTheme } = useAppTheme();
  const activeTheme = theme === "light" ? "light" : "dark";
  const nextTheme = activeTheme === "dark" ? "light" : "dark";

  return (
    <header className="relative z-10 h-full overflow-hidden border-b border-border/30 bg-card/75 backdrop-blur-2xl shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-wc-blue/20 via-wc-green/25 to-wc-red/20" />
      <div className="container mx-auto h-full px-4 py-4">
        <div className="flex h-full items-center justify-between gap-3">
          <div className="flex items-center">
            <h1>
              <Image
                src="/flick90.svg"
                alt="flick90"
                width={633}
                height={68}
                priority
                className="h-auto w-[132px] dark:hidden sm:w-[160px] md:w-[180px]"
              />
              <span className="relative hidden w-[132px] dark:block sm:w-[160px] md:w-[180px]">
                <Image
                  src="/flick90.svg"
                  alt="flick90"
                  width={633}
                  height={68}
                  priority
                  className="h-auto w-full brightness-[2]"
                />
                <Image
                  src="/flick90.svg"
                  alt=""
                  width={633}
                  height={68}
                  aria-hidden="true"
                  className="absolute inset-0 h-auto w-full brightness-0 invert [clip-path:inset(0_84%_0_0)]"
                />
              </span>
            </h1>
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
