import type { Facts } from "./kernel";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ObjectValue = { [key: string]: Json };
export type Mode = "browser-only" | "full";
export type Effort = "light" | "medium" | "high" | "xhigh" | "pro";

export interface Tool {
  wire: string;
  name: string;
  kind: "function" | "custom";
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
  instructions: string;
  input: ObjectValue[];
  tools: Tool[];
  attachments: Attachment[];
  textFormat?: ObjectValue;
  measurement?: { inputTokens: number };
}

export interface Placement {
  page?: string;
  receipt?: RetainedReceipt;
}

export interface RetainedReceipt {
  operation: string;
  page: string;
  document: string;
  assistant: string;
  answer: string;
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
