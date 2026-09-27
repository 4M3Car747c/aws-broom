import { del, get, set } from "idb-keyval";

import type { DeleteResult, FoundResource, GeneralError, Job, JobBrief, JobState, Summary } from "~/lib/api";

/**
 * "lost" is a browser-only state: the run was still going when this browser
 * last saw it and the server no longer has the job (retention passed or the
 * session that owned it ended), so the outcome was never recorded here.
 */
export type HistoryState = JobState | "lost";

export interface HistoryEntry {
  id: string; // job id
  kind: "scan" | "nuke";
  accountId: string;
  createdAt: string;
  finishedAt?: string;
  state: HistoryState;
  regions: string[];
  resourceTypes: string[];
  olderThan?: string;
  /** Resources a clean-up was asked to delete (nuke only). */
  selected?: number;
  summary?: Summary;
  found?: FoundResource[];
  results?: DeleteResult[];
  errors?: GeneralError[];
  error?: string;
}

const KEY = "broom-history";
const MAX = 50;

export function isHistoryTerminal(state: HistoryState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled" || state === "lost";
}

/** Full record from a job snapshot (any state). */
export function toHistory(job: Job): HistoryEntry {
  return {
    id: job.id,
    kind: job.mode,
    accountId: job.accountId,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    state: job.state,
    regions: job.spec.regions,
    resourceTypes: job.spec.resourceTypes,
    olderThan: job.spec.olderThan,
    selected: job.spec.selections?.length || undefined,
    summary: job.summary,
    found: job.found,
    results: job.results,
    errors: job.errors,
    error: job.error,
  };
}

/** Placeholder record for a run that is still going; replaced by the full record when it finishes. */
export function briefToHistory(b: JobBrief): HistoryEntry {
  return {
    id: b.id,
    kind: b.mode,
    accountId: b.accountId,
    createdAt: b.createdAt,
    finishedAt: b.finishedAt,
    state: b.state,
    regions: b.regions,
    resourceTypes: b.resourceTypes,
    olderThan: b.olderThan,
    selected: b.selected || undefined,
    summary: b.summary,
    error: b.error,
  };
}

// Every write is a read-modify-write of one IndexedDB value; the chain keeps
// concurrent writers (a wizard page and the background tracker) from
// clobbering each other.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function read(): Promise<HistoryEntry[]> {
  try {
    const v = (await get<HistoryEntry[]>(KEY)) ?? [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function write(all: HistoryEntry[]): Promise<void> {
  try {
    await set(KEY, all.slice(0, MAX));
  } catch {
    /* storage unavailable */
  }
}

export function listHistory(): Promise<HistoryEntry[]> {
  return serial(read);
}

export function getHistory(id: string): Promise<HistoryEntry | undefined> {
  return serial(async () => (await read()).find((e) => e.id === id));
}

/** Inserts or replaces the entry with the same id, newest first. */
export function saveHistory(entry: HistoryEntry): Promise<void> {
  return serial(async () => {
    const all = await read();
    const rest = all.filter((e) => e.id !== entry.id);
    await write([entry, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
}

/**
 * Marks runs this browser recorded as in progress but the server no longer
 * lists as "lost". `alive` is the id set the server just returned; entries
 * younger than `graceMs` are skipped so a job created a moment ago is not
 * mislabelled before its first listing.
 */
export function markLostHistory(alive: Set<string>, graceMs = 60_000): Promise<HistoryEntry[]> {
  return serial(async () => {
    const all = await read();
    const cutoff = Date.now() - graceMs;
    const lost: HistoryEntry[] = [];
    const next = all.map((e) => {
      if (isHistoryTerminal(e.state) || alive.has(e.id) || new Date(e.createdAt).getTime() > cutoff) return e;
      const l: HistoryEntry = { ...e, state: "lost" };
      lost.push(l);
      return l;
    });
    if (lost.length > 0) await write(next);
    return lost;
  });
}

export function deleteHistory(id: string): Promise<void> {
  return serial(async () => {
    const all = await read();
    await write(all.filter((e) => e.id !== id));
  });
}

export function clearHistory(): Promise<void> {
  return serial(async () => {
    try {
      await del(KEY);
    } catch {
      /* ignore */
    }
  });
}

/** "24h0m0s" -> 24; whole hours, or null when unset/unparseable. */
export function olderThanHours(goDuration: string | undefined): number | null {
  if (!goDuration) return null;
  let secs = 0;
  const re = /(\d+(?:\.\d+)?)(h|m|s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(goDuration))) {
    const v = parseFloat(m[1]);
    secs += m[2] === "h" ? v * 3600 : m[2] === "m" ? v * 60 : v;
  }
  const h = Math.round(secs / 3600);
  return h > 0 ? h : null;
}

export type ResultKind = "deleted" | "gone" | "retry" | "fail";

/** Buckets one clean-up result the way the UI reports it. */
export function resultKind(r: DeleteResult): ResultKind {
  if (r.success) return r.note === "already_gone" ? "gone" : "deleted";
  return r.warning ? "retry" : "fail";
}

/** Outcome counts for an entry, from its summary or, failing that, its rows. */
export function entryCounts(e: HistoryEntry) {
  const s = e.summary;
  const results = e.results ?? [];
  const found = e.found ?? [];
  const by = (k: ResultKind) => results.filter((r) => resultKind(r) === k).length;
  return {
    found: s?.found || found.length,
    protected: s?.notNukable || found.filter((f) => !f.nukable).length,
    nukable: (s?.found || found.length) - (s?.notNukable || found.filter((f) => !f.nukable).length),
    errors: s?.generalErrors || (e.errors ?? []).length,
    deleted: (s?.deleted ?? 0) + (s?.alreadyGone ?? 0) > 0 ? (s?.deleted ?? 0) : by("deleted"),
    gone: s?.alreadyGone || by("gone"),
    retry: s?.warned || by("retry"),
    failed: s?.failed || by("fail"),
  };
}

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
