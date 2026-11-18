// First-run flow for the Android app / installed PWA: welcome slides → account → notifications → home.
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bell, Check, Loader2, Mail, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/chrome";
import { useSession } from "@/lib/session";
import { useLive } from "@/lib/live";
import { isNative, native } from "@/lib/api";
import { cn } from "@/lib/utils";

const FLAG = "stak_onboarded";
export const isAppShell = () => {
  try { return isNative() || window.matchMedia("(display-mode: standalone)").matches; } catch { return false; }
};
export const onboarded = () => { try { return localStorage.getItem(FLAG) === "1"; } catch { return true; } };
const markOnboarded = () => { try { localStorage.setItem(FLAG, "1"); } catch { /* ignore */ } };
const tap = () => native()?.haptic().catch(() => {});

// ---------------------------------------------------------------- slide art (pure CSS, theme-aware)
function ArtPrompt() {
  return (
    <div className="relative mx-auto w-full max-w-[300px]">
      <div className="ml-auto w-[82%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-[13px] font-medium leading-snug text-primary-foreground shadow-lg shadow-primary/20">
        Expense tracker bana do, monthly budget ke saath
      </div>
      <div className="mt-4 rounded-2xl border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div><div className="text-[11px] text-muted-foreground">This month</div><div className="font-display text-xl font-semibold tabular-nums">₹18,240</div></div>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">62% of budget</span>
        </div>
        <div className="mt-4 flex h-16 items-end gap-1.5">
          {[38, 62, 45, 80, 52, 70, 34].map((h, i) => <div key={i} className={cn("flex-1 rounded-md", i === 3 ? "bg-primary" : "bg-muted")} style={{ height: `${h}%` }} />)}
        </div>
        <div className="mt-3 space-y-2">
          {[["Groceries", "₹2,140"], ["Fuel", "₹1,600"]].map(([a, b]) => (
            <div key={a} className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-[12px]"><span>{a}</span><span className="font-medium tabular-nums">{b}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
function ArtLive() {
  return (
    <div className="relative mx-auto w-full max-w-[300px]">
      <div className="rounded-2xl border bg-card p-4 shadow-xl">
        <div className="flex items-center gap-2 text-[13px] font-medium"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" /><span className="relative h-2 w-2 rounded-full bg-primary" /></span>Building Clinic Booking</div>
        <div className="mt-4 space-y-2.5">
          {[["Planning", 2], ["Writing code", 1], ["Testing", 0], ["Publishing", 0]].map(([l, s]) => (
            <div key={l as string} className="flex items-center gap-2.5 text-[12px]">
              <span className={cn("grid h-4 w-4 place-items-center rounded-full", s === 2 ? "bg-primary text-primary-foreground" : s === 1 ? "border-2 border-primary" : "border border-border")}>{s === 2 && <Check className="h-2.5 w-2.5" strokeWidth={3} />}</span>
              <span className={cn(s === 0 && "text-muted-foreground")}>{l}</span>
              {s === 1 && <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          ))}
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-[46%] rounded-full bg-primary" /></div>
      </div>
      <div className="absolute -bottom-6 -right-2 w-[132px] rounded-[20px] border border-white/10 bg-[#151311] p-3 text-[#f4efe8] shadow-2xl">
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[4px] bg-primary" /><span className="rounded-full bg-primary/20 px-1.5 text-[8px] font-semibold tracking-wider text-primary">LIVE</span></div>
        <div className="mt-5 text-[12px] font-medium leading-tight">Clinic Booking</div>
        <div className="mt-0.5 text-[9.5px] text-[#a8a29a]">Writing code · 46%</div>
        <div className="mt-2 h-1 rounded-full bg-[#2a2623]"><div className="h-full w-[46%] rounded-full bg-primary" /></div>
      </div>
    </div>
  );
}
function ArtShip() {
  return (
    <div className="relative mx-auto w-full max-w-[300px]">
      <div className="mx-auto w-[210px] rounded-[30px] border-[6px] border-foreground/90 bg-card p-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-foreground/15" />
        <div className="h-20 rounded-xl bg-gradient-to-br from-primary/80 to-primary/40" />
        <div className="mt-3 h-2.5 w-3/4 rounded-full bg-foreground/80" />
        <div className="mt-2 h-2 w-full rounded-full bg-muted" />
        <div className="mt-1.5 h-2 w-5/6 rounded-full bg-muted" />
        <div className="mt-4 grid grid-cols-2 gap-2"><div className="h-12 rounded-lg bg-muted" /><div className="h-12 rounded-lg bg-muted" /></div>
        <div className="mt-3 h-8 rounded-full bg-primary" />
      </div>
      <div className="absolute -left-1 top-10 rounded-full border bg-background px-3 py-1.5 text-[11px] font-medium shadow-lg">Share link</div>
      <div className="absolute -right-1 bottom-12 rounded-full border bg-background px-3 py-1.5 text-[11px] font-medium shadow-lg">Download ZIP</div>
    </div>
  );
}

const SLIDES = [
  { art: ArtPrompt, title: "Describe it. Get a real app.", body: "Type what you need in English or Hinglish. Stak builds a working app with data, sign-in and AI built in." },
  { art: ArtLive, title: "Watch it build, live", body: "Follow every step from your notification bar and the home-screen widget. You'll know the second it's ready." },
  { art: ArtShip, title: "Share it or take the code", body: "Every app gets a link you can send right away, plus the full source to host anywhere." },
];

// ---------------------------------------------------------------- flow
type Step = "slides" | "auth" | "email" | "notify";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { user, ensure, signIn, signUp } = useSession();
  const { enable, perm } = useLive();
  const [step, setStep] = useState<Step>("slides");
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const drag = useRef<{ x: number; y: number } | null>(null);

  const finish = () => { markOnboarded(); onDone(); };
  const afterAuth = () => { if (perm === "granted" || perm === "unsupported") finish(); else setStep("notify"); };
  useEffect(() => { if (user && !user.guest && step === "auth") afterAuth(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => { tap(); if (i < SLIDES.length - 1) setI(i + 1); else setStep("auth"); };
  const guest = async () => {
    tap(); setBusy("guest"); setErr("");
    try { await ensure(); afterAuth(); } catch (e: any) { setErr(e?.message || "Couldn't start a guest session"); } finally { setBusy(null); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy("email"); setErr("");
    try { mode === "signin" ? await signIn(email.trim(), pw) : await signUp(name.trim(), email.trim(), pw); afterAuth(); }
    catch (x: any) { setErr(x?.message || "Something went wrong"); }
    finally { setBusy(null); }
  };

  const shell = "fixed inset-0 z-[60] flex flex-col bg-background text-foreground";
  const inner = "mx-auto flex w-full max-w-md flex-1 flex-col px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))]";

  if (step === "slides") {
    const S = SLIDES[i];
    return (
      <div className={shell} data-testid="onboarding">
        <div className={inner}
          onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={(e) => {
            const d = drag.current; drag.current = null; if (!d) return;
            const dx = e.clientX - d.x; if (Math.abs(dx) < 50 || Math.abs(e.clientY - d.y) > Math.abs(dx)) return;
            if (dx < 0) next(); else if (i > 0) { tap(); setI(i - 1); }
          }}>
          <div className="flex h-14 items-center justify-between">
            <Logo />
            <button className="-mr-2 h-11 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" onClick={() => { tap(); setStep("auth"); }} data-testid="button-onboarding-skip">Skip</button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center py-6">
            <div key={i} className="w-full animate-in fade-in slide-in-from-right-6 duration-300"><S.art /></div>
          </div>
          <div key={`t${i}`} className="min-h-[150px] animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="font-display text-[28px] font-semibold leading-[1.15] tracking-tight" data-testid="text-onboarding-title">{S.title}</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{S.body}</p>
          </div>
          <div className="mt-8 flex items-center gap-4">
            <div className="flex flex-1 gap-1.5" role="tablist" aria-label="Intro progress">
              {SLIDES.map((_, k) => (
                <button key={k} role="tab" aria-selected={k === i} aria-label={`Slide ${k + 1}`} onClick={() => setI(k)} className={cn("h-1.5 rounded-full transition-all duration-300", k === i ? "w-6 bg-foreground" : "w-1.5 bg-foreground/20")} />
              ))}
            </div>
            <Button className="h-12 rounded-full px-6 text-[15px]" onClick={next} data-testid="button-onboarding-next">
              {i < SLIDES.length - 1 ? "Continue" : "Get started"}<ArrowRight />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "notify") {
    return (
      <div className={shell} data-testid="onboarding-notify">
        <div className={inner}>
          <div className="h-14" />
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="relative grid h-24 w-24 place-items-center rounded-[28px] bg-primary/10">
              <Bell className="h-10 w-10 text-primary" />
              <span className="absolute right-5 top-5 h-3 w-3 rounded-full border-2 border-background bg-primary" />
            </div>
            <h1 className="mt-8 font-display text-[26px] font-semibold leading-tight tracking-tight">Know the moment it's ready</h1>
            <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-muted-foreground">Get a heads-up when a build finishes, fails, or needs a quick answer from you. No spam.</p>
          </div>
          <div className="grid gap-2">
            <Button className="h-12 rounded-full text-[15px]" onClick={async () => { tap(); await enable().catch(() => {}); finish(); }} data-testid="button-onboarding-allow">Allow notifications</Button>
            <Button variant="ghost" className="h-12 rounded-full text-[15px] text-muted-foreground" onClick={finish} data-testid="button-onboarding-later">Not now</Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "email") {
    return (
      <div className={shell} data-testid="onboarding-email">
        <div className={inner}>
          <div className="flex h-14 items-center">
            <button className="-ml-2 grid h-11 w-11 place-items-center rounded-full hover:bg-muted" onClick={() => { setErr(""); setStep("auth"); }} aria-label="Back" data-testid="button-onboarding-back"><ArrowLeft className="h-5 w-5" /></button>
          </div>
          <h1 className="mt-4 font-display text-[28px] font-semibold leading-tight tracking-tight">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">{mode === "signup" ? "Free, with higher daily build limits." : "Sign in to pick up where you left off."}</p>
          <form onSubmit={submit} className="mt-8 grid gap-4" data-testid="form-onboarding-auth">
            {mode === "signup" && <div className="grid gap-2"><Label htmlFor="ob-name">Name</Label><Input id="ob-name" className="h-12 rounded-xl text-[16px]" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" /></div>}
            <div className="grid gap-2"><Label htmlFor="ob-email">Email</Label><Input id="ob-email" className="h-12 rounded-xl text-[16px]" type="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" data-testid="input-onboarding-email" /></div>
            <div className="grid gap-2"><Label htmlFor="ob-pw">Password</Label><Input id="ob-pw" className="h-12 rounded-xl text-[16px]" type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder="At least 6 characters" data-testid="input-onboarding-password" /></div>
            {err && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{err}</p>}
            <Button type="submit" className="mt-2 h-12 rounded-full text-[15px]" disabled={!!busy} data-testid="button-onboarding-submit">{busy === "email" && <Loader2 className="animate-spin" />}{mode === "signup" ? "Create account" : "Sign in"}</Button>
          </form>
          <div className="flex-1" />
          <button className="h-12 text-sm text-muted-foreground" onClick={() => { setErr(""); setMode(mode === "signup" ? "signin" : "signup"); }}>
            {mode === "signup" ? <>Already have an account? <span className="font-medium text-foreground">Sign in</span></> : <>New to Stak? <span className="font-medium text-foreground">Create an account</span></>}
          </button>
        </div>
      </div>
    );
  }

  // auth choice
  return (
    <div className={shell} data-testid="onboarding-auth">
      <div className={inner}>
        <div className="flex h-14 items-center">
          <button className="-ml-2 grid h-11 w-11 place-items-center rounded-full hover:bg-muted" onClick={() => { setI(SLIDES.length - 1); setStep("slides"); }} aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-[24px] bg-[#151311] shadow-xl shadow-black/10 ring-1 ring-border">
            <svg viewBox="0 0 32 32" width="44" height="44" aria-hidden="true"><rect x="5" y="19" width="22" height="7" rx="2.2" fill="#f4efe8" opacity=".35" /><rect x="8" y="12.5" width="16" height="7" rx="2.2" fill="#f4efe8" opacity=".7" /><rect x="11" y="6" width="10" height="7" rx="2.2" fill="#f26b1d" /></svg>
          </div>
          <h1 className="mt-7 font-display text-[28px] font-semibold leading-tight tracking-tight">Welcome to Stak</h1>
          <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-muted-foreground">Sign in to keep your projects in sync across your phone and the web.</p>
        </div>
        {err && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive" role="alert">{err}</p>}
        <div className="grid gap-2.5">
          <Button className="h-12 rounded-full text-[15px]" onClick={() => { tap(); setMode("signup"); setStep("email"); }} data-testid="button-onboarding-signup"><Mail />Continue with email</Button>
          <Button variant="outline" className="h-12 rounded-full text-[15px]" onClick={() => { tap(); setMode("signin"); setStep("email"); }} data-testid="button-onboarding-signin"><UserRound />I already have an account</Button>
          <Button variant="ghost" className="h-12 rounded-full text-[15px] text-muted-foreground" onClick={guest} disabled={!!busy} data-testid="button-onboarding-guest">{busy === "guest" ? <Loader2 className="animate-spin" /> : <Sparkles />}Try it as a guest</Button>
        </div>
        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">Guest projects stay on this device until you create an account.</p>
      </div>
    </div>
  );
}
