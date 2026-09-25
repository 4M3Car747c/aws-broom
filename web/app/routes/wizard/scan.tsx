import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { cn } from "cn";

import { ExpandButton, Note, PageHeader, ProgressBar, Rail, RailCard, StatTile, StatusDot, Tiles, Toolbar, TwoCol, WizardNav } from "~/components/bits";
import { TerminalDialog } from "~/components/terminal-dialog";
import { Stepper } from "~/components/stepper";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { toast } from "~/components/ui/toast";
import { api, isTerminal, type Job } from "~/lib/api";
import { saveHistory } from "~/lib/history";
import { useSession } from "~/lib/session";
import { useJob } from "~/lib/use-job";
import { i18n } from "~/lib/i18n";

export function meta() {
  return [{ title: `${i18n.t("steps.scan")} · AWS Broom` }];
}

export default function Scan() {
  const { t } = useTranslation();
  const [viewer, setViewer] = useState<"errors" | "log" | null>(null);
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { job, error, sessionExpired } = useJob(jobId);
  const { expire } = useSession();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: api.catalog, staleTime: Infinity });
  const [cancelling, setCancelling] = useState(false);
  const saved = useRef(false);

  useEffect(() => {
    if (!sessionExpired) return;
    toast.add({ title: t("common.sessionExpired"), type: "error" });
    expire();
  }, [sessionExpired, expire, t]);

  const globalTypes = useMemo(() => {
    const g = new Set<string>();
    for (const s of catalog.data?.services ?? []) for (const r of s.resourceTypes) if (r.global) g.add(r.id);
    return g;
  }, [catalog.data]);

  const total = useMemo(() => {
    if (!job) return 0;
    const regional = job.spec.resourceTypes.filter((x) => !globalTypes.has(x)).length;
    const global = job.spec.resourceTypes.length - regional;
    return regional * job.spec.regions.length + global;
  }, [job, globalTypes]);

  // Persist to browser history once the job finishes.
  useEffect(() => {
    if (!job || !isTerminal(job.state) || saved.current) return;
    saved.current = true;
    void saveHistory(toHistory(job));
  }, [job]);

  if (error && !job) {
    return (
      <>
        <Stepper current="scan" />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("job.notFound")}</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
          <Button render={<Link to="/wizard/services" />}>{t("scan.changeSelection")}</Button>
        </Empty>
      </>
    );
  }
  if (!job) {
    return (
      <>
        <Stepper current="scan" />
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Spinner /> {t("common.loading")}
        </div>
      </>
    );
  }

  const running = !isTerminal(job.state);
  const found = job.found;
  const protectedN = found.filter((f) => !f.nukable).length;
  const pct = total > 0 ? Math.min(100, (job.scanned / total) * 100) : running ? 5 : 100;
  const title =
    job.state === "succeeded"
      ? t("scan.titleDone")
      : job.state === "failed"
        ? t("scan.titleFailed")
        : job.state === "cancelled"
          ? t("scan.titleCancelled")
          : t("scan.titleRunning", { account: job.accountId });

  const regionsLabel = [...job.spec.regions, ...(job.spec.resourceTypes.some((x) => globalTypes.has(x)) ? ["global"] : [])];
  const byRegion = regionsLabel.map((r) => {
    const types = r === "global" ? job.spec.resourceTypes.filter((x) => globalTypes.has(x)).length : job.spec.resourceTypes.filter((x) => !globalTypes.has(x)).length;
    // scanned pairs per region are not exposed individually; approximate from found + progress share
    return { region: r, types };
  });

  async function cancel() {
    if (!jobId) return;
    setCancelling(true);
    try {
      await api.cancelJob(jobId);
      // Stay disabled: the worker needs a moment to exit and the stream
      // will flip the state to "cancelled".
    } catch (e) {
      setCancelling(false);
      toast.add({ title: t("common.unknownError"), description: String(e), type: "error" });
    }
  }

  return (
    <>
      <Stepper current="scan" />
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            {running && <Spinner className="text-primary" />}
            {title}
          </span>
        }
        sub={t("scan.sub", { types: job.spec.resourceTypes.length, regions: regionsLabel.join(", ") })}
      />

      <Tiles>
        <StatTile label={t("scan.tiles.progress")} value={running ? job.scanned : total} suffix={`/ ${total}`} />
        <StatTile label={t("scan.tiles.found")} value={found.length} tone="ok" />
        <StatTile label={t("scan.tiles.protected")} value={protectedN} tone={protectedN ? "warn" : "default"} />
        <StatTile label={t("scan.tiles.errors")} value={job.errors.length} tone={job.errors.length ? "danger" : "default"} />
      </Tiles>
      <div className="mb-4">
        <ProgressBar value={pct} striped={running} />
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
              <Button variant="outline" onClick={() => void cancel()} disabled={cancelling}>
                {t("scan.cancel")}
              </Button>
            ) : job.state === "succeeded" && found.length > 0 ? null : (
              <Button variant="outline" render={<Link to="/wizard/services" />}>
                {t("scan.changeSelection")}
              </Button>
            )
}
            </Toolbar>
            <RailCard title={t("scan.byRegion")}>
              <div className="grid gap-1.5">
                {byRegion.map((r) => (
                  <div key={r.region} className="flex items-center justify-between rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11.5px] text-foreground/80">
                    <span>{r.region}</span>
                    <span>{r.types}</span>
                  </div>
                ))}
              </div>
            </RailCard>
            <RailCard title={t("scan.errors")} action={job.errors.length > 0 && <ExpandButton label={t("common.expand")} onClick={() => setViewer("errors")} />}>
              {job.errors.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("scan.noErrors")}</p>
              ) : (
                <ul className="-mr-2 grid max-h-64 gap-2 overflow-y-auto pr-2">
                  {job.errors.map((e, i) => (
                    <li key={i} className="rounded-lg border border-warn/30 bg-warn/12 px-3 py-2 text-xs">
                      <code className="font-mono">{e.resourceType}</code>
                      <div className="mt-0.5 line-clamp-3 break-all text-muted-foreground" title={e.error}>
                        {e.error}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </RailCard>
            {job.logTail && job.logTail.length > 0 && (
              <RailCard title={t("scan.logs")} action={<ExpandButton label={t("common.expand")} onClick={() => setViewer("log")} />}>
                <pre className="-mr-2 max-h-56 overflow-auto pr-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{job.logTail.join("\n")}</pre>
              </RailCard>
            )}
          </Rail>
        }
      >
        <div className="rounded-xl border border-border bg-card shadow-xs">
          <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
            <b className="font-medium">{t("scan.foundSoFar")}</b>
            <Badge variant="secondary">{found.length}</Badge>
            <span className="flex-1" />
            <span className="text-xs text-muted-foreground">{t("scan.live")}</span>
          </div>
          {found.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {running ? <Spinner /> : (
                <>
                  <div className="font-medium text-foreground">{t("scan.nothingFound")}</div>
                  <div className="mt-1">{t("scan.nothingFoundBody")}</div>
                </>
              )}
            </div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-muted">
                  <TableRow>
                    <TableHead>{t("common.type")}</TableHead>
                    <TableHead>{t("common.region")}</TableHead>
                    <TableHead>{t("common.identifier")}</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...found].reverse().map((f) => (
                    <TableRow key={`${f.resourceType}|${f.region}|${f.identifier}`} className={cn(!f.nukable && "opacity-70")}>
                      <TableCell className="font-mono text-xs">{f.resourceType}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{f.region}</TableCell>
                      <TableCell className="max-w-[360px] truncate font-mono text-xs" title={f.identifier}>
                        {f.identifier}
                      </TableCell>
                      <TableCell>
                        {f.nukable ? (
                          <StatusDot tone="ok" />
                        ) : (
                          <StatusDot tone="warn">
                            <span title={f.reason}>{t("scan.protected")}</span>
                          </StatusDot>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </TwoCol>

      <TerminalDialog
        open={viewer === "errors"}
        onOpenChange={(o) => !o && setViewer(null)}
        title={t("scan.errors")}
        lines={job.errors.map((e) => `${e.resourceType}: ${e.message}${e.error ? ` · ${e.error}` : ""}`)}
      />
      <TerminalDialog open={viewer === "log"} onOpenChange={(o) => !o && setViewer(null)} title={t("scan.logs")} lines={job.logTail ?? []} live={running} />

      {job.state === "succeeded" && found.length > 0 && (
        <WizardNav back="/wizard/services" backLabel={t("steps.services")}>
          <Button size="lg" onClick={() => navigate(`/wizard/review/${job.id}`)}>
            {t("scan.review")}
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        </WizardNav>
      )}
    </>
  );
}

export function toHistory(job: Job) {
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
    summary: job.summary,
    found: job.found,
    results: job.results,
    errors: job.errors,
    error: job.error,
  };
}
