/** Reducer for the custom-domains panel. Pure, so it is unit-testable. */
import type { Busy } from "./DomainCard";
import type { CustomDomain, DnsCheckResult, StatusEvent } from "./types";

export interface PanelState {
  loaded: boolean;
  loadError: string | null;
  domains: CustomDomain[];
  checks: Record<string, DnsCheckResult>;
  busy: Record<string, Busy>;
  adding: boolean;
  addError: string | null;
  removeTarget: CustomDomain | null;
}

export type PanelAction =
  | { type: "LOADED"; domains: CustomDomain[] }
  | { type: "LOAD_FAILED"; message: string }
  | { type: "ADDING"; adding: boolean; error?: string | null }
  | { type: "UPSERT"; domain: CustomDomain }
  | { type: "DELETE"; id: string }
  | { type: "CHECK"; id: string; check: DnsCheckResult }
  | { type: "BUSY"; id: string; busy: Busy }
  | { type: "STATUS"; event: StatusEvent }
  | { type: "CONFIRM_REMOVE"; domain: CustomDomain | null };

export const INITIAL_STATE: PanelState = {
  loaded: false, loadError: null, domains: [], checks: {}, busy: {}, adding: false, addError: null, removeTarget: null,
};

export function panelReducer(state: PanelState, a: PanelAction): PanelState {
  switch (a.type) {
    case "LOADED": return { ...state, loaded: true, loadError: null, domains: a.domains };
    case "LOAD_FAILED": return { ...state, loaded: true, loadError: a.message };
    case "ADDING": return { ...state, adding: a.adding, addError: a.error ?? null };
    case "UPSERT": {
      const exists = state.domains.some((d) => d.id === a.domain.id);
      return { ...state, domains: exists ? state.domains.map((d) => (d.id === a.domain.id ? a.domain : d)) : [...state.domains, a.domain] };
    }
    case "DELETE": {
      const { [a.id]: _check, ...checks } = state.checks;
      return { ...state, domains: state.domains.filter((d) => d.id !== a.id), checks };
    }
    case "CHECK": return { ...state, checks: { ...state.checks, [a.id]: a.check } };
    case "BUSY": return { ...state, busy: { ...state.busy, [a.id]: a.busy } };
    case "STATUS": return {
      ...state,
      domains: state.domains.map((d) => (d.id === a.event.domainId ? { ...d, status: a.event.status, lastError: a.event.lastError } : d)),
    };
    case "CONFIRM_REMOVE": return { ...state, removeTarget: a.domain };
  }
}
