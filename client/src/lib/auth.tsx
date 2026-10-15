import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, loadStudio, restoreSession, setAccessToken } from "./api";
import { isApp, writeRefresh } from "./studio";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  employeeId?: string | null;
  mustChangePassword: boolean;
  role: { id: string; name: string; slug: string; systemKey?: string | null; permissions: string[] };
  scopeClientIds: string[];
  scopeProjectIds: string[];
  studio?: { legalName?: string; businessTimezone?: string; currency?: string };
};

type AuthValue = {
  user: SessionUser | null;
  ready: boolean;
  login: (email: string, password: string, allow?: (user: SessionUser) => true | string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadStudio().then(() => restoreSession()).then((next) => setUser(next)).finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthValue>(() => ({
    user,
    ready,
    async login(email, password, allow) {
      const response = await api.post("/auth/login", { email, password });
      setAccessToken(response.data.data.accessToken);
      const me = await api.get("/auth/me");
      const next = me.data.data as SessionUser;
      const verdict = allow?.(next) ?? true;
      if (verdict !== true) {
        const refreshToken = isApp() ? await import("./studio").then((studio) => studio.readRefresh()) : null;
        await api.post("/auth/logout", refreshToken ? { refreshToken } : {}).catch(() => undefined);
        await writeRefresh(null);
        setAccessToken(null);
        throw new Error(verdict);
      }
      setUser(next);
    },
    async logout() {
      const refreshToken = isApp() ? await import("./studio").then((studio) => studio.readRefresh()) : null;
      await api.post("/auth/logout", refreshToken ? { refreshToken } : {});
      await writeRefresh(null);
      setAccessToken(null);
      setUser(null);
    },
    async refreshUser() {
      const me = await api.get("/auth/me");
      setUser(me.data.data);
    },
    can(permission: string) {
      if (!user) return false;
      if (user.role.systemKey === "super_admin") return true;
      return user.role.permissions.includes(permission);
    },
  }), [user, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing.");
  return value;
}
