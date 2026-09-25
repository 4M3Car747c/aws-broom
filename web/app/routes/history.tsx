import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, EllipsisIcon, EyeIcon, Trash2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { cn } from "cn";

import { PageHeader } from "~/components/bits";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { clearHistory, deleteHistory, downloadJSON, listHistory, type HistoryEntry } from "~/lib/history";
import { useSession } from "~/lib/session";
import { i18n } from "~/lib/i18n";

export function meta() {
  return [{ title: `${i18n.t("app.nav.history")} · AWS Broom` }];
}

export default function History() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { status } = useSession();
  const q = useQuery({ queryKey: ["history"], queryFn: listHistory, staleTime: 0 });
  const entries = q.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["history"] });

  return (
    <>
      <PageHeader
        title={t("history.title")}
        sub={t("history.sub")}
        actions={
          entries.length > 0 && (
            <Button size="sm" onClick={() => void clearHistory().then(refresh)}>
              {t("history.clear")}
            </Button>
          )
        }
      />
      {entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("history.empty")}</EmptyTitle>
            <EmptyDescription>{t("history.emptyBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-2.5">
          {entries.map((e) => (
            <Entry key={e.id} e={e} lang={i18n.language} authed={status === "authed"} onDelete={() => void deleteHistory(e.id).then(refresh)} />
          ))}
        </div>
      )}
    </>
  );
}

function Entry({ e, lang, authed, onDelete }: { e: HistoryEntry; lang: string; authed: boolean; onDelete: () => void }) {
  const { t } = useTranslation();
  const when = new Date(e.createdAt);
  const dur = e.finishedAt ? Math.max(0, Math.round((new Date(e.finishedAt).getTime() - when.getTime()) / 1000)) : null;
  const s = e.summary;
  const stats =
    e.kind === "scan"
      ? [
          [s?.found ?? e.found?.length ?? 0, t("history.stats.found")],
          [s?.notNukable ?? 0, t("history.stats.protected")],
          [e.resourceTypes.length, t("history.stats.types")],
        ]
      : [
          [s?.deleted ?? 0, t("history.stats.deleted")],
          [s?.warned ?? 0, t("history.stats.retry")],
          [s?.failed ?? 0, t("history.stats.failed")],
        ];
  const viewTo = e.kind === "scan" ? `/wizard/review/${e.id}` : `/wizard/clean/${e.id}`;
  return (
    <div className="grid items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5 shadow-xs md:grid-cols-[auto_1fr_auto]">
      <div className="min-w-[130px] font-mono text-xs text-muted-foreground">{formatDate(when, lang)}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={cn("border-transparent", e.kind === "nuke" ? "bg-destructive/12 text-destructive" : "bg-primary/12 text-primary")}>
            {t(`history.kind.${e.kind}`)}
          </Badge>
          <span className="font-mono text-xs">{e.accountId}</span>
          <span className="text-muted-foreground">·</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{e.regions.join(", ")}</span>
          {e.state !== "succeeded" && (
            <Badge variant="outline" className="text-warn">
              {t(`history.state.${e.state}`)}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-3.5 text-xs text-muted-foreground">
          {stats.map(([v, l]) => (
            <span key={String(l)}>
              <b className="font-mono font-medium text-foreground">{v}</b> {l}
            </span>
          ))}
          {dur !== null && (
            <span>
              <b className="font-mono font-medium text-foreground">{formatDur(dur, t)}</b> {t("history.stats.duration")}
            </span>
          )}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={t("history.actions")} title={t("history.actions")} />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-40 rounded-xl p-1.5">
          <DropdownMenuItem className="gap-2.5 rounded-lg px-2.5 py-1.5" disabled={!authed} render={<Link to={viewTo} />}>
            <EyeIcon className="text-muted-foreground" />
            {t("history.view")}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5 rounded-lg px-2.5 py-1.5" onClick={() => downloadJSON(`broom-${e.kind}-${e.id}.json`, e)}>
            <DownloadIcon className="text-muted-foreground" />
            {t("history.export")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="-mx-1.5 my-1.5" />
          <DropdownMenuItem variant="destructive" className="gap-2.5 rounded-lg px-2.5 py-1.5" onClick={onDelete}>
            <Trash2Icon />
            {t("history.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function formatDate(d: Date, lang: string) {
  return d.toLocaleString(lang, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDur(s: number, t: (key: string, opts?: Record<string, unknown>) => string) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? t("history.durMin", { m, s: String(r).padStart(2, "0") }) : t("history.durSec", { s: r });
}
