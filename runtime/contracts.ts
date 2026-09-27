import type { Facts } from "./kernel";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ObjectValue = { [key: string]: Json };
export type Mode = "browser-only" | "full";
export type Effort = "light" | "medium" | "high" | "xhigh" | "pro";

export interface Tool {
  wire: string;
  name: string;
  namespace?: string;
  kind: "function" | "custom" | "tool_search";
  description: string;
  schema: ObjectValue;
}

export interface Attachment {
  name: string;
  mime: string;
  data: string;
  message: number;
  reference: string;
}

/** Frozen at first admission. New HTTP rounds cannot change interpretation. */
export interface Context {
  model: string;
  effort: Effort;
  mode: Mode;
  environment: string;
  purpose: "response" | "compact-v1" | "compact-v2";
  instructions: string;
  input: ObjectValue[];
  symbols: string[];
  tools: Tool[];
  attachments: Attachment[];
  textFormat?: ObjectValue;
  thread?: string;
  turn?: string;
  measurement?: { inputTokens: number; offset: number; parts: number };
}

export interface Placement {
  page?: string;
  offset: number;
  receipt?: RetainedReceipt;
}

export interface RetainedReceipt {
  operation: string;
  page: string;
  document: string;
  assistant: string;
  answer: string;
  environment: string;
  symbols: string[];
}

export interface Prepared {
  page: string;
  document: string;
}

export interface Snapshot {
  operation: string;
  slot: number;
  page: string;
  document: string;
  accepted: boolean;
  assistant: string;
  text: string;
  signature: string;
  untouched: boolean;
  assistantTail: boolean;
  facts: Facts;
  baseline: string[];
}

/** No reload, resend, recreate, timeout-cancel, or eviction operation exists. */
export interface Browser {
  prepare(operation: string, slot: number, payload: string, context: Context, placement: Placement): Promise<Prepared>;
  send(operation: string, slot: number): Promise<{ clicked: boolean }>;
  snapshot(operation: string): Promise<Snapshot>;
  inspect(page: string): Promise<Snapshot>;
  attach(operation: string, page: string, document: string): Promise<boolean>;
  cancel(operation: string): Promise<void>;
}

export class BridgeError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "BridgeError";
  }
}
