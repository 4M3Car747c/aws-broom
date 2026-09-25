import { del, get, set } from "idb-keyval";

import type { DeleteResult, FoundResource, GeneralError, JobState, Summary } from "~/lib/api";

export interface HistoryEntry {
  id: string; // job id
  kind: "scan" | "nuke";
  accountId: string;
  createdAt: string;
  finishedAt?: string;
  state: JobState;
  regions: string[];
  resourceTypes: string[];
  olderThan?: string;
  summary?: Summary;
  found?: FoundResource[];
  results?: DeleteResult[];
  errors?: GeneralError[];
  error?: string;
}

const KEY = "broom-history";
const MAX = 50;

export async function listHistory(): Promise<HistoryEntry[]> {
  try {
    const v = (await get<HistoryEntry[]>(KEY)) ?? [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function saveHistory(entry: HistoryEntry): Promise<void> {
  try {
    const all = await listHistory();
    const rest = all.filter((e) => e.id !== entry.id);
    await set(KEY, [entry, ...rest].slice(0, MAX));
  } catch {
    /* storage unavailable */
  }
}

export async function deleteHistory(id: string): Promise<void> {
  try {
    const all = await listHistory();
    await set(
      KEY,
      all.filter((e) => e.id !== id),
    );
  } catch {
    /* ignore */
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await del(KEY);
  } catch {
    /* ignore */
  }
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
