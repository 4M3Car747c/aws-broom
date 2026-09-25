import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { cn } from "cn";

import { Note, PageHeader, Rail, RailCard, RailRow, RiskBadge, Toolbar, TwoCol, WizardNav } from "~/components/bits";
import { Stepper } from "~/components/stepper";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Spinner } from "~/components/ui/spinner";
import { toast } from "~/components/ui/toast";
import { ApiError, api, type ResourceType, type Service } from "~/lib/api";
import { serviceName, typeLabel } from "~/lib/labels";
import { type AwsService, groupByAwsService } from "~/lib/service-icons";
import { isSessionError, useSession } from "~/lib/session";
import { useWizard } from "~/lib/wizard";
import { i18n } from "~/lib/i18n";

/** AWS service icon: the brand SVG when we have one, otherwise a short mono tile. */
export function AwsIcon({ service, size = 22, className }: { service: AwsService; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (service.icon) {
    return <img src={`/aws/${service.icon}.svg`} alt="" title={service.name} width={size} height={size} style={style} className={cn("block rounded-[5px]", className)} />;
  }
  return (
    <span
      title={service.name}
      style={style}
      className={cn("grid place-items-center rounded-[5px] bg-muted font-mono text-[9px] font-medium tracking-wide text-card-foreground", className)}
    >
      {service.mono}
    </span>
  );
}

function ServiceCard({
  s,
  sel,
  open,
  onToggleOpen,
  onToggleService,
  onToggleType,
  note,
}: {
  s: Service;
  sel: Set<string>;
  open: boolean;
  onToggleOpen: () => void;
  onToggleService: (on: boolean) => void;
  onToggleType: (id: string) => void;
  note?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const n = s.resourceTypes.length;
  const k = s.resourceTypes.filter((r) => sel.has(r.id)).length;
  const on = k === n && n > 0;
  const mixed = k > 0 && k < n;
  const off = k === 0;
  const global = s.resourceTypes.some((r) => r.global);
  const members = useMemo(() => groupByAwsService<ResourceType>(s.resourceTypes), [s.resourceTypes]);
  const shownIcons = members.slice(0, 4);

  return (
    <div className={cn("overflow-hidden rounded-[10px] border bg-card transition-[border-color,box-shadow]", off ? "border-dashed border-border" : "border-border", !open && "hover:border-input hover:shadow-xs")}>
      <div className="flex min-h-[50px] w-full items-center gap-2.5 px-3 py-2.5">
        <Checkbox checked={on} indeterminate={mixed} onCheckedChange={() => onToggleService(!(on || mixed))} aria-label={serviceName(s.id, i18n.language)} />
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-expanded={open} onClick={onToggleOpen}>
          <b className={cn("whitespace-nowrap text-[13px]", off ? "font-medium text-muted-foreground" : "font-semibold text-card-foreground")}>{serviceName(s.id, i18n.language)}</b>
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{mixed ? t("services.selectedOf", { sel: k, n }) : t("services.typesCount", { n })}</span>
          {global && (
            <Badge variant="outline" className="h-[18px]">
              {t("common.global")}
            </Badge>
          )}
          <span className={cn("ml-auto flex items-center", off && "opacity-55 grayscale")}>
            {shownIcons.map((m, i) => (
              <AwsIcon key={m.service.name} service={m.service} className={cn("ring-2 ring-card", i > 0 && "-ml-1.5")} />
            ))}
            {members.length > shownIcons.length && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">+{members.length - shownIcons.length}</span>}
          </span>
          <RiskBadge risk={s.risk} />
          <ChevronDownIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="grid gap-0.5 border-t border-border bg-muted/55 px-3 pt-1.5 pb-2">
          {members.map((m) => (
            <div key={m.service.name} className="grid grid-cols-[20px_118px_minmax(0,1fr)] items-center gap-2.5 py-1.5 max-sm:grid-cols-[20px_minmax(0,1fr)]">
              <AwsIcon service={m.service} size={20} />
              <span className="truncate text-xs font-medium text-card-foreground">{m.service.name}</span>
              <span className="flex flex-wrap gap-1 max-sm:col-start-2">
                {m.types.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={sel.has(r.id)}
                    title={typeLabel(r.id, r.label, i18n.language)}
                    onClick={() => onToggleType(r.id)}
                    className={cn(
                      "rounded-[4px] border px-1.5 py-px font-mono text-[10.5px] transition-colors",
                      sel.has(r.id) ? "border-border bg-card text-foreground" : "border-dashed border-border bg-transparent text-muted-foreground line-through hover:text-foreground",
                    )}
                  >
                    {r.id}
                  </button>
                ))}
              </span>
            </div>
          ))}
          {note && <p className="pt-1 pb-0.5 text-xs text-muted-foreground">{note}</p>}
        </div>
      )}
    </div>
  );
}

export function meta() {
  return [{ title: `${i18n.t("steps.services")} · AWS Broom` }];
}

