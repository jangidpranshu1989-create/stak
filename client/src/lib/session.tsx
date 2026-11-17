import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setToken, type User } from "./api";

interface Session {
  user: User | null;
  ready: boolean;
  ensure: () => Promise<User>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  authOpen: boolean;
  setAuthOpen: (v: boolean) => void;
}
const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    api<{ user: User; token: string }>("GET", "/api/auth/me")
      .then((r) => { setToken(r.token); setUser(r.user); })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // guest sessions are created lazily — only when someone actually starts building
  const ensure = useCallback(async () => {
    if (user) return user;
    const r = await api<{ token: string; user: User }>("POST", "/api/auth/guest", { lang: navigator.language?.startsWith("hi") ? "hinglish" : "en" });
    setToken(r.token); setUser(r.user);
    return r.user;
  }, [user]);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>("POST", "/api/auth/login", { email, password });
    setToken(r.token); setUser(r.user);
  }, []);
  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const r = await api<{ token: string; user: User }>("POST", "/api/auth/signup", { name, email, password });
    setToken(r.token); setUser(r.user);
  }, []);
  const signOut = useCallback(async () => {
    await api("POST", "/api/auth/logout").catch(() => {});
    setToken(null); setUser(null);
  }, []);

  const v = useMemo(() => ({ user, ready, ensure, signIn, signUp, signOut, authOpen, setAuthOpen }), [user, ready, ensure, signIn, signUp, signOut, authOpen]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession outside provider");
  return c;
}
