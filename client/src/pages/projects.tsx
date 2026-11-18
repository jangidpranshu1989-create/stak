import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, Clock, AppWindow, FolderOpen, ExternalLink } from "lucide-react";
import { TopBar, timeAgo, KIND_LABEL } from "@/components/chrome";
import { TabBar, PageTitle, Tile, requestCreate } from "@/components/nav";
import { KIND_ICON } from "@/pages/home";
import { api, siteUrl, type ProjectLite, type Kind } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLive, PHASE_LABEL } from "@/lib/live";
import { cn } from "@/lib/utils";

const FILTERS: { id: "all" | Kind; label: string }[] = [
  { id: "all", label: "All" }, { id: "app", label: "Apps" }, { id: "tool", label: "Tools" }, { id: "game", label: "Games" }, { id: "site", label: "Websites" },
];

export default function Projects() {
  const { user, ready, setAuthOpen } = useSession();
  const { summary } = useLive();
  const [, nav] = useLocation();
  const [q, setQ] = useState("");
  const [f, setF] = useState<"all" | Kind>("all");
  const projects = useQuery({ queryKey: ["projects", user?.id], queryFn: () => api<ProjectLite[]>("GET", "/api/projects"), enabled: !!user });
  const activeBy = new Map((summary?.active || []).map((a) => [a.projectId, a]));
  const list = useMemo(() => (projects.data || []).filter((p) => (f === "all" || p.kind === f) && (!q || `${p.title} ${p.prompt}`.toLowerCase().includes(q.toLowerCase()))), [projects.data, q, f]);

  return (
    <div className="min-h-dvh bg-background pb-tabbar">
      <TopBar />
      <main className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 sm:pt-10">
        <PageTitle title="Projects" sub={projects.data ? `${projects.data.length} ${projects.data.length === 1 ? "project" : "projects"}` : undefined}
          right={<button onClick={() => requestCreate(nav)} className="press hidden h-10 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-white glow-brand md:inline-flex" data-testid="button-new-project"><Plus className="h-4 w-4" />New app</button>} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" className="h-11 w-full rounded-xl border bg-card pl-10 pr-3 text-[15px] outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20" data-testid="input-search" />
        </div>
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist">
          {FILTERS.map((x) => (
            <button key={x.id} role="tab" aria-selected={f === x.id} onClick={() => setF(x.id)} className={cn("press h-8 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors", f === x.id ? "border-transparent bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground")} data-testid={`filter-${x.id}`}>{x.label}</button>
          ))}
        </div>

        {!ready || (user && projects.isLoading) ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3].map((i) => <div key={i} className="shimmer h-[92px] rounded-2xl border bg-card" />)}</div>
        ) : !user || !list.length ? (
          <div className="mt-10 flex flex-col items-center rounded-3xl border border-dashed bg-card/50 px-6 py-14 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary"><FolderOpen className="h-7 w-7" /></span>
            <h2 className="mt-4 font-display text-lg font-bold">{q || f !== "all" ? "No matches" : "No projects yet"}</h2>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">{q || f !== "all" ? "Try another search or filter." : "Describe an app in one sentence and Stak will build it."}</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => requestCreate(nav)} className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-white glow-brand" data-testid="button-empty-create"><Plus className="h-4 w-4" />Create an app</button>
              {!user && <button onClick={() => setAuthOpen(true)} className="press h-10 rounded-full border px-4 text-sm font-medium" data-testid="button-empty-signin">Sign in</button>}
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => {
              const I = KIND_ICON[p.kind] || AppWindow;
              const a = activeBy.get(p.id);
              return (
                <div key={p.id} className="card-lift group relative overflow-hidden rounded-2xl border bg-card">
                  <Link href={`/p/${p.id}`} className="press flex items-center gap-3 p-4" data-testid={`row-project-${p.id}`}>
                    <Tile id={p.id} icon={I} className="h-12 w-12" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{p.title}</div>
                      <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {a ? <><span className="live-dot h-1.5 w-1.5 rounded-full bg-primary text-primary" /><span className="text-primary">{PHASE_LABEL[a.phase] || "Building"} · {Math.round(a.progress * 100)}%</span></>
                          : <><span>{KIND_LABEL[p.kind]}</span><span>·</span>{p.stage === "questions" ? <span className="text-amber-500">Needs answers</span> : <span>{p.version ? `v${p.version}` : "Draft"}</span>}<span>·</span><Clock className="h-3 w-3" />{timeAgo(p.updated)}</>}
                      </div>
                    </div>
                  </Link>
                  {p.version > 0 && !a && (
                    <a href={siteUrl(p.id, p.version)} target="_blank" rel="noreferrer" className="press absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Open ${p.title} live`} data-testid={`open-live-${p.id}`}><ExternalLink className="h-4 w-4" /></a>
                  )}
                  {a && <span className="absolute inset-x-0 bottom-0 h-1 bg-primary/10"><span className="block h-full bg-brand transition-[width] duration-700" style={{ width: `${Math.max(5, a.progress * 100)}%` }} /></span>}
                </div>
              );
            })}
          </div>
        )}
      </main>
      <TabBar />
    </div>
  );
}
