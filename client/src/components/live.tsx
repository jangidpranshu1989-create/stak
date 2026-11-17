import { useLocation } from "wouter";
import { Bell, BellRing, BellOff, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLive, PHASE_LABEL } from "@/lib/live";
import { useSession } from "@/lib/session";
import { toast } from "@/hooks/use-toast";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function NotifyButton() {
  const { user } = useSession();
  const { perm, enable } = useLive();
  if (!user || perm === "unsupported") return null;
  const on = perm === "granted";
  const label = on ? "Notifications are on" : perm === "denied" ? "Notifications are blocked in browser settings" : "Turn on build notifications";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} data-testid="button-notify"
          onClick={async () => {
            if (on) return toast({ title: "Notifications are on", description: "You'll hear from Stak when a build finishes or needs answers." });
            const p = await enable();
            if (p === "denied") toast({ title: "Notifications blocked", description: "Allow notifications for this site in your browser settings." });
          }}>
          {on ? <BellRing className="text-primary" /> : perm === "denied" ? <BellOff /> : <Bell />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Floating live tracker — visible on every screen except the project that is building.
export function LiveDock() {
  const { summary } = useLive();
  const [loc, nav] = useLocation();
  if (!summary) return null;
  const here = loc.startsWith("/p/") ? loc.slice(3) : "";
  const jobs = summary.active.filter((j) => j.projectId !== here);
  const asks = summary.pending.filter((p) => p.projectId !== here);
  if (!jobs.length && !asks.length) return null;
  const j = jobs[0];
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[68px] z-40 flex justify-center px-3" aria-live="polite">
      {j ? (
        <button onClick={() => nav(`/p/${j.projectId}`)} data-testid="live-dock"
          className="pointer-events-auto relative flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-full border bg-background/95 py-2 pl-3 pr-4 text-left shadow-lg backdrop-blur transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{j.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{PHASE_LABEL[j.phase] || "Building"} · {Math.round(j.progress * 100)}%{jobs.length > 1 ? ` · +${jobs.length - 1} more` : ""}</span>
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{clock(j.elapsed)}</span>
          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/15"><span className="block h-full bg-primary transition-[width] duration-700" style={{ width: `${Math.max(4, j.progress * 100)}%` }} /></span>
        </button>
      ) : (
        <button onClick={() => nav(`/p/${asks[0].projectId}`)} data-testid="live-dock-questions"
          className="pointer-events-auto flex max-w-sm items-center gap-2 rounded-full border bg-background/95 px-4 py-2 text-sm shadow-lg backdrop-blur hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <MessageCircleQuestion className="h-4 w-4 text-primary" />
          <span className="truncate"><span className="font-medium">{asks[0].title}</span> needs {asks[0].count} answers</span>
        </button>
      )}
    </div>
  );
}
