import { useLocation, Link } from "wouter";
import { Home, LayoutGrid, Plus, Activity, UserRound } from "lucide-react";
import { useLive } from "@/lib/live";
import { cn } from "@/lib/utils";
import { native } from "@/lib/api";

export const haptic = () => { try { native()?.haptic?.().catch?.(() => {}); } catch {} try { navigator.vibrate?.(8); } catch {} };

/** Ask the home composer to open (from the tab bar, widgets or deep links). */
export function requestCreate(nav: (to: string) => void, prompt?: string) {
  try { if (prompt) sessionStorage.setItem("stak_prefill", prompt); sessionStorage.setItem("stak_focus", "1"); } catch {}
  nav("/");
  setTimeout(() => window.dispatchEvent(new CustomEvent("stak:create", { detail: prompt || "" })), 30);
}

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/projects", label: "Projects", icon: LayoutGrid },
  { href: "#create", label: "Create", icon: Plus },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/me", label: "You", icon: UserRound },
] as const;

/** Native-style bottom tab bar (phones + Android app). Hidden on md+ where the top bar takes over. */
export function TabBar() {
  const [loc, nav] = useLocation();
  const { summary } = useLive();
  const building = summary?.stats.building || 0;
  const asks = summary?.stats.needsAnswers || 0;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/65 md:hidden" aria-label="Main">
      <div className="mx-auto grid h-[64px] max-w-md grid-cols-5 items-center px-2">
        {TABS.map((t) => {
          if (t.href === "#create")
            return (
              <button key={t.href} onClick={() => { haptic(); requestCreate(nav); }} className="press mx-auto grid h-12 w-12 place-items-center rounded-2xl text-white bg-brand glow-brand" aria-label="Create a new app" data-testid="tab-create">
                <Plus className="h-6 w-6" strokeWidth={2.4} />
              </button>
            );
          const on = t.href === "/" ? loc === "/" : loc.startsWith(t.href);
          const badge = t.href === "/activity" ? building + asks : 0;
          return (
            <Link key={t.href} href={t.href} onClick={haptic} className={cn("press relative flex h-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors", on ? "text-foreground" : "text-muted-foreground")} data-testid={`tab-${t.label.toLowerCase()}`} aria-current={on ? "page" : undefined}>
              <span className={cn("grid h-8 w-12 place-items-center rounded-full transition-colors", on && "bg-primary/15 text-primary")}>
                <t.icon className="h-[21px] w-[21px]" strokeWidth={on ? 2.3 : 1.9} />
              </span>
              {t.label}
              {badge > 0 && <span className="absolute right-[18%] top-2 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">{badge}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Large-title header used by the mobile-first pages. */
export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

const HUES = [16, 340, 262, 199, 152, 38, 222, 288];
export function tintOf(id: string) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; }
export function Tile({ id, icon: I, className }: { id: string; icon: any; className?: string }) {
  const h = tintOf(id);
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-xl text-white shadow-[inset_0_1px_0_hsl(0_0%_100%/.25)]", className)} style={{ background: `linear-gradient(135deg, hsl(${h} 90% 62%), hsl(${(h + 32) % 360} 85% 48%))` }}>
      <I className="h-[45%] w-[45%]" strokeWidth={2.2} />
    </span>
  );
}
