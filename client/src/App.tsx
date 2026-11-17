import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/lib/session";
import { AuthDialog } from "@/components/chrome";
import Home from "@/pages/home";
import Workspace from "@/pages/workspace";
import NotFound from "@/pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <TooltipProvider delayDuration={300}>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/p/:id" component={Workspace} />
              <Route component={NotFound} />
            </Switch>
          </Router>
          <AuthDialog />
          <Toaster />
        </TooltipProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
