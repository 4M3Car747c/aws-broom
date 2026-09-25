import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { ExpandButton, Note, PageHeader, ProgressBar, Rail, RailCard, StatTile, StatusDot, Tiles, Toolbar, TwoCol } from "~/components/bits";
import { TerminalDialog } from "~/components/terminal-dialog";
import { Stepper } from "~/components/stepper";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { toast } from "~/components/ui/toast";
import { ApiError, api, isTerminal, type DeleteResult } from "~/lib/api";
import { downloadJSON, saveHistory } from "~/lib/history";
import { isSessionError, useSession } from "~/lib/session";
import { useJob } from "~/lib/use-job";
import { useWizard } from "~/lib/wizard";
import { toHistory } from "./scan";
import { i18n } from "~/lib/i18n";

export function meta() {
  return [{ title: `${i18n.t("steps.clean")} · AWS Broom` }];
}

export default function Clean() {
  const { t } = useTranslation();
  const [viewer, setViewer] = useState(false);
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { expire } = useSession();
  const wiz = useWizard();
  const { job, error, sessionExpired } = useJob(jobId);
  const [stopping, setStopping] = useState(false);
  const saved = useRef(false);

  useEffect(() => {
    if (!sessionExpired) return;
    toast.add({ title: t("common.sessionExpired"), type: "error" });
    expire();
  }, [sessionExpired, expire, t]);

  useEffect(() => {
    if (!job || !isTerminal(job.state) || saved.current) return;
    saved.current = true;
    void saveHistory(toHistory(job));
  }, [job]);

  const rescan = useMutation({
    mutationFn: () => {
      wiz.setRegions(job!.spec.regions);
      wiz.setResourceTypes(job!.spec.resourceTypes);
      return api.createScan({
        regions: job!.spec.regions,
        resourceTypes: job!.spec.resourceTypes,
        olderThanHours: job!.spec.olderThan ? Math.round(parseGoDuration(job!.spec.olderThan) / 3600) : undefined,
      });
    },
    onSuccess: (res) => navigate(`/wizard/scan/${res.jobId}`),
    onError: (err) => {
      if (isSessionError(err)) {
        expire();
        return;
      }
      toast.add({ title: t("common.unknownError"), description: err instanceof ApiError ? err.message : String(err), type: "error" });
    },
  });

  if (error && !job) {
    return (
      <>
        <Stepper current="clean" />
        <p className="text-muted-foreground">{t("job.notFound")}</p>
        <Button className="mt-4" render={<Link to="/history" />}>
          {t("app.nav.history")}
        </Button>
      </>
    );
  }
  if (!job) {
    return (
      <>
        <Stepper current="clean" />
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Spinner /> {t("common.loading")}
        </div>
      </>
    );
  }

  const running = !isTerminal(job.state);
  const total = job.spec.selections?.length ?? 0;
  const results = job.results;
  const deleted = results.filter((r) => r.success).length;
  const warned = results.filter((r) => !r.success && r.warning).length;
  const failed = results.filter((r) => !r.success && !r.warning).length;
  const remaining = Math.max(0, total - results.length);
  const pct = total > 0 ? (results.length / total) * 100 : running ? 5 : 100;
  const title =
    job.state === "succeeded"
      ? t("clean.titleDone")
      : job.state === "failed"
        ? t("clean.titleFailed")
        : job.state === "cancelled"
          ? t("clean.titleCancelled")
          : t("clean.titleRunning", { n: total });

  const byRegion = [...new Set((job.spec.selections ?? []).map((s) => s.region))].map((r) => ({
    region: r,
    total: (job.spec.selections ?? []).filter((s) => s.region === r).length,
    done: results.filter((x) => x.region === r).length,
  }));

  const pending: DeleteResult[] = (job.spec.selections ?? [])
    .filter((s) => !results.some((r) => r.resourceType === s.resourceType && r.region === s.region && r.identifier === s.identifier))
    .map((s) => ({ ...s, success: false, note: "pending" }));

  async function stop() {
    if (!jobId) return;
    setStopping(true);
    try {
      await api.cancelJob(jobId);
      // Stay disabled until the stream reports the cancelled state.
    } catch (e) {
      setStopping(false);
      toast.add({ title: t("common.unknownError"), description: String(e), type: "error" });
    }
  }

  return (
    <>
      <Stepper current="clean" />
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            {running && <Spinner className="text-destructive" />}
            {title}
          </span>
        }
        sub={running && job.phase === "rescan" ? t("clean.phase.rescan") : t("clean.sub")}
      />

      <Tiles>
        <StatTile label={t("clean.tiles.deleted")} value={deleted} tone="ok" />
        <StatTile label={t("clean.tiles.retry")} value={warned} tone={warned ? "warn" : "default"} />
        <StatTile label={t("clean.tiles.failed")} value={failed} tone={failed ? "danger" : "default"} />
        <StatTile label={t("clean.tiles.remaining")} value={running ? remaining : 0} />
      </Tiles>
      <div className="mb-4">
        <ProgressBar value={pct} tone="danger" striped={running} />
      </div>

      {job.error && (
        <div className="mb-4">
          <Note tone="warn">
            <b className="font-medium">{t(`job.state.${job.state}`)}</b> · {job.error}
          </Note>
        </div>
      )}

      <TwoCol
        rail={
          <Rail>
            <Toolbar className="mb-0">
{
        running ? (
              <Button variant="outline" onClick={() => void stop()} disabled={stopping}>
                {t("clean.stop")}
              </Button>
            ) : (
              <Button variant="outline" render={<Link to="/history" />}>
                {t("clean.done")}
              </Button>
            )
}
            </Toolbar>
            <RailCard title={t("clean.byRegion")}>
              <div className="grid gap-1.5">
                {byRegion.map((r) => (
                  <div
                    key={r.region}
                    className={
                      "flex items-center justify-between rounded-md px-2.5 py-1.5 font-mono text-[11.5px] " +
                      (r.done >= r.total ? "bg-ok/12 text-ok" : running ? "bg-primary/12 text-primary" : "bg-muted text-foreground/80")
                    }
                  >
                    <span>{r.region}</span>
                    <span>
                      {r.done}/{r.total}
                    </span>
                  </div>
                ))}
              </div>
            </RailCard>
            <RailCard title={t("clean.whenDone")}>
              <p className="text-xs text-muted-foreground">{t("clean.whenDoneBody")}</p>
              <div className="mt-3 grid gap-2">
                <Button variant="outline" disabled={running || rescan.isPending} onClick={() => rescan.mutate()}>
                  {rescan.isPending ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
                  {t("clean.scanAgain")}
                </Button>
                <Button variant="ghost" disabled={running} onClick={() => downloadJSON(`broom-clean-${job.id}.json`, toHistory(job))}>
                  <DownloadIcon data-icon="inline-start" />
                  {t("clean.export")}
                </Button>
              </div>
            </RailCard>
            {job.logTail && job.logTail.length > 0 && (
              <RailCard title={t("scan.logs")} action={<ExpandButton label={t("common.expand")} onClick={() => setViewer(true)} />}>
                <pre className="-mr-2 max-h-56 overflow-auto pr-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{job.logTail.join("\n")}</pre>
              </RailCard>
            )}
          </Rail>
        }
      >
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>{t("common.identifier")}</TableHead>
                <TableHead>{t("common.region")}</TableHead>
                <TableHead>{t("common.type")}</TableHead>
                <TableHead className="w-60">{t("common.result")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...results].reverse().map((r) => (
                <ResultRow key={`${r.resourceType}|${r.region}|${r.identifier}`} r={r} />
              ))}
              {pending.map((r) => (
                <ResultRow key={`p|${r.resourceType}|${r.region}|${r.identifier}`} r={r} running={running} />
              ))}
            </TableBody>
          </Table>
        </div>
      </TwoCol>

      <TerminalDialog open={viewer} onOpenChange={setViewer} title={t("scan.logs")} lines={job.logTail ?? []} live={running} />
    </>
  );
}

