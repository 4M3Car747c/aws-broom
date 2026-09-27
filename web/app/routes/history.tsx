import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { PageHeader, Segmented } from "~/components/bits";
import { KindTag, LiveJobCard, Outcome, dayLabel, durationOf, formatDur, formatTime, regionsShort } from "~/components/history-bits";
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
import { clearHistory, downloadJSON, isHistoryTerminal, listHistory, type HistoryEntry } from "~/lib/history";
import { useJobs } from "~/lib/jobs";
import { i18n } from "~/lib/i18n";

export function meta() {
  return [{ title: `${i18n.t("app.nav.history")} · AWS Broom` }];
}

type Kind = "all" | "scan" | "nuke";

export default function History() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { running } = useJobs();
  const [kind, setKind] = useState<Kind>("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const q = useQuery({ queryKey: ["history"], queryFn: listHistory, staleTime: 0 });
  const all = q.data ?? [];

  // Jobs the tracker shows live above the list stay out of the list itself.
  const liveIds = useMemo(() => new Set(running.map((j) => j.id)), [running]);
  const entries = useMemo(() => all.filter((e) => !liveIds.has(e.id) || isHistoryTerminal(e.state)), [all, liveIds]);
  const shown = useMemo(() => entries.filter((e) => kind === "all" || e.kind === kind), [entries, kind]);

  const groups = useMemo(() => {
    const out: { label: string; items: HistoryEntry[] }[] = [];
    for (const e of shown) {
      const label = dayLabel(new Date(e.createdAt), i18n.language, t);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [shown, i18n.language, t]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["history"] });
  const empty = !q.isLoading && all.length === 0 && running.length === 0;

  return (
    <>
      <PageHeader
        title={t("history.title")}
        sub={t("history.sub")}
        actions={
          all.length > 0 && (
            <>
              <Button variant="ghost" onClick={() => downloadJSON(`broom-history-${new Date().toISOString().slice(0, 10)}.json`, all)}>
                {t("history.exportAll")}
              </Button>
              <Button variant="outline" onClick={() => setConfirmClear(true)}>
                {t("history.clear")}
              </Button>
            </>
          )
        }
      />

      {running.map((j) => (
        <LiveJobCard key={j.id} job={j} />
      ))}

      {empty ? (
        <Empty className="border border-dashed border-input">
          <EmptyHeader>
            <EmptyTitle>{t("history.empty")}</EmptyTitle>
            <EmptyDescription>{t("history.emptyBody")}</EmptyDescription>
          </EmptyHeader>
          <Button size="lg" render={<Link to="/wizard" />}>
            {t("history.start")}
          </Button>
        </Empty>
      ) : (
        all.length > 0 && (
          <>
            <div className="mb-2.5 flex items-center gap-3">
              <Segmented<Kind>
                label={t("common.type")}
                value={kind}
                onChange={setKind}
                size="md"
                options={(["all", "scan", "nuke"] as Kind[]).map((k) => ({ value: k, label: t(`history.filter.${k}`) }))}
              />
              <span className="flex-1" />
              <span className="text-[13px] text-muted-foreground tabular">{t("history.records", { n: shown.length })}</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
              {groups.map((g) => (
                <div key={g.label} className="border-t border-border first:border-t-0">
                  <div className="flex h-9 items-center bg-muted px-4 text-xs font-medium text-muted-foreground">
                    {g.label}
                  </div>
                  {g.items.map((e) => (
                    <Row key={e.id} e={e} lang={i18n.language} onOpen={() => navigate(`/history/${e.id}`)} />
                  ))}
                </div>
              ))}
            </div>
          </>
        )
      )}

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("history.clearTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("history.clearBody", { n: all.length })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmClear(false);
                void clearHistory().then(refresh);
              }}
            >
              {t("history.clear")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Row({ e, lang, onOpen }: { e: HistoryEntry; lang: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const dur = durationOf(e);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid h-12 w-full grid-cols-[auto_auto_minmax(0,1fr)_24px] items-center gap-4 border-t border-border px-4 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:grid-cols-[52px_56px_128px_minmax(160px,1fr)_minmax(220px,1.2fr)_88px_24px]"
    >
      <span className="font-mono text-[13px] text-muted-foreground tabular">{formatTime(new Date(e.createdAt), lang)}</span>
      <span>
        <KindTag kind={e.kind} />
      </span>
      <span className="hidden font-mono text-xs md:block">{e.accountId}</span>
      <span className="hidden truncate font-mono text-xs text-muted-foreground md:block" title={e.regions.join(", ")}>
        {regionsShort(e.regions)}
      </span>
      <span className="flex min-w-0 items-center gap-3.5 overflow-hidden text-[13px] text-muted-foreground">
        <Outcome e={e} />
      </span>
      <span className="hidden text-right font-mono text-xs text-muted-foreground tabular md:block">{dur === null ? "—" : formatDur(dur, t)}</span>
      <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
