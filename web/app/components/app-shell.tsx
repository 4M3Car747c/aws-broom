import { LanguagesIcon, LogOutIcon, MonitorIcon, MoonIcon, SettingsIcon, SunIcon, SunMoonIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation, useNavigate } from "react-router";
import { cn } from "cn";

import { SettingsDialog, type SettingsTab } from "~/components/settings-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { setLang, type Lang } from "~/lib/i18n";
import { type SessionInfo } from "~/lib/api";
import { setTheme, type Theme, useTheme } from "~/lib/use-dark";
import { useSession } from "~/lib/session";

/**
 * Brand tile from web/public/icons: ink tile on the light theme, paper tile on the dark theme.
 * `inverse` flips that for surfaces painted in the opposite theme (the floating header pill).
 */
export function BrandMark({ className, inverse }: { className?: string; inverse?: boolean }) {
  const first = inverse ? "/icons/svg/broom-mark-light.svg" : "/icons/svg/broom-mark-dark.svg";
  const second = inverse ? "/icons/svg/broom-mark-dark.svg" : "/icons/svg/broom-mark-light.svg";
  return (
    <span className={cn("relative block size-7 shrink-0", className)} aria-hidden="true">
      <img src={first} alt="" className="block size-full dark:hidden" />
      <img src={second} alt="" className="hidden size-full dark:block" />
    </span>
  );
}

export function useMinutesLeft(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  return Math.max(0, Math.round(ms / 60_000));
}

/** Short display name for the signed-in principal, e.g. "PoCAdmin/ethan". */
export function identityLabel(info: SessionInfo): string {
  return info.principal || info.iamUserName || info.arn.split(":").pop() || info.accountId;
}


/**
 * Fixed avatar (web/public/avatar.webp, transparent). The artwork needs a solid ground:
 * white in the light theme and the dark popover grey in the dark theme (both via --popover).
 * Greyed out while no credentials are connected.
 */
export function Avatar({ info, className }: { info: SessionInfo | null; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-popover",
        info ? "ring-1 ring-border" : "border-[1.5px] border-dashed border-input",
        className,
      )}
    >
      <img src="/avatar.webp" alt="" width={32} height={32} className={cn("size-[82%] object-contain", !info && "opacity-50 grayscale")} />
    </span>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <span className="inline-flex shrink-0 rounded-lg bg-muted p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o.icon ? o.label : undefined}
          title={o.icon ? o.label : undefined}
          onClick={() => onChange(o.value)}
          className="grid h-6 min-w-7 place-items-center rounded-md px-[7px] text-xs font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-popover aria-pressed:text-card-foreground aria-pressed:shadow-xs dark:aria-pressed:bg-accent [&_svg]:size-3.5"
        >
          {o.icon ?? o.label}
        </button>
      ))}
    </span>
  );
}

const rowClass = "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm";

