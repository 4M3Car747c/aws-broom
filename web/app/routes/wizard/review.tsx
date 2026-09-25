import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCwIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { cn } from "cn";

import { PageHeader, StatTile, StatusDot, Tiles, WizardNav } from "~/components/bits";
import { Stepper } from "~/components/stepper";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger } from "~/components/ui/select";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Spinner } from "~/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { toast } from "~/components/ui/toast";
import { ApiError, api, isTerminal, selectionKey, type FoundResource, type Service } from "~/lib/api";
import { serviceName } from "~/lib/labels";
import { isSessionError, useSession } from "~/lib/session";
import { useJob } from "~/lib/use-job";
import { i18n } from "~/lib/i18n";

/** Sentinel value for the region filter meaning "no filter". */
const ALL = "__all__";

/** Count pill on the right of a region row; fills with the primary colour on the selected row. */
function RegionCount({ n }: { n: number }) {
  return (
    <span className="ml-auto rounded-full bg-muted px-1.5 py-px font-mono text-[10.5px] leading-4 text-muted-foreground tabular in-data-selected:bg-primary in-data-selected:text-primary-foreground">
      {n}
    </span>
  );
}

export function meta() {
  return [{ title: `${i18n.t("steps.review")} · AWS Broom` }];
}

export default function Review() {
  const { t, i18n } = useTranslation();
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { info, expire } = useSession();
  const { job, error } = useJob(jobId);
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: api.catalog, staleTime: Infinity });

  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState("");

  const typeToService = useMemo(() => {
    const m = new Map<string, Service>();
    for (const s of catalog.data?.services ?? []) for (const r of s.resourceTypes) m.set(r.id, s);
    return m;
  }, [catalog.data]);

  // Default selection: every deletable resource.
  useEffect(() => {
    if (!job || selected !== null || !isTerminal(job.state)) return;
    setSelected(new Set(job.found.filter((f) => f.nukable).map(selectionKey)));
  }, [job, selected]);

  const groups = useMemo(() => {
    if (!job) return [];
    const q = search.trim().toLowerCase();
    const byService = new Map<string, FoundResource[]>();
    for (const f of job.found) {
      if (region && f.region !== region) continue;
      if (q && !f.identifier.toLowerCase().includes(q) && !f.resourceType.includes(q)) continue;
      const sid = typeToService.get(f.resourceType)?.id ?? "other";
      const list = byService.get(sid) ?? [];
      list.push(f);
      byService.set(sid, list);
    }
    const order = (catalog.data?.services ?? []).map((s) => s.id);
    return [...byService.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([sid, items]) => ({ sid, items, global: items.every((i) => i.region === "global") }));
  }, [job, search, region, typeToService, catalog.data]);

  const nuke = useMutation({
    mutationFn: () =>
      api.createNuke({
        scanJobId: job!.id,
        confirmAccountId: confirmId.trim(),
        selections: job!.found.filter((f) => selected?.has(selectionKey(f))).map(({ resourceType, region, identifier }) => ({ resourceType, region, identifier })),
      }),
    onSuccess: (res) => navigate(`/wizard/clean/${res.jobId}`),
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
        <Stepper current="review" />
        <p className="text-muted-foreground">{t("job.notFound")}</p>
        <Button className="mt-4" render={<Link to="/wizard/services" />}>
          {t("scan.changeSelection")}
        </Button>
      </>
    );
  }
  if (!job || selected === null) {
    return (
      <>
        <Stepper current="review" />
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Spinner /> {t("common.loading")}
        </div>
      </>
    );
  }

  const found = job.found;
  const deletable = found.filter((f) => f.nukable);
  const protectedN = found.length - deletable.length;
  const selN = selected.size;
  const keptN = deletable.length - selN;
  const regions = [...new Set(found.map((f) => f.region))].sort((a, b) => (a === "global" ? 1 : b === "global" ? -1 : a.localeCompare(b)));
  const regionCounts = found.reduce((m, f) => m.set(f.region, (m.get(f.region) ?? 0) + 1), new Map<string, number>());
  const regionItems = [{ value: ALL, label: t("review.allRegions") }, ...regions.map((r) => ({ value: r, label: r }))];
  const services = new Set(found.map((f) => typeToService.get(f.resourceType)?.id ?? "other"));
  const selServices = new Set(found.filter((f) => selected.has(selectionKey(f))).map((f) => typeToService.get(f.resourceType)?.id ?? "other"));
  const selRegions = new Set(found.filter((f) => selected.has(selectionKey(f))).map((f) => f.region));
  const selGlobal = found.filter((f) => selected.has(selectionKey(f)) && f.region === "global").length;

  const toggle = (f: FoundResource) => {
    if (!f.nukable) return;
    const k = selectionKey(f);
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const setMany = (items: FoundResource[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const f of items) {
        if (!f.nukable) continue;
        if (on) next.add(selectionKey(f));
        else next.delete(selectionKey(f));
      }
      return next;
    });

  const visible = groups.flatMap((g) => g.items);
  const visibleDeletable = visible.filter((f) => f.nukable);
  const visibleSel = visibleDeletable.filter((f) => selected.has(selectionKey(f))).length;
  const headState = visibleDeletable.length === 0 ? false : visibleSel === visibleDeletable.length ? true : visibleSel > 0 ? "mixed" : false;

  return (
    <>
      <Stepper current="review" />
      <PageHeader
        title={t("review.title")}
        sub={t("review.sub", { account: job.accountId })}
      />

      <Tiles>
        <StatTile label={t("review.tiles.regions")} value={regions.filter((r) => r !== "global").length} suffix={regions.includes("global") ? t("common.plusGlobal") : undefined} />
        <StatTile label={t("review.tiles.services")} value={services.size} />
        <StatTile label={t("review.tiles.found")} value={found.length} />
        <StatTile label={t("review.tiles.protected")} value={protectedN} tone={protectedN ? "warn" : "default"} />
      </Tiles>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 w-56 pl-8" placeholder={t("review.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={region ?? ALL} onValueChange={(v) => setRegion(v === ALL ? null : v)} items={regionItems}>
          <SelectTrigger
            aria-label={t("common.region")}
            className={cn(
              "h-8 gap-2 rounded-lg border-input bg-card pr-2 pl-3 shadow-xs transition-colors hover:bg-muted data-popup-open:bg-muted",
              region && "border-primary/40",
            )}
          >
            <span className="text-muted-foreground">{t("common.region")}</span>
            <span className={cn("font-medium text-card-foreground", region && "font-mono font-normal")}>{region ?? t("review.allRegions")}</span>
            {region && <span className="rounded-full bg-primary px-1.5 py-px font-mono text-[10.5px] leading-4 text-primary-foreground tabular">{regionCounts.get(region) ?? 0}</span>}
          </SelectTrigger>
          <SelectContent align="start" sideOffset={6} alignItemWithTrigger={false} className="w-auto min-w-[260px] rounded-xl p-1 shadow-lg">
            <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{t("review.filterByRegion")}</div>
            <SelectItem value={ALL} className="h-8 rounded-md pl-2 in-data-selected:bg-accent">
              <span className="font-medium">{t("review.allRegions")}</span>
              <RegionCount n={found.length} />
            </SelectItem>
            <SelectSeparator className="my-1" />
            {regions.map((r, i) => (
              <Fragment key={r}>
                {r === "global" && i > 0 && <SelectSeparator className="my-1" />}
                <SelectItem value={r} className="h-8 rounded-md pl-2 in-data-selected:bg-accent">
                  <span className="font-mono">{r}</span>
                  <RegionCount n={regionCounts.get(r) ?? 0} />
                </SelectItem>
              </Fragment>
            ))}
          </SelectContent>
        </Select>
        <span className="flex-1" />
        <Button size="sm" variant="outline" render={<Link to="/wizard/services" />}>
          <RefreshCwIcon data-icon="inline-start" />
          {t("review.rescan")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMany(deletable, true)}>
          {t("review.selectDeletable")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
          {t("common.clear")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="w-9">
                <Checkbox checked={headState === true} indeterminate={headState === "mixed"} onCheckedChange={(v) => setMany(visible, Boolean(v))} />
              </TableHead>
              <TableHead>{t("common.identifier")}</TableHead>
              <TableHead>{t("common.region")}</TableHead>
              <TableHead>{t("common.type")}</TableHead>
              <TableHead className="w-40">{t("common.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {t("review.noMatches")}
                </TableCell>
              </TableRow>
            )}
            {groups.map((g) => {
              const del = g.items.filter((i) => i.nukable);
              const k = del.filter((i) => selected.has(selectionKey(i))).length;
              const gState = del.length === 0 ? false : k === del.length ? true : k > 0 ? "mixed" : false;
              return (
                <GroupRows key={g.sid}>
                  <TableRow className="bg-muted/70 hover:bg-muted/70">
                    <TableCell>
                      <Checkbox checked={gState === true} indeterminate={gState === "mixed"} onCheckedChange={(v) => setMany(g.items, Boolean(v))} disabled={del.length === 0} />
                    </TableCell>
                    <TableCell colSpan={4} className="font-medium">
                      {serviceName(g.sid, i18n.language)}
                      <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                        {k} / {g.items.length}
                      </span>
                      {g.global && (
                        <Badge variant="outline" className="ml-2 h-[18px]">
                          {t("common.global")}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                  {g.items.map((f) => {
                    const on = selected.has(selectionKey(f));
                    return (
                      <TableRow key={selectionKey(f)} className={cn(!f.nukable && "opacity-60")} onClick={() => toggle(f)}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={on} disabled={!f.nukable} onCheckedChange={() => toggle(f)} />
                        </TableCell>
                        <TableCell className="max-w-[420px] truncate font-mono text-xs" title={f.identifier}>
                          {f.identifier}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{f.region}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{f.resourceType}</TableCell>
                        <TableCell>
                          {!f.nukable ? (
                            <StatusDot tone="warn">
                              <span className="truncate" title={f.reason}>
                                {f.reason || t("scan.protected")}
                              </span>
                            </StatusDot>
                          ) : on ? (
                            <StatusDot tone="ok">{f.resourceType === "s3" ? t("review.emptyThenDelete") : t("review.willDelete")}</StatusDot>
                          ) : (
                            <StatusDot tone="muted">{t("review.keep")}</StatusDot>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </GroupRows>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <WizardNav back={`/wizard/scan/${job.id}`} backLabel={t("steps.scan")}>
        <Button size="lg" variant="destructive" className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={selN === 0} onClick={() => setOpen(true)}>
          <Trash2Icon data-icon="inline-start" />
          {t("review.deleteN", { n: selN })}
        </Button>
      </WizardNav>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="text-xs font-semibold tracking-widest text-destructive uppercase">{t("review.dialog.eyebrow")}</div>
            <AlertDialogTitle>{t("review.dialog.title", { n: selN, account: job.accountId })}</AlertDialogTitle>
            <AlertDialogDescription>{t("review.dialog.body", { n: selN })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-3 gap-2">
            <Mini label={t("review.dialog.regions")} value={`${[...selRegions].filter((r) => r !== "global").length}${selRegions.has("global") ? "+1" : ""}`} />
            <Mini label={t("review.dialog.services")} value={selServices.size} />
            <Mini label={t("review.dialog.global")} value={selGlobal} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-account">{t("review.dialog.typeAccount")}</Label>
            <Input id="confirm-account" className="font-mono" placeholder={job.accountId} value={confirmId} onChange={(e) => setConfirmId(e.target.value)} autoComplete="off" />
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={confirmId.trim() !== (info?.accountId ?? job.accountId) || nuke.isPending}
              onClick={() => nuke.mutate()}
            >
              {nuke.isPending && <Spinner />}
              {t("review.dialog.confirm", { n: selN })}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function GroupRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}


function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}
