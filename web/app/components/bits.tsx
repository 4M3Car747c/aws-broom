import { ChevronLeftIcon, Maximize2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { cn } from "cn";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

// Small presentational pieces shared by the wizard pages.

export function PageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-balance">{title}</h1>
        {sub && <p className="mt-1 text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = "default" | "ok" | "warn" | "danger" | "primary";

const toneText: Record<Tone, string> = {
  default: "text-foreground",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-destructive",
  primary: "text-primary",
};

export function StatTile({ label, value, suffix, tone = "default" }: { label: string; value: React.ReactNode; suffix?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-xs">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-mono text-2xl font-medium tabular", toneText[tone])}>
        {value}
        {suffix && <span className="ml-1.5 font-sans text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

export function StatusDot({ tone, children, spinning }: { tone: Tone | "muted"; children?: React.ReactNode; spinning?: boolean }) {
  const color =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-destructive" : tone === "primary" ? "text-primary" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", color)}>
      {spinning ? (
        <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      ) : (
        <span className="size-[7px] rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  const { t } = useTranslation();
  const cls = risk === "low" ? "bg-ok/12 text-ok" : risk === "medium" ? "bg-warn/14 text-warn" : "bg-destructive/12 text-destructive";
  return <Badge className={cn("border-transparent", cls)}>{t(`risk.${risk}`)}</Badge>;
}

export function ProgressBar({ value, tone = "primary", striped }: { value: number; tone?: "primary" | "danger"; striped?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", tone === "danger" ? "bg-destructive" : "bg-primary", striped && "progress-striped")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3.5 py-3 text-sm",
        tone === "info" ? "border-primary/25 bg-primary/8 text-foreground" : "border-warn/30 bg-warn/12 text-foreground",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Bottom guide for the wizard: "back to <previous step>" on the left, the one
 * primary action on the right. Counts belong in the page's rail, not here.
 */
export function WizardNav({ back, backLabel, children }: { back: string; backLabel?: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-5">
        <Button variant="ghost" size="lg" className="text-muted-foreground hover:text-foreground" render={<Link to={back} />}>
          <ChevronLeftIcon data-icon="inline-start" />
          {backLabel ?? t("common.back")}
        </Button>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

/** Icon-only "open in viewer" button for rail cards. */
export function ExpandButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="icon-xs" aria-label={label} title={label} onClick={onClick}>
      <Maximize2Icon />
    </Button>
  );
}

/** Right-aligned action row placed directly above a page's stats block. Renders nothing when empty. */
export function Toolbar({ children, className }: { children?: React.ReactNode; className?: string }) {
  if (children === null || children === undefined || children === false) return null;
  return <div className={cn("mb-3 flex flex-wrap items-center justify-end gap-2", className)}>{children}</div>;
}

export function Rail({ children }: { children: React.ReactNode }) {
  return <aside className="space-y-3 lg:sticky lg:top-[72px]">{children}</aside>;
}

export function RailCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="mb-2.5 flex min-h-6 items-center justify-between gap-2">
        <h4 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

export function RailRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-t border-border py-1.5 text-sm first:border-t-0">
      <span>{label}</span>
      <span className="font-mono text-[13px]">{value}</span>
    </div>
  );
}

export function TwoCol({ children, rail }: { children: React.ReactNode; rail: React.ReactNode }) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">{children}</div>
      {rail}
    </div>
  );
}
