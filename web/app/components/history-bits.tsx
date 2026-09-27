import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { cn } from "cn";

import { StatusDot, type Tone } from "~/components/bits";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { type JobBrief } from "~/lib/api";
import { entryCounts, type HistoryEntry, type HistoryState } from "~/lib/history";
import { jobPath } from "~/lib/jobs";

// Pieces shared by the history list and the record detail page.

export function KindTag({ kind }: { kind: "scan" | "nuke" }) {
  const { t } = useTranslation();
  return (
    <Badge className={cn("border-transparent", kind === "nuke" ? "bg-destructive/12 text-destructive" : "bg-primary/12 text-primary")}>
      {t(`history.kind.${kind}`)}
    </Badge>
  );
}

/** Dot + label for anything but "succeeded", which the outcome numbers already say. */
export function StateBadge({ state }: { state: HistoryState }) {
  const { t } = useTranslation();
  if (state === "succeeded") return null;
  const tone: Tone | "muted" = state === "failed" || state === "running" || state === "queued" ? "danger" : "muted";
  return (
    <StatusDot tone={tone} spinning={state === "running" || state === "queued"}>
      <span className="text-[13px]">{t(`history.state.${state}`)}</span>
    </StatusDot>
  );
}

/** One "<n> label" pair; renders nothing for zero so rows only say what happened. */
export function Stat({ n, label, tone = "default" }: { n: number; label: string; tone?: Tone | "muted" }) {
  if (!n) return null;
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-destructive" : tone === "muted" ? "text-muted-foreground" : "text-card-foreground";
  return (
    <span className="whitespace-nowrap">
      <b className={cn("font-medium tabular", color)}>{n}</b> {label}
    </span>
  );
}

/** The outcome column of a list row. */
export function Outcome({ e }: { e: HistoryEntry }) {
  const { t } = useTranslation();
  const c = entryCounts(e);
  if (e.state !== "succeeded") {
    return (
      <>
        <StateBadge state={e.state} />
        {e.kind === "nuke" ? (
          <>
            <Stat n={c.deleted} label={t("history.stats.deleted")} tone="ok" />
            <Stat n={c.failed} label={t("history.stats.failed")} tone="danger" />
          </>
        ) : (
          <Stat n={c.found} label={t("history.stats.found")} />
        )}
      </>
    );
  }
  return e.kind === "scan" ? (
    <>
      <Stat n={c.found} label={t("history.stats.found")} />
      <Stat n={c.protected} label={t("history.stats.protected")} tone="warn" />
      <Stat n={c.errors} label={t("history.stats.errors")} tone="danger" />
    </>
  ) : (
    <>
      <Stat n={c.deleted} label={t("history.stats.deleted")} tone="ok" />
      <Stat n={c.gone} label={t("history.stats.gone")} tone="muted" />
      <Stat n={c.retry} label={t("history.stats.retry")} tone="warn" />
      <Stat n={c.failed} label={t("history.stats.failed")} tone="danger" />
    </>
  );
}

/** Card for a job that is still running, shown above the list. */
export function LiveJobCard({ job }: { job: JobBrief }) {
  const { t, i18n } = useTranslation();
  const nuke = job.mode === "nuke";
  const started = job.startedAt ?? job.createdAt;
  const elapsed = useElapsedSeconds(started);
  const done = job.deleted + job.warned + job.failed;
  const pairs = job.regions.length * job.resourceTypes.length;
  const pct = nuke ? (job.selected > 0 ? (done / job.selected) * 100 : 3) : pairs > 0 ? Math.min(100, (job.scanned / pairs) * 100) : 3;
  const title = job.state === "queued" ? t("history.live.queued") : nuke ? (job.phase === "rescan" ? t("history.live.rescan") : t("history.live.nuke")) : t("history.live.scan");

  return (
    <div className="mb-7 grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3.5 rounded-xl border border-border bg-card px-4.5 py-4 shadow-xs">
      <span className={cn("grid h-[22px] place-items-center", nuke ? "text-destructive" : "text-primary")}>
        <Spinner className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 leading-[22px] font-semibold text-card-foreground">
          <span>{title}</span>
          <span className="truncate font-mono text-[13px] font-medium text-muted-foreground">
            {job.accountId} · {job.regions.join(", ")}
          </span>
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          {t("history.live.startedAt")} {formatTime(new Date(started), i18n.language)} · {t("history.live.elapsed")} {formatDur(elapsed, t)}
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("progress-striped h-full rounded-full transition-[width] duration-300", nuke ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          {nuke ? (
            <>
              <span>
                <b className="font-medium tabular text-card-foreground">{done}</b> / {job.selected}
              </span>
              <Stat n={job.deleted} label={t("history.stats.deleted")} tone="ok" />
              <Stat n={job.warned} label={t("history.stats.retry")} tone="warn" />
              <Stat n={job.failed} label={t("history.stats.failed")} tone="danger" />
            </>
          ) : (
            <>
              <Stat n={job.found} label={t("history.stats.found")} />
              <Stat n={job.errors} label={t("history.stats.errors")} tone="danger" />
            </>
          )}
        </div>
      </div>
      <Button variant="outline" render={<Link to={jobPath(job)} />}>
        {t("history.live.view")}
      </Button>
    </div>
  );
}

function useElapsedSeconds(since: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
}

// ---- formatting

export function formatTime(d: Date, lang: string) {
  return d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDateTime(d: Date, lang: string) {
  return d.toLocaleString(lang, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDur(s: number, t: (key: string, opts?: Record<string, unknown>) => string) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? t("history.durMin", { m, s: String(r).padStart(2, "0") }) : t("history.durSec", { s: r });
}

/** Seconds between creation and completion, or null while unfinished. */
export function durationOf(e: HistoryEntry): number | null {
  if (!e.finishedAt) return null;
  return Math.max(0, Math.round((new Date(e.finishedAt).getTime() - new Date(e.createdAt).getTime()) / 1000));
}

/** "Today" / "Yesterday" / a short date, in the UI language. */
export function dayLabel(d: Date, lang: string, t: (key: string) => string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return t("history.today");
  if (diff === 1) return t("history.yesterday");
  return d.toLocaleDateString(lang, { month: "long", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

/** "us-east-1, eu-west-1 +2" */
export function regionsShort(r: string[]): string {
  return r.length <= 2 ? r.join(", ") : `${r.slice(0, 2).join(", ")} +${r.length - 2}`;
}
