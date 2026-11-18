import { Moon, Sun, Bell, LogOut, LayoutGrid, Smartphone, ChevronRight, Github, Download, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { TopBar, getTheme, applyTheme } from "@/components/chrome";
import { TabBar, PageTitle } from "@/components/nav";
import { useSession } from "@/lib/session";
import { useLive } from "@/lib/live";
import { isNative } from "@/lib/api";
import { Switch } from "@/components/ui/switch";

const APK = "https://github.com/jangidpranshu1989-create/stak/releases/latest";

function Row({ icon: I, label, sub, right, onClick, href, testid }: { icon: any; label: string; sub?: string; right?: React.ReactNode; onClick?: () => void; href?: string; testid: string }) {
  const body = (<><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-foreground/80"><I className="h-[18px] w-[18px]" /></span><span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">{label}</span>{sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}</span>{right ?? <ChevronRight className="h-4 w-4 text-muted-foreground" />}</>);
  const cls = "press flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50";
  return href ? <a href={href} target="_blank" rel="noreferrer" className={cls} data-testid={testid}>{body}</a> : <button type="button" onClick={onClick} className={cls} data-testid={testid}>{body}</button>;
}

export default function Me() {
  const { user, signOut, setAuthOpen } = useSession();
  const { perm, enable, summary } = useLive();
  const [dark, setDark] = useState(getTheme() === "dark");
  useEffect(() => { applyTheme(dark ? "dark" : "light"); }, [dark]);
  const initials = (user?.name || "G").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-dvh bg-background pb-tabbar">
      <TopBar />
      <main className="mx-auto w-full max-w-xl px-4 pt-6 sm:px-6 sm:pt-10">
        <PageTitle title="You" />
        <div className="relative overflow-hidden rounded-3xl border bg-card p-5">
          <div className="aurora opacity-60" aria-hidden="true" />
          <div className="relative flex items-center gap-4">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand font-display text-xl font-bold text-white">{initials}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-lg font-bold">{user ? user.name : "Not signed in"}</div>
              <div className="truncate text-sm text-muted-foreground">{user?.guest ? "Guest — sign up to keep your projects" : user?.email || "Create a free account"}</div>
            </div>
          </div>
          {summary?.usage && (
            <div className="relative mt-5 grid grid-cols-3 gap-2 text-center">
              {[["Projects", summary.stats.projects], ["Live", summary.stats.ready], ["AI today", `${summary.usage.aiUsed}/${summary.usage.aiLimit}`]].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-background/60 p-2.5"><div className="font-display text-lg font-bold tabular-nums">{v}</div><div className="text-[11px] text-muted-foreground">{k}</div></div>
              ))}
            </div>
          )}
          {(!user || user.guest) && <button onClick={() => setAuthOpen(true)} className="press relative mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-white glow-brand" data-testid="button-me-signup"><Sparkles className="h-4 w-4" />{user?.guest ? "Save my work — sign up free" : "Sign in or sign up"}</button>}
        </div>

        <h2 className="mb-2 mt-7 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preferences</h2>
        <div className="divide-y overflow-hidden rounded-2xl border bg-card">
          <Row icon={dark ? Moon : Sun} label="Dark mode" testid="row-theme" onClick={() => setDark(!dark)} right={<Switch checked={dark} onCheckedChange={setDark} aria-label="Dark mode" onClick={(e) => e.stopPropagation()} />} />
          <Row icon={Bell} label="Build notifications" sub={perm === "granted" ? "On — you'll hear when builds finish" : perm === "denied" ? "Blocked in system settings" : perm === "unsupported" ? "Not supported in this browser" : "Off"} testid="row-notify"
            onClick={() => perm !== "granted" && enable()} right={<Switch checked={perm === "granted"} disabled={perm === "unsupported"} onCheckedChange={() => perm !== "granted" && enable()} aria-label="Build notifications" onClick={(e) => e.stopPropagation()} />} />
        </div>

        <h2 className="mb-2 mt-7 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{isNative() ? "Home screen" : "Get the app"}</h2>
        <div className="divide-y overflow-hidden rounded-2xl border bg-card">
          {isNative() ? (
            <Row icon={LayoutGrid} label="Add Stak widgets" sub="Long-press home screen → Widgets → Stak (4 live widgets)" testid="row-widgets" onClick={() => alert("Long-press an empty spot on your home screen, tap Widgets, then pick Stak: Live build (2×2), Quick create (4×1), Projects (4×2) or Stats (2×1).")} />
          ) : (
            <Row icon={Download} label="Android app" sub="Live widgets, background tracking and notifications" href={APK} testid="row-apk" />
          )}
          <Row icon={Smartphone} label="Install as web app" sub="Browser menu → Add to Home screen" testid="row-pwa" onClick={() => alert("Open your browser menu and choose 'Add to Home screen' or 'Install app'.")} />
          <Row icon={Github} label="Source code" sub="github.com/jangidpranshu1989-create/stak" href="https://github.com/jangidpranshu1989-create/stak" testid="row-github" />
        </div>

        {user && !user.guest && (
          <div className="mt-7 overflow-hidden rounded-2xl border bg-card">
            <Row icon={LogOut} label="Sign out" testid="row-signout" onClick={() => signOut()} right={<span />} />
          </div>
        )}
        <p className="mt-8 text-center text-xs text-muted-foreground">Stak 1.2 · made in India</p>
      </main>
      <TabBar />
    </div>
  );
}
