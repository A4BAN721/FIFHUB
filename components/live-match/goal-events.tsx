import type { MatchEvent } from "@/lib/live-data/types";

type GoalEventsProps = {
  events: MatchEvent[];
};

const goalEventTypes = new Set(["goal", "penalty_goal", "own_goal"]);

export function GoalEvents({ events }: GoalEventsProps) {
  const goals = events
    .filter((event) => goalEventTypes.has(event.eventType))
    .sort((a, b) => a.minute - b.minute || (a.stoppageMinute ?? 0) - (b.stoppageMinute ?? 0));

  if (goals.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
        Goals will appear here as they are confirmed.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-bold uppercase tracking-normal text-muted-foreground">Goals</h4>
      <ul className="space-y-1.5">
        {goals.map((goal) => (
          <li key={goal.id} className="flex gap-2 text-xs leading-snug text-foreground">
            <span aria-hidden="true">⚽</span>
            <span className="min-w-0">
              {formatGoal(goal)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatGoal(goal: MatchEvent) {
  const minute = `${goal.minute}${goal.stoppageMinute ? `+${goal.stoppageMinute}` : ""}'`;

  if (goal.eventType === "own_goal") {
    return `Own Goal - ${goal.playerName ?? "Unknown player"} ${minute}`;
  }

  const scorer = goal.playerName ?? "Unknown scorer";
  const penaltyMarker = goal.eventType === "penalty_goal" ? " (P)" : "";
  const assist = goal.assistPlayerName ? `, assist: ${goal.assistPlayerName}` : "";
  return `${scorer}${penaltyMarker} ${minute}${assist}`;
}
