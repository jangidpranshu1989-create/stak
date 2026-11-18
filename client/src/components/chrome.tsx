import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Moon, Sun, LogOut, User as UserIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/session";
import { native } from "@/lib/api";
import { cn } from "@/lib/utils";
import { NotifyButton } from "@/components/live";

export function Logo({ className, withWord = true }: { className?: string; withWord?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="bg-brand grid h-7 w-7 shrink-0 place-items-center rounded-[9px] shadow-[inset_0_1px_0_hsl(0_0%_100%/.35)]" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="18" height="18">
          <rect x="5" y="19" width="22" height="6.5" rx="2.2" fill="#fff" opacity=".55" />
          <rect x="8" y="12.5" width="16" height="6.5" rx="2.2" fill="#fff" opacity=".8" />
          <rect x="11" y="6" width="10" height="6.5" rx="2.2" fill="#fff" />
        </svg>
      </span>
      {withWord && <span className="font-display text-[17px] font-bold tracking-tight">Stak</span>}
    </span>
  );
}

// dark-first brand; the user's choice is remembered when storage is available
const savedTheme = (() => { try { return localStorage.getItem("stak_theme") as "light" | "dark" | null; } catch { return null; } })();
let themeState: "light" | "dark" = savedTheme || "dark";
const themeSubs = new Set<(t: "light" | "dark") => void>();
export const getTheme = () => themeState;
export function applyTheme(t: "light" | "dark") {
  themeState = t;
  try { localStorage.setItem("stak_theme", t); } catch {}
  document.documentElement.classList.toggle("dark", t === "dark");
  themeSubs.forEach((f) => f(t));
  syncNativeChrome();
}
// Android app: paint the status/navigation bars to match the current background.
export function syncNativeChrome() {
  const n = native(); if (!n) return;
  requestAnimationFrame(() => {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
    const hex = m ? "#" + m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("") : undefined;
    n.setChrome({ dark: document.documentElement.classList.contains("dark"), color: hex }).catch(() => {});
  });
}
export function useTheme() {
  const [t, setT] = useState(themeState);
  useEffect(() => { themeSubs.add(setT); return () => { themeSubs.delete(setT); }; }, []);
  return [t, () => applyTheme(t === "dark" ? "light" : "dark")] as const;
}

export function ThemeToggle() {
  const [t, toggle] = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={t === "dark" ? "Switch to light theme" : "Switch to dark theme"} data-testid="button-theme">
      {t === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

export function AccountButton() {
  const { user, setAuthOpen, signOut } = useSession();
  if (!user || user.guest)
    return (
      <Button variant="outline" size="sm" className="h-9" onClick={() => setAuthOpen(true)} data-testid="button-signin">
        {user?.guest ? "Save your work" : "Sign in"}
      </Button>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account" data-testid="button-account">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{(user.name || "U").slice(0, 1).toUpperCase()}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} data-testid="menu-signout"><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeskNav() {
  const [loc] = useLocation();
  const items = [["/", "Create"], ["/projects", "Projects"], ["/activity", "Activity"], ["/me", "Account"]];
  return (
    <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
      {items.map(([h, l]) => {
        const on = h === "/" ? loc === "/" : loc.startsWith(h);
        return <Link key={h} href={h} className={cn("rounded-full px-3 py-1.5 text-sm transition-colors", on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`nav-${l.toLowerCase()}`}>{l}</Link>;
      })}
    </nav>
  );
}

export function TopBar({ children, right }: { children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/60 bg-background/75 px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 sm:px-4">
      <Link href="/" className="flex h-10 items-center rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Stak home" data-testid="link-home">
        <Logo />
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children ?? <DeskNav />}</div>
      <div className="flex items-center gap-1">
        {right}
        <span className="hidden md:contents"><NotifyButton /><ThemeToggle /></span>
        <AccountButton />
      </div>
    </header>
  );
}

export function AuthDialog() {
  const { authOpen, setAuthOpen, signIn, signUp, user } = useSession();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (authOpen) { setErr(""); setPw(""); } }, [authOpen]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { mode === "signin" ? await signIn(email, pw) : await signUp(name, email, pw); setAuthOpen(false); }
    catch (x: any) { setErr(x.message || "Something went wrong"); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={authOpen} onOpenChange={setAuthOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "signup" ? (user?.guest ? "Keep your projects" : "Create your account") : "Welcome back"}</DialogTitle>
          <DialogDescription>
            {mode === "signup" ? (user?.guest ? "Your guest projects move into the new account automatically." : "Free account with higher daily build limits.") : "Sign in to see your projects."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" data-testid="form-auth">
          {mode === "signup" && (
            <div className="grid gap-2"><Label htmlFor="au-name">Name</Label><Input id="au-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="input-name" /></div>
          )}
          <div className="grid gap-2"><Label htmlFor="au-email">Email</Label><Input id="au-email" className="h-11" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-testid="input-email" /></div>
          <div className="grid gap-2"><Label htmlFor="au-pw">Password</Label><Input id="au-pw" className="h-11" type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} data-testid="input-password" /></div>
          {err && <p className="text-sm text-destructive" role="alert" data-testid="text-auth-error">{err}</p>}
          <Button type="submit" className="h-11" disabled={busy} data-testid="button-auth-submit">{busy && <Loader2 className="animate-spin" />}{mode === "signup" ? "Create account" : "Sign in"}</Button>
          <button type="button" className="h-10 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setMode(mode === "signup" ? "signin" : "signup")} data-testid="button-auth-switch">
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function timeAgo(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return d < 30 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

export const KIND_LABEL: Record<string, string> = { app: "Web app", tool: "Tool", game: "Game", site: "Website" };
export { UserIcon };
