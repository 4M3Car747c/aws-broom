import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { cn } from "cn";

import { Avatar, identityLabel, useMinutesLeft } from "~/components/app-shell";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { api } from "~/lib/api";
import { setLang, type Lang } from "~/lib/i18n";
import { setTheme, type Theme, useTheme } from "~/lib/use-dark";
import { useSession } from "~/lib/session";

export type SettingsTab = "credentials" | "appearance" | "language" | "about";
const TABS: SettingsTab[] = ["credentials", "appearance", "language", "about"];
const REPO = "https://github.com/4M3Car747c/aws-broom";

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={t("settings.copy")}
      title={done ? t("settings.copied") : t("settings.copy")}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => undefined,
        );
      }}
      className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {done ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
}

function Row({ label, value, mono, copy, title }: { label: string; value: React.ReactNode; mono?: boolean; copy?: string; title?: string }) {
  return (
    <div className="grid min-h-11 grid-cols-[84px_minmax(0,1fr)_28px] items-center gap-3 border-b border-border first:border-t">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("truncate text-sm text-popover-foreground", mono && "font-mono text-[13px]")} title={title}>
        {value}
      </span>
      {copy ? <CopyButton text={copy} /> : <span />}
    </div>
  );
}

/* Theme thumbnails show fixed light/dark palettes on purpose: they preview the choice, not the current theme. */
const PV = {
  light: { bg: "oklch(0.9581 0 0)", bar: "oklch(0.9774 0.0042 236.5)", line: "oklch(0.884 0.0067 208.78)", ink: "oklch(0.2022 0.011 151.16)" },
  dark: { bg: "oklch(0.1776 0 0)", bar: "oklch(0.2638 0.0024 247.9)", line: "oklch(0.3306 0.0066 248.02)", ink: "oklch(0.9755 0.0045 258.32)" },
};

function Preview({ variant }: { variant: Theme }) {
  const half = (l: string, d: string) => `linear-gradient(90deg, ${l} 50%, ${d} 50%)`;
  const p = variant === "system" ? null : PV[variant];
  const bg = p ? p.bg : half(PV.light.bg, PV.dark.bg);
  const bar = p ? p.bar : half(PV.light.bar, PV.dark.bar);
  const line = p ? p.line : half(PV.light.line, PV.dark.line);
  const ink = p ? p.ink : half(PV.light.ink, PV.dark.ink);
  const w = variant === "system" ? "76%" : undefined;
  return (
    <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-[10px]" style={{ background: bg }} aria-hidden="true">
      <span className="absolute inset-x-0 top-0 h-[18%] border-b" style={{ background: bar, borderColor: p ? p.line : "oklch(0.6 0.006 230)" }} />
      <span className="absolute left-[12%] top-[36%] h-[7%] rounded-[3px]" style={{ background: ink, width: w ?? "40%" }} />
      <span className="absolute left-[12%] top-[54%] h-[7%] rounded-[3px]" style={{ background: line, width: w ?? "62%" }} />
    </span>
  );
}