function ResultRow({ r, running }: { r: DeleteResult; running?: boolean }) {
  const { t } = useTranslation();
  let status: React.ReactNode;
  if (r.note === "pending") {
    status = <StatusDot tone="muted" spinning={running}>{t("clean.status.pending")}</StatusDot>;
  } else if (r.success) {
    status = <StatusDot tone="ok">{r.note === "already_gone" ? t("clean.status.gone") : t("clean.status.deleted")}</StatusDot>;
  } else if (r.warning) {
    status = (
      <StatusDot tone="warn">
        <span className="truncate" title={r.error}>
          {shortError(r.error)} · {t("clean.status.retry")}
        </span>
      </StatusDot>
    );
  } else {
    status = (
      <StatusDot tone="danger">
        <span className="truncate" title={r.error}>
          {shortError(r.error)}
        </span>
      </StatusDot>
    );
  }
  return (
    <TableRow className={r.note === "pending" ? "opacity-60" : undefined}>
      <TableCell className="max-w-[420px] truncate font-mono text-xs" title={r.identifier}>
        {r.identifier}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{r.region}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{r.resourceType}</TableCell>
      <TableCell className="max-w-60">{status}</TableCell>
    </TableRow>
  );
}

function shortError(err?: string): string {
  if (!err) return "";
  const m = /api error ([A-Za-z.]+)/.exec(err);
  if (m) return m[1];
  return err.length > 60 ? err.slice(0, 60) + "…" : err;
}

function parseGoDuration(s: string): number {
  // "24h0m0s" -> seconds
  let total = 0;
  const re = /(\d+(?:\.\d+)?)(h|m|s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const v = parseFloat(m[1]);
    total += m[2] === "h" ? v * 3600 : m[2] === "m" ? v * 60 : v;
  }
  return total;
}
