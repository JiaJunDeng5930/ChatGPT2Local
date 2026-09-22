/** The reasoning levels accepted by the Astra Jev proxy contract. */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export type JevLeaseSteps = 1 | 2 | 5 | 10;

export interface JevDecision {
  effort: ReasoningEffort;
  leaseSteps: JevLeaseSteps;
}

export interface JevDecisionContext {
  model: string;
  input: unknown[];
  supportedEfforts: ReasoningEffort[];
  previousEffort: ReasoningEffort | null;
  step: number;
}

/** All timestamps in this module are epoch milliseconds. */
export interface HistorySummary {
  id: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  activeRequests: number;
  model: string | null;
  effort: string | null;
  updateCount: number;
}

/** A bounded, display-only representation of one retained input/output item. */
export interface RecentMessage {
  id: string;
  /** Message indexes are one-based positions in the original input/output sequence. */
  index: number;
  type: string;
  role: string | null;
  text: string;
  truncated: boolean;
}

export interface OverlayUpdate {
  id: string;
  /** Number of original input items before this update; zero means the start. */
  afterInputIndex: number;
  createdAt: number;
  /** Store metadata such as id and prefix fingerprints never enter this item. */
  item: Record<string, unknown>;
  reason?: string;
}

export interface HistoryDetail {
  history: HistorySummary;
  recentMessages: RecentMessage[];
  updates: OverlayUpdate[];
}

export interface PreparedHistory {
  body: Record<string, unknown>;
  historyId: string;
  generation: number;
  currentEffort: ReasoningEffort | null;
  leaseRemaining: number;
  decisionSource: "jev" | "lease" | "retry";
}

export class AstraJevError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AstraJevError";
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