export function SettingsDialog({ tab, onTabChange }: { tab: SettingsTab | null; onTabChange: (tab: SettingsTab | null) => void }) {
  const { t, i18n } = useTranslation();
  const { status, info, logout } = useSession();
  const navigate = useNavigate();
  const theme = useTheme();
  const minutes = useMinutesLeft(info?.expiresAt);
  const authed = status === "authed" && !!info;
  const lang = (i18n.language === "zh-CN" ? "zh-CN" : "en") as Lang;
  const about = useQuery({ queryKey: ["catalog"], queryFn: api.catalog, staleTime: Infinity, enabled: tab === "about" });
  const current = tab ?? "credentials";

  let pane: React.ReactNode = null;
  if (current === "credentials") {
    pane = authed ? (
      <>
        <h2 className="mb-6 h-[34px] text-base leading-[34px] font-semibold text-card-foreground">{t("settings.tabs.credentials")}</h2>
        <div className="grid">
          <Row label={t("settings.credentials.account")} value={info.accountId} mono copy={info.accountId} />
          <Row label={t("settings.credentials.identity")} value={identityLabel(info)} mono copy={info.arn} title={info.arn} />
          <Row
            label={t("settings.credentials.validity")}
            value={`${info.isTemporary ? t("app.temporary") : t("app.longLived")}${minutes !== null ? ` · ${t("app.minutesLeft", { n: minutes })}` : ""}`}
          />
        </div>
        <span className="flex-1" />
        <Button
          variant="destructive"
          className="w-fit"
          onClick={() => {
            onTabChange(null);
            void logout().then(() => navigate("/"));
          }}
        >
          {t("app.menu.signOut")}
        </Button>
      </>
    ) : (
      <>
        <h2 className="mb-3 h-[34px] text-base leading-[34px] font-semibold text-card-foreground">{t("app.menu.notConnected")}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("settings.credentials.notConnectedBody")}</p>
        <span className="flex-1" />
        <Button
          className="w-fit"
          onClick={() => {
            onTabChange(null);
            navigate("/connect");
          }}
        >
          {t("settings.credentials.connect")}
        </Button>
      </>
    );
  } else if (current === "appearance") {
    const themes: Theme[] = ["light", "dark", "system"];
    pane = (
      <>
        <h2 className="mb-6 h-[34px] text-base leading-[34px] font-semibold text-card-foreground">{t("settings.tabs.appearance")}</h2>
        <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label={t("settings.tabs.appearance")}>
          {themes.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={theme === v}
              onClick={() => setTheme(v)}
              className="group grid gap-2.5 text-center outline-none focus-visible:[&>span:first-child]:ring-2 focus-visible:[&>span:first-child]:ring-ring"
            >
              <span className={cn("block rounded-[10px] ring-1 ring-border transition-shadow group-hover:ring-input", theme === v && "ring-2 ring-primary group-hover:ring-primary")}>
                <Preview variant={v} />
              </span>
              <span className={cn("truncate text-[13px] text-muted-foreground", theme === v && "font-medium text-card-foreground")}>{t(`app.menu.${v}`)}</span>
            </button>
          ))}
        </div>
      </>
    );
  } else if (current === "language") {
    const langs: { value: Lang; label: string }[] = [
      { value: "zh-CN", label: "简体中文" },
      { value: "en", label: "English" },
    ];
    pane = (
      <>
        <h2 className="mb-6 h-[34px] text-base leading-[34px] font-semibold text-card-foreground">{t("settings.tabs.language")}</h2>
        <div className="grid" role="radiogroup" aria-label={t("settings.tabs.language")}>
          {langs.map((l) => (
            <button
              key={l.value}
              type="button"
              role="radio"
              aria-checked={lang === l.value}
              onClick={() => setLang(l.value)}
              className={cn(
                "flex min-h-11 w-full items-center justify-between border-b border-border text-left text-sm text-muted-foreground first:border-t hover:text-foreground",
                lang === l.value && "font-medium text-card-foreground",
              )}
            >
              <span>{l.label}</span>
              {lang === l.value && <CheckIcon className="size-4 text-card-foreground" />}
            </button>
          ))}
        </div>
      </>
    );
  } else {
    pane = (
      <>
        <h2 className="mb-3 h-[34px] text-base leading-[34px] font-semibold text-card-foreground">AWS Broom</h2>
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{t("settings.about.blurb")}</p>
        <div className="grid">
          <Row label={t("settings.about.version")} value={about.data?.version ?? "…"} mono />
          <Row label={t("settings.about.engine")} value={about.data?.engine ?? "cloud-nuke"} mono />
          <Row label={t("settings.about.license")} value="MIT" />
        </div>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {[
            ["source", REPO],
            ["iamPolicy", `${REPO}/blob/main/docs/iam-policy.md`],
            ["security", `${REPO}/blob/main/docs/security.md`],
          ].map(([k, href]) => (
            <a key={k} href={href} target="_blank" rel="noreferrer" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              {t(`settings.about.${k}`)}
            </a>
          ))}
        </div>
      </>
    );
  }

  return (
    <Dialog open={tab !== null} onOpenChange={(open) => !open && onTabChange(null)}>
      <DialogContent showCloseButton={false} className="flex h-[400px] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[620px]">
        <DialogTitle className="sr-only">{t("settings.title")}</DialogTitle>
        <div className="flex w-[164px] shrink-0 flex-col gap-0.5 border-r border-border px-2.5 py-5" role="tablist" aria-orientation="vertical">
          <div className="px-3 pb-3 text-[13px] font-medium text-muted-foreground">{t("settings.title")}</div>
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={current === k}
              tabIndex={current === k ? 0 : -1}
              onClick={() => onTabChange(k)}
              onKeyDown={(e) => {
                const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const i = (TABS.indexOf(k) + d + TABS.length) % TABS.length;
                onTabChange(TABS[i]);
                (e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[i])?.focus();
              }}
              className={cn(
                "flex h-[34px] w-full items-center rounded-lg px-3 text-left text-sm font-medium text-muted-foreground hover:text-foreground",
                current === k && "bg-accent text-card-foreground hover:text-card-foreground",
              )}
            >
              <span className="truncate">{t(`settings.tabs.${k}`)}</span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col px-8 pt-6 pb-7" role="tabpanel">
          {pane}
        </div>
        <button
          type="button"
          aria-label={t("settings.close")}
          onClick={() => onTabChange(null)}
          className="absolute top-5 right-5 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </DialogContent>
    </Dialog>
  );
}
