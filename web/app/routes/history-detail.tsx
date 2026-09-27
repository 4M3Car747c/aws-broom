import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { cn } from "cn";

import { Note, PageHeader, StatTile, StatusDot, Tiles } from "~/components/bits";
import { KindTag, StateBadge, durationOf, formatDateTime, formatDur } from "~/components/history-bits";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { toast } from "~/components/ui/toast";
import { ApiError, api } from "~/lib/api";
import { deleteHistory, downloadJSON, entryCounts, isHistoryTerminal, olderThanHours, resultKind, listHistory, type HistoryEntry, type ResultKind } from "~/lib/history";
import { jobPath } from "~/lib/jobs";
import { isSessionError, useSession } from "~/lib/session";
import { presetWizard } from "~/lib/wizard";
import { i18n } from "~/lib/i18n";

export function meta() {
  return [{ title: `${i18n.t("app.nav.history")} · AWS Broom` }];
}

type Tab = "all" | ResultKind | "nukable" | "protected";

interface RowData {
  identifier: string;
  region: string;
  resourceType: string;
  kind: Exclude<Tab, "all">;
  detail?: string;
}

export default function HistoryDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { status, expire } = useSession();
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const q = useQuery({ queryKey: ["history"], queryFn: listHistory, staleTime: 0 });
  const e = q.data?.find((x) => x.id === id);

  const rescan = useMutation({
    mutationFn: async (entry: HistoryEntry) => {
      const hours = olderThanHours(entry.olderThan);
      presetWizard({ regions: entry.regions, resourceTypes: entry.resourceTypes, olderThanHours: hours });
      if (status !== "authed") return null;
      return api.createScan({ regions: entry.regions, resourceTypes: entry.resourceTypes, olderThanHours: hours ?? undefined });
    },
    onSuccess: (res) => navigate(res ? `/wizard/scan/${res.jobId}` : "/connect"),
    onError: (err) => {
      if (isSessionError(err)) {
        expire();
        navigate("/connect");
        return;
      }
      toast.add({ title: t("common.unknownError"), description: err instanceof ApiError ? err.message : String(err), type: "error" });
    },
  });

  const rows = useMemo<RowData[]>(() => {
    if (!e) return [];
    if (e.kind === "nuke") {
      return (e.results ?? []).map((r) => ({ identifier: r.identifier, region: r.region, resourceType: r.resourceType, kind: resultKind(r), detail: r.error }));
    }
    return (e.found ?? []).map((f) => ({ identifier: f.identifier, region: f.region, resourceType: f.resourceType, kind: f.nukable ? "nukable" : "protected", detail: f.reason }));
  }, [e]);

  const tabs: Tab[] = e?.kind === "nuke" ? ["all", "deleted", "gone", "retry", "fail"] : ["all", "nukable", "protected"];
  const count = (k: Tab) => (k === "all" ? rows.length : rows.filter((r) => r.kind === k).length);
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((r) => (tab === "all" || r.kind === tab) && (!needle || r.identifier.toLowerCase().includes(needle)));

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground">
        <Spinner /> {t("common.loading")}
      </div>
    );
  }
  if (!e) {
    return (
      <>
        <BackLink />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("history.notFound")}</EmptyTitle>
            <EmptyDescription>{t("history.notFoundBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  const nuke = e.kind === "nuke";
  const c = entryCounts(e);
  const dur = durationOf(e);
  const lost = e.state === "lost";
  const live = !isHistoryTerminal(e.state);
  const hours = olderThanHours(e.olderThan);

  return (
    <>
      <BackLink />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>
              {t(`history.kind.${e.kind}`)}
              <span className="ml-1.5 font-mono text-lg font-medium text-muted-foreground">{e.accountId}</span>
            </span>
            <StateBadge state={e.state} />
          </span>
        }
        sub={
          <span className="flex flex-wrap gap-x-4.5 gap-y-1.5 text-[13px]">
            <span className="font-mono text-foreground">{formatDateTime(new Date(e.createdAt), i18n.language)}</span>
            {dur !== null && (
              <span>
                {t("history.stats.duration")} <span className="font-mono text-foreground">{formatDur(dur, t)}</span>
              </span>
            )}
            <span>
              {t("common.regions")} <span className="font-mono text-foreground">{e.regions.join(", ")}</span>
            </span>
            <span>{t("history.stats.typesN", { n: e.resourceTypes.length })}</span>
            {hours !== null && <span>{t("history.stats.olderThan", { h: hours })}</span>}
            {nuke && e.selected ? (
              <span>
                {t("history.stats.selected")} <span className="font-mono text-foreground">{e.selected}</span>
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" disabled={lost || live} onClick={() => downloadJSON(`broom-${e.kind}-${e.id}.json`, e)}>
              {t("history.export")}
            </Button>
            <Button variant="outline" disabled={rescan.isPending} onClick={() => rescan.mutate(e)}>
              {rescan.isPending && <Spinner />}
              {t("history.rescan")}
            </Button>
            <Button variant="ghost" className="hover:bg-destructive/9 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              {t("history.delete")}
            </Button>
          </>
        }
      />

      {!lost && !live && (
        <Tiles>
          {nuke ? (
            <>
              <StatTile label={t("history.stats.deleted")} value={c.deleted} tone="ok" />
              <StatTile label={t("history.stats.gone")} value={c.gone} />
              <StatTile label={t("history.stats.retry")} value={c.retry} tone={c.retry ? "warn" : "default"} />
              <StatTile label={t("history.stats.failed")} value={c.failed} tone={c.failed ? "danger" : "default"} />
            </>
          ) : (
            <>
              <StatTile label={t("history.stats.found")} value={c.found} />
              <StatTile label={t("history.stats.nukable")} value={c.nukable} tone="ok" />
              <StatTile label={t("history.stats.protected")} value={c.protected} tone={c.protected ? "warn" : "default"} />
              <StatTile label={t("history.stats.errors")} value={c.errors} tone={c.errors ? "danger" : "default"} />
            </>
          )}
        </Tiles>
      )}

      {lost && (
        <div className="mb-4">
          <Note tone="warn">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span className="max-w-[60em]">{t("history.lostBody")}</span>
            </span>
          </Note>
        </div>
      )}
      {live && (
        <div className="mb-4">
          <Note>
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span>{t("history.runningBody")}</span>
              <Button size="sm" variant="outline" render={<Link to={jobPath({ id: e.id, mode: e.kind })} />}>
                {t("history.view")}
              </Button>
            </span>
          </Note>
        </div>
      )}
      {e.state === "failed" && e.error && (
        <div className="mb-4">
          <Note tone="warn">
            {t("history.failedBody")} <span className="font-mono text-[13px]">{e.error}</span>
          </Note>
        </div>
      )}

      {!lost && !live && (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="flex flex-wrap items-center gap-3 border-b border-border py-2.5 pr-3 pl-3.5">
            <div className="flex flex-wrap gap-0.5">
              {tabs.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={tab === k}
                  onClick={() => setTab(k)}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-accent aria-pressed:text-card-foreground"
                >
                  {t(`history.result.${k}`)}
                  <span className="font-normal text-muted-foreground tabular">{count(k)}</span>
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <label className="flex h-8 w-60 items-center gap-2 rounded-lg bg-muted px-2.5 text-muted-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring">
              <SearchIcon className="size-3.5" aria-hidden="true" />
              <input
                id="history-search"
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
                placeholder={t("history.searchPh")}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>{t("common.identifier")}</TableHead>
                <TableHead className="w-32">{t("common.region")}</TableHead>
                <TableHead className="w-40">{t("common.type")}</TableHead>
                <TableHead className="w-52">{t("common.result")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={`${r.resourceType}|${r.region}|${r.identifier}`}>
                  <TableCell className="max-w-[440px] truncate font-mono text-xs" title={r.identifier}>
                    {r.identifier}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.region}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.resourceType}</TableCell>
                  <TableCell>
                    <ResultCell r={r} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex h-10 items-center justify-between border-t border-border px-3.5 text-xs text-muted-foreground">
            <span className="tabular">{t("history.shown", { a: shown.length, b: rows.length })}</span>
            <span className="font-mono">{e.id}</span>
          </div>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("history.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("history.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmDelete(false);
                void deleteHistory(e.id)
                  .then(() => qc.invalidateQueries({ queryKey: ["history"] }))
                  .then(() => navigate("/history", { replace: true }));
              }}
            >
              {t("history.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link to="/history" className="-ml-1 mb-3.5 inline-flex h-7 items-center gap-1 rounded-md px-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
      <ChevronLeftIcon className="size-4" aria-hidden="true" />
      {t("history.title")}
    </Link>
  );
}

function ResultCell({ r }: { r: RowData }) {
  const { t } = useTranslation();
  const tone = r.kind === "deleted" || r.kind === "nukable" ? "ok" : r.kind === "gone" ? "muted" : r.kind === "retry" || r.kind === "protected" ? "warn" : "danger";
  return (
    <StatusDot tone={tone}>
      <span className={cn("truncate", r.kind === "gone" && "opacity-80")} title={r.detail}>
        {t(`history.result.${r.kind}`)}
      </span>
    </StatusDot>
  );
}
