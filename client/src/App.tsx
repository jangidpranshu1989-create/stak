import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/lib/session";
import { AuthDialog } from "@/components/chrome";
import { LiveProvider } from "@/lib/live";
import { LiveDock } from "@/components/live";
import Home from "@/pages/home";
import Workspace from "@/pages/workspace";
import NotFound from "@/pages/not-found";
import Projects from "@/pages/projects";
import ActivityPage from "@/pages/activity";
import Me from "@/pages/me";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { Onboarding, isAppShell, onboarded } from "@/components/onboarding";

// Native app / installed PWA: first launch shows welcome → account → notifications before the builder.
function Gate({ children }: { children: React.ReactNode }) {
  const { user, ready } = useSession();
  const [done, setDone] = useState(() => !isAppShell() || onboarded());
  if (done) return <>{children}</>;
  if (!ready) return <div className="fixed inset-0 bg-background" />;
  if (user && !user.guest) return <>{children}</>;
  return <Onboarding onDone={() => setDone(true)} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
      <LiveProvider>
        <TooltipProvider delayDuration={300}>
          <Gate>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/p/:id" component={Workspace} />
              <Route path="/projects" component={Projects} />
              <Route path="/activity" component={ActivityPage} />
              <Route path="/me" component={Me} />
              <Route component={NotFound} />
            </Switch>
          </Router>
          </Gate>
          <AuthDialog />
          <LiveDock />
          <Toaster />
        </TooltipProvider>
      </LiveProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
