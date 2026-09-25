import { useEffect, useRef, useState } from "react";

import { ApiError, EVENT_TYPES, EventSchema, api, isTerminal, selectionKey, type Job, type JobEvent } from "~/lib/api";

interface State {
  job: Job | null;
  error: string | null;
  /** True once the server answered 401: the session is gone and the page should call expire(). */
  sessionExpired: boolean;
}

/**
 * Loads a job snapshot and keeps it live over Server-Sent Events until the job
 * reaches a terminal state. Reconnects replay from the last seen seq; events
 * are applied in batches (one render per animation frame) so a scan that finds
 * thousands of resources does not re-render per event.
 */
export function useJob(jobId: string | undefined): State {
  const [state, setState] = useState<State>({ job: null, error: null, sessionExpired: false });
  const scanned = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!jobId) return;
    let es: EventSource | null = null;
    let cancelled = false;
    let frame = 0;
    let pending: JobEvent[] = [];
    scanned.current = new Set();

    const fail = (err: unknown) => {
      if (cancelled) return;
      const expired = err instanceof ApiError && err.status === 401;
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), sessionExpired: s.sessionExpired || expired }));
    };

    const flush = () => {
      frame = 0;
      if (cancelled || pending.length === 0) return;
      const batch = pending;
      pending = [];
      setState((s) => (s.job ? { ...s, job: applyEvents(s.job, batch, scanned.current) } : s));
    };

    const queue = (ev: JobEvent) => {
      pending.push(ev);
      if (!frame) frame = window.requestAnimationFrame(flush);
    };

    const close = () => {
      es?.close();
      es = null;
    };

    // Reads the snapshot; opens (or re-opens) the stream while the job runs.
    const sync = () =>
      api
        .job(jobId)
        .then((job) => {
          if (cancelled) return;
          pending = [];
          setState({ job, error: null, sessionExpired: false });
          if (isTerminal(job.state)) close();
          else open(job.lastSeq);
        })
        .catch(fail);

    const open = (after: number) => {
      close();
      const source = new EventSource(api.eventsUrl(jobId, after));
      es = source;
      const onEvent = (raw: MessageEvent<string>) => {
        let data: unknown;
        try {
          data = JSON.parse(raw.data);
        } catch {
          return;
        }
        const parsed = EventSchema.safeParse(data);
        if (parsed.success) queue(parsed.data);
      };
      for (const t of EVENT_TYPES) source.addEventListener(t, onEvent as EventListener);
      // The server sends "done" only in a terminal state; sync confirms it
      // and, should the job somehow still be running, re-opens the stream.
      source.addEventListener("done", () => {
        if (es === source) close();
        void sync();
      });
      source.onerror = () => {
        // Transient errors reconnect automatically with Last-Event-ID. A
        // closed stream means the server refused (401/404): find out why.
        if (source.readyState === EventSource.CLOSED && es === source) {
          close();
          void sync();
        }
      };
    };

    void sync();

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      close();
    };
  }, [jobId]);

  return state;
}

function applyEvents(job: Job, events: JobEvent[], scanned: Set<string>): Job {
  const next: Job = { ...job };
  const found = new Map(job.found.map((f) => [selectionKey(f), f] as const));
  const results = new Map(job.results.map((r) => [selectionKey(r), r] as const));
  let foundDirty = false;
  let resultsDirty = false;

  for (const ev of events) {
    if (ev.seq <= next.lastSeq) continue; // duplicate from a replay
    next.lastSeq = ev.seq;
    switch (ev.type) {
      case "phase":
        next.phase = ev.phase;
        if (ev.phase === "rescan") {
          found.clear();
          foundDirty = true;
          next.errors = [];
          scanned.clear();
          next.scanned = 0;
        }
        break;
      case "scan_progress":
        scanned.add(`${ev.resourceType}|${ev.region}`);
        next.scanned = Math.max(next.scanned, scanned.size);
        break;
      case "resource_found": {
        const r = {
          resourceType: ev.resourceType ?? "",
          region: ev.region ?? "",
          identifier: ev.identifier ?? "",
          nukable: ev.nukable ?? true,
          reason: ev.reason,
        };
        found.set(selectionKey(r), r);
        foundDirty = true;
        break;
      }
      case "general_error":
        next.errors = [...next.errors, { resourceType: ev.resourceType ?? "", message: ev.message ?? "", error: ev.error ?? "" }];
        break;
      case "resource_deleted": {
        const r = {
          resourceType: ev.resourceType ?? "",
          region: ev.region ?? "",
          identifier: ev.identifier ?? "",
          success: ev.success ?? false,
          warning: ev.warning,
          error: ev.error,
          note: ev.note,
        };
        results.set(selectionKey(r), r);
        resultsDirty = true;
        break;
      }
      case "summary":
        next.summary = ev.summary;
        break;
      case "fatal":
        next.error = ev.error;
        break;
      case "log":
        next.logTail = [...(next.logTail ?? []), ev.message ?? ""].slice(-50);
        break;
      default:
        break;
    }
  }
  if (foundDirty) next.found = [...found.values()];
  if (resultsDirty) next.results = [...results.values()];
  return next;
}
