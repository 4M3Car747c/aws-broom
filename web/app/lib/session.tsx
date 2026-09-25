import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { ApiError, api, type SessionInfo } from "~/lib/api";

type Status = "loading" | "anonymous" | "authed";

interface SessionCtx {
  status: Status;
  info: SessionInfo | null;
  login: (creds: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }) => Promise<SessionInfo>;
  logout: () => Promise<void>;
  /** Mark the session as gone after a 401 from any API call. */
  expire: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const queryClient = useQueryClient();
  // Anything fetched with the previous credentials (enabled regions) is stale
  // the moment the identity changes.
  const dropAccountQueries = useCallback(() => queryClient.removeQueries({ queryKey: ["regions"] }), [queryClient]);

  useEffect(() => {
    let cancelled = false;
    api
      .getSession()
      .then((s) => {
        if (cancelled) return;
        setInfo(s);
        setStatus("authed");
      })
      .catch(() => {
        if (cancelled) return;
        setInfo(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (creds: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }) => {
    const s = await api.createSession(creds);
    dropAccountQueries();
    setInfo(s);
    setStatus("authed");
    return s;
  }, [dropAccountQueries]);

  const logout = useCallback(async () => {
    try {
      await api.deleteSession();
    } catch {
      /* already gone */
    }
    dropAccountQueries();
    setInfo(null);
    setStatus("anonymous");
    try {
      window.sessionStorage.removeItem("broom-wizard");
    } catch {
      /* ignore */
    }
  }, [dropAccountQueries]);

  const expire = useCallback(() => {
    dropAccountQueries();
    setInfo(null);
    setStatus("anonymous");
  }, [dropAccountQueries]);

  const value = useMemo(() => ({ status, info, login, logout, expire }), [status, info, login, logout, expire]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

/** True when the error means the server-side session is gone. */
export function isSessionError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}
