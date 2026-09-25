import { CheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";

export type Step = "regions" | "services" | "scan" | "review" | "clean";
const STEPS: Step[] = ["regions", "services", "scan", "review", "clean"];

export function Stepper({ current }: { current: Step }) {
  const { t } = useTranslation();
  const idx = STEPS.indexOf(current);
  return (
    <ol className="mb-5 flex items-center overflow-x-auto pb-1 text-sm">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const cur = i === idx;
        const danger = s === "clean";
        return (
          <li key={s} className="flex items-center whitespace-nowrap">
            {i > 0 && <span className="mx-3 h-px w-9 bg-input" aria-hidden="true" />}
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border font-mono text-xs",
                done && "border-transparent bg-primary/15 text-primary",
                cur && !danger && "border-primary bg-primary text-primary-foreground",
                cur && danger && "border-destructive bg-destructive text-destructive-foreground",
                !done && !cur && "border-input bg-card text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-3" /> : i + 1}
            </span>
            <span className={cn("ml-2.5", cur ? "font-semibold text-foreground" : "text-muted-foreground")}>{t(`steps.${s}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}
