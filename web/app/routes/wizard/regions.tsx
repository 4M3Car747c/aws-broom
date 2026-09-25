import { useQuery } from "@tanstack/react-query";
import { GlobeIcon, MinusIcon, PlusIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { cn } from "cn";

import { Note, PageHeader, Rail, RailCard, RailRow, Toolbar, TwoCol, WizardNav } from "~/components/bits";
import { Stepper } from "~/components/stepper";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Map, MapGeoJSON, MapMarker, MarkerContent, MarkerTooltip, useMap } from "~/components/ui/map";
import { Spinner } from "~/components/ui/spinner";
import { api } from "~/lib/api";
import { REGIONS } from "~/lib/regions";
import { isSessionError, useSession } from "~/lib/session";
import { useIsDark } from "~/lib/use-dark";
import { useWizard } from "~/lib/wizard";
import { i18n } from "~/lib/i18n";

const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-168, -52],
  [178, 70],
];
const LAND = {
  light: { fill: "#dde2e8", line: "#c3cad3" },
  dark: { fill: "#363c44", line: "#4a515b" },
};

export function meta() {
  return [{ title: `${i18n.t("steps.regions")} · AWS Broom` }];
}

export default function Regions() {
  const { t, i18n } = useTranslation();
  const { info, expire } = useSession();
  const { regions: selected, setRegions } = useWizard();
  const navigate = useNavigate();
  const dark = useIsDark();

  const q = useQuery({ queryKey: ["regions"], queryFn: api.regions, staleTime: 10 * 60_000 });
  useEffect(() => {
    if (q.error && isSessionError(q.error)) expire();
  }, [q.error, expire]);

  const enabled = useMemo(() => new Set(q.data?.regions.map((r) => r.code) ?? []), [q.data]);
  const enabledCodes = useMemo(() => [...enabled].sort(), [enabled]);
  const unknownEnabled = enabledCodes.filter((c) => !REGIONS[c]); // enabled but not in our coordinate table
  const sel = useMemo(() => new Set(selected), [selected]);

  const toggle = (code: string) => {
    if (!enabled.has(code)) return;
    const next = new Set(sel);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setRegions(enabledCodes.filter((c) => next.has(c)));
  };

  const land = dark ? LAND.dark : LAND.light;
  const zh = i18n.language.startsWith("zh");

  return (
    <>
      <Stepper current="regions" />
      <PageHeader
        title={t("regions.title")}
        sub={t("regions.sub", { account: info?.accountId })}
      />

      <TwoCol
        rail={
          <Rail>
            <RailCard title={t("common.selection")}>
              <Toolbar className="mb-3 justify-start">
{
              <>
              <Button size="xs" variant="outline" onClick={() => setRegions(enabledCodes)} disabled={!q.data}>
                {t("regions.selectAllEnabled")}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setRegions([])}>
                {t("common.clear")}
              </Button>
            </>
}
              </Toolbar>
              <RailRow label={t("common.account")} value={info?.accountId} />
              <RailRow label={t("common.regions")} value={selected.length} />
              {selected.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selected.map((c) => (
                    <Badge key={c} variant="outline" className="font-mono">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </RailCard>
            {unknownEnabled.length > 0 && (
              <RailCard title={t("regions.unmapped")}>
                <div className="flex flex-wrap gap-1.5">
                  {unknownEnabled.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={sel.has(c)}
                      onClick={() => toggle(c)}
                      className={cn(
                        "h-7 rounded-full border px-2.5 font-mono text-xs",
                        sel.has(c) ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </RailCard>
            )}
            <Note>{t("regions.optInNote")}</Note>
          </Rail>
        }
      >
        {q.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <p className="font-medium text-destructive">{t("regions.loadError")}</p>
            <p className="mt-1 text-muted-foreground">{q.error.message}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => void q.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <Map
              blank
              className="h-[clamp(360px,calc(100vh-316px),800px)] w-full bg-card"
              bounds={WORLD_BOUNDS}
              fitBoundsOptions={{ padding: 24 }}
              minZoom={0.8}
              maxZoom={6}
              dragRotate={false}
              pitchWithRotate={false}
              touchPitch={false}
              attributionControl={false}
              theme={dark ? "dark" : "light"}
            >
              <MapGeoJSON
                data="/world.geojson"
                fillPaint={{ "fill-color": land.fill, "fill-opacity": 1 }}
                linePaint={{ "line-color": land.line, "line-width": 0.6 }}
              />
              {Object.entries(REGIONS).map(([code, m]) => {
                const on = sel.has(code);
                const isEnabled = enabled.has(code);
                const name = zh ? m.zh : m.en;
                return (
                  <MapMarker key={code} longitude={m.lng} latitude={m.lat} anchor="center" onClick={() => toggle(code)}>
                    <MarkerContent className={cn("grid size-[22px] place-items-center", !isEnabled && "cursor-not-allowed")}>
                      <span
                        role="checkbox"
                        aria-checked={on}
                        aria-disabled={!isEnabled}
                        aria-label={`${code} ${name}`}
                        tabIndex={isEnabled ? 0 : -1}
                        onKeyDown={(e) => {
                          if (e.key === " " || e.key === "Enter") {
                            e.preventDefault();
                            toggle(code);
                          }
                        }}
                        className="grid size-[22px] place-items-center outline-none focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {on && <span className="marker-ping absolute size-[22px] rounded-full bg-primary opacity-25" />}
                        <span
                          className={cn(
                            "relative rounded-full transition-transform",
                            isEnabled && !on && "size-3 border-2 border-primary bg-card shadow-xs hover:scale-125",
                            isEnabled && on && "size-3 border-2 border-card bg-primary shadow-[0_0_0_2px_var(--primary)]",
                            !isEnabled && "size-[9px] bg-destructive opacity-75",
                          )}
                        />
                        {on && (
                          <span className="pointer-events-none absolute top-[22px] left-1/2 -translate-x-1/2 rounded bg-card/85 px-1 font-mono text-[10.5px] whitespace-nowrap text-foreground/80">
                            {code}
                          </span>
                        )}
                      </span>
                    </MarkerContent>
                    <MarkerTooltip>
                      <span className="font-mono font-medium">{code}</span>
                      <span className="ml-1.5 opacity-75">
                        {name}
                        {!isEnabled && ` · ${t("regions.notEnabled")}`}
                      </span>
                    </MarkerTooltip>
                  </MapMarker>
                );
              })}
              <ZoomControls />
            </Map>

            <div className="absolute top-3 left-3 z-10 flex gap-3 rounded-lg border border-border bg-card/90 px-3 py-2 text-xs text-foreground/80 backdrop-blur">
              <span className="inline-flex items-center gap-1.5">
                <i className="size-2.5 rounded-full bg-primary shadow-[0_0_0_2px_var(--card),0_0_0_3px_var(--primary)]" />
                {t("regions.legend.selected")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="size-2.5 rounded-full border-2 border-primary bg-card" />
                {t("regions.legend.enabled")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="size-2.5 rounded-full bg-destructive opacity-75" />
                {t("regions.legend.notEnabled")}
              </span>
            </div>
            <div className="absolute right-3 bottom-3 z-10 rounded-lg bg-primary px-2.5 py-1.5 font-mono text-xs font-semibold text-primary-foreground shadow-md">
              {q.isPending ? <Spinner className="size-3" /> : `${selected.length} / ${enabledCodes.length}`}
            </div>
          </div>
        )}
      </TwoCol>

      <WizardNav back="/">
        <Button size="lg" disabled={selected.length === 0} onClick={() => navigate("/wizard/services")}>
          {t("regions.next")}
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </WizardNav>
    </>
  );
}

/** Glass control panel in the map's top-right corner: zoom in / out / reset to world. */
function ZoomControls() {
  const { map } = useMap();
  const { t } = useTranslation();
  const btn = "grid size-[30px] place-items-center rounded-md text-foreground/80 hover:bg-muted hover:text-foreground";
  return (
    <div className="absolute top-3 right-3 z-10 grid gap-1 rounded-lg border border-border bg-card/90 p-1 backdrop-blur">
      <button type="button" className={btn} aria-label={t("regions.zoomIn")} onClick={() => map?.zoomTo(map.getZoom() + 1, { duration: 300 })}>
        <PlusIcon className="size-[15px]" />
      </button>
      <button type="button" className={btn} aria-label={t("regions.zoomOut")} onClick={() => map?.zoomTo(map.getZoom() - 1, { duration: 300 })}>
        <MinusIcon className="size-[15px]" />
      </button>
      <hr className="border-border" />
      <button type="button" className={btn} aria-label={t("regions.resetView")} onClick={() => map?.fitBounds(WORLD_BOUNDS, { padding: 24, duration: 600 })}>
        <GlobeIcon className="size-[15px]" />
      </button>
    </div>
  );
}
