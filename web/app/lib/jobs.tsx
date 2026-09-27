import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { api, briefOf, isTerminal, type Job, type JobBrief } from "~/lib/api";
import { briefToHistory, getHistory, isHistoryTerminal, markLostHistory, saveHistory, toHistory } from "~/lib/history";
import { isSessionError, useSession } from "~/lib/session";

interface JobsCtx {
  /** The session's jobs that have not finished, newest first. */
  running: JobBrief[];
  /** Re-list the session's jobs and back-fill history with anything this browser missed. */
  refresh: () => Promise<void>;
  /** Feed a live snapshot from a page's useJob so the indicator and history stay current. */
  sync: (job: Job) => void;
}

const Ctx = createContext<JobsCtx | null>(null);

const POLL_MS = 4_000;

/**
 * Tracks the session's scan and clean-up jobs independently of which page is
 * open. Pages used to be the only thing that wrote a finished job to history,
 * so navigating away while a clean-up ran lost both the way back to it and
 * its result. The tracker lists the server's jobs whenever the session is
 * connected, polls while any of them run, and writes every terminal job to
 * history exactly once.
 */
export function JobsProvider({ children }: { children: React.ReactNode }) {
  const { status, expire } = useSession();
  const [running, setRunning] = useState<JobBrief[]>([]);
  // Ids whose final record is already in history (this tab) / whose placeholder is.
  const saved = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const inflight = useRef<Promise<void> | null>(null);

  const recordFinished = useCallback(async (id: string) => {
    if (saved.current.has(id)) return;
    saved.current.add(id);
    try {
      const existing = await getHistory(id);
      if (existing && isHistoryTerminal(existing.state) && existing.state !== "lost") return;
      const job = await api.job(id);
      await saveHistory(toHistory(job));
    } catch {
      saved.current.delete(id); // retry on the next listing
    }
  }, []);

  const refresh = useCallback(async () => {
    if (status !== "authed") return;
    if (inflight.current) return inflight.current;
    const p = (async () => {
      let jobs: JobBrief[];
      try {
        jobs = (await api.jobs()).jobs;
      } catch (err) {
        if (isSessionError(err)) expire();
        return;
      }
      const live = jobs.filter((j) => !isTerminal(j.state));
      setRunning((prev) => (sameRunning(prev, live) ? prev : live));
      for (const j of live) {
        if (seen.current.has(j.id)) continue;
        seen.current.add(j.id);
        const existing = await getHistory(j.id);
        if (!existing) await saveHistory(briefToHistory(j));
      }
      await Promise.all(jobs.filter((j) => isTerminal(j.state)).map((j) => recordFinished(j.id)));
      await markLostHistory(new Set(jobs.map((j) => j.id)));
    })().finally(() => {
      inflight.current = null;
    });
    inflight.current = p;
    return p;
  }, [status, expire, recordFinished]);

  const sync = useCallback(
    (job: Job) => {
      if (isTerminal(job.state)) {
        setRunning((prev) => (prev.some((j) => j.id === job.id) ? prev.filter((j) => j.id !== job.id) : prev));
        if (saved.current.has(job.id)) return;
        saved.current.add(job.id);
        void saveHistory(toHistory(job));
        return;
      }
      const b = briefOf(job);
      setRunning((prev) => {
        const i = prev.findIndex((j) => j.id === job.id);
        if (i < 0) return [b, ...prev].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
        const cur = prev[i];
        if (cur.state === b.state && cur.phase === b.phase && cur.deleted === b.deleted && cur.found === b.found) return prev;
        const next = prev.slice();
        next[i] = b;
        return next;
      });
      if (!seen.current.has(job.id)) {
        seen.current.add(job.id);
        void saveHistory(toHistory(job));
      }
    },
    [],
  );

  // List on connect; forget everything on disconnect.
  useEffect(() => {
    if (status === "authed") {
      void refresh();
      return;
    }
    if (status === "anonymous") {
      setRunning([]);
      seen.current.clear();
    }
  }, [status, refresh]);

  // Poll while something runs, and re-list when the tab comes back into view.
  useEffect(() => {
    if (status !== "authed") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (running.length > 0) timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearInterval(timer);
    };
  }, [status, running.length, refresh]);

  const value = useMemo(() => ({ running, refresh, sync }), [running, refresh, sync]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function sameRunning(a: JobBrief[], b: JobBrief[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return x.id === y.id && x.state === y.state && x.phase === y.phase && x.deleted === y.deleted && x.found === y.found;
  });
}

export function useJobs(): JobsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useJobs outside JobsProvider");
  return ctx;
}

/** Keeps the tracker (and history) in step with a page's live job. */
export function useJobSync(job: Job | null) {
  const { sync } = useJobs();
  useEffect(() => {
    if (job) sync(job);
  }, [job, sync]);
}

/** Wizard page that shows a job. */
export function jobPath(job: Pick<JobBrief, "id" | "mode">): string {
  return job.mode === "nuke" ? `/wizard/clean/${job.id}` : `/wizard/scan/${job.id}`;
}