export default function Services() {
  const { t } = useTranslation();
  const { info, expire } = useSession();
  const wiz = useWizard();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [timeFilterOn, setTimeFilterOn] = useState(wiz.olderThanHours !== null);
  const [hours, setHours] = useState(String(wiz.olderThanHours ?? 24));

  const catalog = useQuery({ queryKey: ["catalog"], queryFn: api.catalog, staleTime: Infinity });
  const services: Service[] = catalog.data?.services ?? [];

  useEffect(() => {
    if (wiz.regions.length === 0) navigate("/wizard/regions", { replace: true });
  }, [wiz.regions.length, navigate]);

  // First visit: preselect the default set.
  useEffect(() => {
    if (!catalog.data || wiz.resourceTypes.length > 0) return;
    wiz.setResourceTypes(defaultSet(catalog.data.services));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.data]);

  useEffect(() => {
    const h = Number(hours);
    wiz.setOlderThanHours(timeFilterOn && Number.isFinite(h) && h > 0 ? Math.round(h) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeFilterOn, hours]);

  const sel = useMemo(() => new Set(wiz.resourceTypes), [wiz.resourceTypes]);
  const allTypes = useMemo(() => services.flatMap((s) => s.resourceTypes.map((r) => r.id)), [services]);
  const setSel = (next: Set<string>) => wiz.setResourceTypes(allTypes.filter((id) => next.has(id)));

  const toggleType = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  };
  const toggleService = (s: Service, on: boolean) => {
    const next = new Set(sel);
    for (const r of s.resourceTypes) {
      if (on) next.add(r.id);
      else next.delete(r.id);
    }
    setSel(next);
  };
  const toggleOpen = (id: string) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedServices = services.filter((s) => s.resourceTypes.some((r) => sel.has(r.id)));
  const hasGlobal = services.some((s) => s.resourceTypes.some((r) => sel.has(r.id) && r.global));

  const start = useMutation({
    mutationFn: () =>
      api.createScan({
        regions: wiz.regions,
        resourceTypes: wiz.resourceTypes,
        olderThanHours: wiz.olderThanHours ?? undefined,
      }),
    onSuccess: (res) => navigate(`/wizard/scan/${res.jobId}`),
    onError: (err) => {
      if (isSessionError(err)) {
        expire();
        return;
      }
      toast.add({ title: t("common.unknownError"), description: err instanceof ApiError ? err.message : String(err), type: "error" });
    },
  });

  return (
    <>
      <Stepper current="services" />
      <PageHeader
        title={t("services.title")}
        sub={t("services.sub")}
      />

      <TwoCol
        rail={
          <Rail>
            <RailCard title={t("common.selection")}>
              <Toolbar className="mb-3 justify-start">
{
              <>
              <Button size="xs" variant="outline" onClick={() => wiz.setResourceTypes(defaultSet(services))} disabled={!catalog.data}>
                {t("services.commonSet")}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => wiz.setResourceTypes(allTypes)} disabled={!catalog.data}>
                {t("services.everything")}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => wiz.setResourceTypes([])}>
                {t("common.clear")}
              </Button>
            </>
}
              </Toolbar>
              <RailRow label={t("common.account")} value={info?.accountId} />
              <RailRow label={t("common.regions")} value={hasGlobal ? `${wiz.regions.length} ${t("common.plusGlobal")}` : wiz.regions.length} />
              <RailRow label={t("common.services")} value={`${selectedServices.length} / ${services.length}`} />
              <RailRow label={t("common.resourceTypes")} value={wiz.resourceTypes.length} />
              <RailRow
                label={t("services.timeFilter")}
                value={wiz.olderThanHours ? `${wiz.olderThanHours}h` : <span className="text-muted-foreground">{t("common.off")}</span>}
              />
            </RailCard>
            <Note>{t("services.readOnlyNote")}</Note>
          </Rail>
        }
      >
        {catalog.isPending && (
          <div className="flex items-center gap-2 py-10 text-muted-foreground">
            <Spinner /> {t("common.loading")}
          </div>
        )}
        <div className="grid items-start gap-2 md:grid-cols-2">
          {services.map((s) => (
            <ServiceCard
              key={s.id}
              s={s}
              sel={sel}
              open={expanded.has(s.id)}
              onToggleOpen={() => toggleOpen(s.id)}
              onToggleService={(on) => toggleService(s, on)}
              onToggleType={toggleType}
              note={
                s.id === "security" ? t("services.kmsNote") : s.id === "iam" && info?.iamUserName ? t("services.iamNote", { user: info.iamUserName }) : undefined
              }
            />
          ))}
        </div>

        {catalog.data && (
          <div className="mt-4 rounded-xl border border-border bg-card p-4 shadow-xs">
            <div className="flex items-start gap-2.5">
              <Checkbox id="time-filter" className="mt-1" checked={timeFilterOn} onCheckedChange={(v) => setTimeFilterOn(Boolean(v))} />
              <div className="text-sm">
                <Label htmlFor="time-filter" className="inline cursor-pointer font-medium">
                  {t("services.olderThan.prefix")}
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={8760}
                  className="mx-1.5 inline-block h-7 w-20 font-mono"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  disabled={!timeFilterOn}
                />
                <Label htmlFor="time-filter" className="inline cursor-pointer font-medium">
                  {t("services.olderThan.suffix")}
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">{t("services.olderThan.hint")}</p>
              </div>
            </div>
          </div>
        )}
      </TwoCol>

      <WizardNav back="/wizard/regions" backLabel={t("steps.regions")}>
        <Button size="lg" disabled={wiz.resourceTypes.length === 0 || start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? <Spinner /> : <SearchIcon data-icon="inline-start" />}
          {t("services.start")}
        </Button>
      </WizardNav>
    </>
  );
}

function defaultSet(services: Service[]): string[] {
  return services.filter((s) => s.defaultSelected).flatMap((s) => s.resourceTypes.map((r) => r.id));
}
