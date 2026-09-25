import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface WizardState {
  regions: string[];
  resourceTypes: string[];
  olderThanHours: number | null;
}

interface WizardCtx extends WizardState {
  setRegions: (r: string[]) => void;
  setResourceTypes: (t: string[]) => void;
  setOlderThanHours: (h: number | null) => void;
  reset: () => void;
}

const KEY = "broom-wizard";
const empty: WizardState = { regions: [], resourceTypes: [], olderThanHours: null };

function load(): WizardState {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return empty;
    const v = JSON.parse(raw) as Partial<WizardState>;
    return {
      regions: Array.isArray(v.regions) ? v.regions : [],
      resourceTypes: Array.isArray(v.resourceTypes) ? v.resourceTypes : [],
      olderThanHours: typeof v.olderThanHours === "number" ? v.olderThanHours : null,
    };
  } catch {
    return empty;
  }
}

const Ctx = createContext<WizardCtx | null>(null);

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WizardState>(() => (typeof window === "undefined" ? empty : load()));

  useEffect(() => {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const setRegions = useCallback((regions: string[]) => setState((s) => ({ ...s, regions })), []);
  const setResourceTypes = useCallback((resourceTypes: string[]) => setState((s) => ({ ...s, resourceTypes })), []);
  const setOlderThanHours = useCallback((olderThanHours: number | null) => setState((s) => ({ ...s, olderThanHours })), []);
  const reset = useCallback(() => setState(empty), []);

  const value = useMemo(
    () => ({ ...state, setRegions, setResourceTypes, setOlderThanHours, reset }),
    [state, setRegions, setResourceTypes, setOlderThanHours, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWizard(): WizardCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWizard outside WizardProvider");
  return ctx;
}
