import { ArrowDownToLineIcon, CheckIcon, CopyIcon, SearchIcon, WrapTextIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";

import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";

const GUTTER = "3.5rem";
const PAD = "px-4"; // header, log rows and floating overlays share this inset

/**
 * Centred terminal-style viewer for long text output (worker log, error list).
 * Header: title + icon-only wrap / follow / copy / close. Floating over the log:
 * a search pill at the bottom centre and the line count at the bottom left.
 */
export function TerminalDialog({
  open,
  onOpenChange,
  title,
  lines,
  live,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  lines: string[];
  /** When true the viewer follows the tail by default (job still running). */
  live?: boolean;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(!!live);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const idx = lines.map((l, i) => [l, i] as const);
    return q ? idx.filter(([l]) => l.toLowerCase().includes(q)) : idx;
  }, [lines, filter]);

  useEffect(() => {
    if (!open || !follow) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, follow, shown.length]);

  const copy = () => {
    navigator.clipboard?.writeText(shown.map(([l]) => l).join("\n")).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };

  const iconBtn = (pressed?: boolean) =>
    cn(
      "grid size-7 place-items-center rounded-md text-code-foreground/60 transition-colors hover:bg-code-foreground/10 hover:text-code-foreground",
      pressed && "bg-code-foreground/15 text-code-foreground",
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex h-[72vh] flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-code p-0 text-code-foreground ring-1 ring-white/10 sm:max-w-[960px]">
        <div className={cn("flex h-11 shrink-0 items-center gap-1", PAD)}>
          <DialogTitle className="truncate text-[13px] font-medium text-code-foreground">{title}</DialogTitle>
          <span className="flex-1" />
          <button type="button" className={iconBtn(wrap)} aria-pressed={wrap} aria-label={t("terminal.wrap")} title={t("terminal.wrap")} onClick={() => setWrap((v) => !v)}>
            <WrapTextIcon className="size-4" />
          </button>
          <button type="button" className={iconBtn(follow)} aria-pressed={follow} aria-label={t("terminal.follow")} title={t("terminal.follow")} onClick={() => setFollow((v) => !v)}>
            <ArrowDownToLineIcon className="size-4" />
          </button>
          <button type="button" className={iconBtn()} aria-label={t("terminal.copy")} title={copied ? t("terminal.copied") : t("terminal.copy")} onClick={copy}>
            {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
          </button>
          <button type="button" className={cn(iconBtn(), "-mr-1.5")} aria-label={t("terminal.close")} title={t("terminal.close")} onClick={() => onOpenChange(false)}>
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={bodyRef} className="h-full overflow-auto pt-1 pb-20 font-mono text-[12px] leading-[1.65]">
            {shown.length === 0 ? (
              <div className={cn("py-10 text-center text-code-foreground/50", PAD)}>{t("terminal.empty")}</div>
            ) : (
              shown.map(([line, i]) => (
                <div key={i} className={cn("grid hover:bg-code-foreground/5", PAD)} style={{ gridTemplateColumns: `${GUTTER} minmax(0, 1fr)` }}>
                  <span className="pr-4 text-left text-code-foreground/35 tabular select-none">{i + 1}</span>
                  <span className={wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre"}>{line || " "}</span>
                </div>
              ))
            )}
          </div>

          <span className="pointer-events-none absolute bottom-4 left-[calc(1rem-6px)] rounded-md bg-code/70 px-1.5 py-0.5 font-mono text-[11px] text-code-foreground/50 tabular backdrop-blur">
            {t("terminal.lines", { n: shown.length })}
          </span>

          <label className="absolute bottom-3 left-1/2 flex h-10 w-[min(420px,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-full bg-code-foreground/10 pr-1.5 pl-3.5 shadow-lg ring-1 ring-code-foreground/15 backdrop-blur-md transition-shadow focus-within:ring-ring/60">
            <SearchIcon className="size-4 shrink-0 text-code-foreground/50" />
            <input
              id="terminal-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("terminal.filter")}
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs text-code-foreground outline-none placeholder:text-code-foreground/40"
            />
            <button
              type="button"
              aria-label={t("common.clear")}
              title={t("common.clear")}
              onClick={() => setFilter("")}
              className={cn("grid size-7 place-items-center rounded-full text-code-foreground/60 hover:bg-code-foreground/10 hover:text-code-foreground", !filter && "invisible")}
            >
              <XIcon className="size-3.5" />
            </button>
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
