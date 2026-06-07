"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "./language-provider";

export function Countdown() {
  const { t } = useLanguage();
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    // Target date: June 11, 2026, 09:00 PM BST (4 hours earlier than original)
    // BST is UTC+6, so we need to convert to UTC
    // June 11, 2026, 09:00 PM BST = June 11, 2026, 03:00 PM UTC
    // Original was June 12, 2026, 01:00 AM UTC
    // 4 hours earlier: June 11, 2026, 09:00 PM UTC
    const targetDate = new Date("2026-06-11T21:00:00Z").getTime();

    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const difference = targetDate - now;

      if (difference > 0) {
        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);

        setTimeLeft({ days, hours, minutes, seconds });
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      }
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-4 md:gap-6">
        <div className="flex flex-col items-center">
          <div className="text-2xl md:text-3xl font-bold text-foreground">
            {timeLeft.days}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("days")}
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-2xl md:text-3xl font-bold text-foreground">
            {timeLeft.hours}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("hours")}
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-2xl md:text-3xl font-bold text-foreground">
            {timeLeft.minutes}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("minutes")}
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-2xl md:text-3xl font-bold text-foreground">
            {timeLeft.seconds}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("seconds")}
          </div>
        </div>
      </div>
      <div className="text-sm text-muted-foreground font-medium">
        {t("untilWorldCup")}
      </div>
    </div>
  );
}