function AccountMenu({ onOpenSettings }: { onOpenSettings: (tab: SettingsTab) => void }) {
  const { t, i18n } = useTranslation();
  const { status, info, logout } = useSession();
  const navigate = useNavigate();
  const theme = useTheme();
  const minutes = useMinutesLeft(info?.expiresAt);
  const authed = status === "authed" && !!info;
  const lang = (i18n.language === "zh-CN" ? "zh-CN" : "en") as Lang;
  const statusText = info ? `${info.isTemporary ? t("app.temporary") : t("app.longLived")}${minutes !== null ? ` · ${t("app.minutesLeft", { n: minutes })}` : ""}` : "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={authed ? identityLabel(info) : t("app.menu.notConnected")}
        title={authed ? statusText : t("app.menu.notConnected")}
        className="relative grid size-8 place-items-center rounded-full transition-shadow hover:ring-[3px] hover:ring-muted aria-expanded:ring-[3px] aria-expanded:ring-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Avatar info={authed ? info : null} />
        {authed && (
          <span
            className={cn("absolute -right-px -bottom-px size-2.5 rounded-full border-2 border-card", info.isTemporary ? "bg-ok" : "bg-warn")}
            aria-hidden="true"
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[248px] rounded-xl p-1.5">
        <DropdownMenuItem className={cn(rowClass, "min-h-[52px]")} onClick={() => onOpenSettings("credentials")}>
          <Avatar info={authed ? info : null} />
          <span className="grid min-w-0 gap-0.5 leading-[1.3]">
            {authed ? (
              <>
                <span className="truncate font-medium text-card-foreground">{identityLabel(info)}</span>
                <span className="font-mono text-xs text-muted-foreground">{info.accountId}</span>
              </>
            ) : (
              <>
                <span className="font-medium text-card-foreground">{t("app.menu.notConnected")}</span>
                <span className="text-xs text-muted-foreground">{t("app.menu.noCredentials")}</span>
              </>
            )}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="-mx-1.5 my-1.5" />
        <div className={cn(rowClass, "justify-between")}>
          <span className="flex items-center gap-2.5">
            <SunMoonIcon className="size-4 text-muted-foreground" />
            {t("app.menu.theme")}
          </span>
          <Segmented<Theme>
            label={t("app.menu.theme")}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: t("app.menu.light"), icon: <SunIcon /> },
              { value: "dark", label: t("app.menu.dark"), icon: <MoonIcon /> },
              { value: "system", label: t("app.menu.system"), icon: <MonitorIcon /> },
            ]}
          />
        </div>
        <div className={cn(rowClass, "justify-between")}>
          <span className="flex items-center gap-2.5">
            <LanguagesIcon className="size-4 text-muted-foreground" />
            {t("app.menu.language")}
          </span>
          <Segmented<Lang>
            label={t("app.menu.language")}
            value={lang}
            onChange={setLang}
            options={[
              { value: "zh-CN", label: "中" },
              { value: "en", label: "EN" },
            ]}
          />
        </div>
        <DropdownMenuSeparator className="-mx-1.5 my-1.5" />
        <DropdownMenuItem className={rowClass} onClick={() => onOpenSettings(authed ? "credentials" : "appearance")}>
          <SettingsIcon className="text-muted-foreground" />
          {t("app.menu.settings")}
        </DropdownMenuItem>
        {authed && (
          <DropdownMenuItem
            variant="destructive"
            className={rowClass}
            onClick={() => {
              void logout().then(() => navigate("/"));
            }}
          >
            <LogOutIcon />
            {t("app.menu.signOut")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const landing = pathname === "/";
  // The bar is as wide as the page's content column: 1152px on the landing/connect pages, 1440px inside the app.
  const centered = landing || pathname.startsWith("/connect");
  // Wizard pages carry a fixed bottom bar; a footer under it only adds hidden scroll height.
  const wizard = pathname.startsWith("/wizard");

  const navClass = (active: boolean) =>
    cn(
      "flex h-8 items-center rounded-full px-3 text-sm font-medium transition-colors",
      active ? "text-card-foreground" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 px-2 pt-3 pb-1">
        {/* The bar tracks the page's content column: 1152px on the landing/connect pages, 1440px inside the app.
            It overhangs the column by its own inner padding so the logo and avatar sit flush with the content edges. */}
        <div
          className={cn(
            "relative mx-auto flex h-12 w-full items-center rounded-full border border-border bg-card/90 px-5 text-card-foreground shadow-md backdrop-blur",
            "transition-[max-width] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] will-change-[max-width] motion-reduce:transition-none",
            centered ? "max-w-[calc(1152px+2.5rem)]" : "max-w-[calc(1440px+2.5rem)]",
          )}
        >
          <div className="flex h-full items-center gap-1">
            <NavLink to="/" className="mr-2 flex items-center gap-2 rounded-full pr-2.5 font-semibold text-card-foreground">
              <BrandMark />
              <span className="hidden sm:inline">{t("app.name")}</span>
            </NavLink>
            <nav className="flex items-center gap-0.5" aria-label="Primary">
              <NavLink to="/wizard" className={({ isActive }) => navClass(isActive || pathname.startsWith("/connect"))}>
                {t("app.nav.wizard")}
              </NavLink>
              <NavLink to="/history" className={({ isActive }) => navClass(isActive)}>
                {t("app.nav.history")}
              </NavLink>
            </nav>
          </div>
          <span className="flex-1" />
          <AccountMenu onOpenSettings={setSettings} />
        </div>
      </header>

      {landing ? (
        <main className="flex-1">{children}</main>
      ) : (
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-5 pt-6 pb-24">{children}</main>
      )}

      {!landing && !wizard && (
        <footer className="mx-auto flex w-full max-w-[1440px] flex-wrap gap-4 px-5 pb-10 text-xs text-muted-foreground">
          <span>AWS Broom · MIT</span>
          <span>{t("app.footer.poweredBy")}</span>
          <a className="hover:text-foreground" href="https://github.com/4M3Car747c/aws-broom" target="_blank" rel="noreferrer">
            {t("app.footer.source")}
          </a>
          <a className="hover:text-foreground" href="https://github.com/4M3Car747c/aws-broom/blob/main/docs/iam-policy.md" target="_blank" rel="noreferrer">
            {t("app.footer.iamPolicy")}
          </a>
          <a className="hover:text-foreground" href="https://github.com/4M3Car747c/aws-broom/blob/main/docs/security.md" target="_blank" rel="noreferrer">
            {t("app.footer.security")}
          </a>
        </footer>
      )}

      <SettingsDialog tab={settings} onTabChange={setSettings} />
    </div>
  );
}
