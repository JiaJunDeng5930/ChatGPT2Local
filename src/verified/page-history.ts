/** Browser effect adapter. It supplies observations to Bend, never chooses a lineage. */
import type { Page } from "playwright-core";
import { surfaceResume } from "./generated/core.cjs";
import { digest } from "./web-history";

const markerName = "__codexWebVerifiedHistoryV1";
const interactionEvents = ["pointerdown", "keydown", "paste", "drop", "input", "submit"];

interface Marker {
  key: string;
  operation: string;
  answer: string;
  dirty: boolean;
  onInteraction?: (event: Event) => void;
}

export async function markPageHistory(page: Page, key: string, operation: string, answer: string): Promise<void> {
  await page.evaluate(({ name, events, key, operation, answer }) => {
    const owner = globalThis as unknown as Record<string, Marker | undefined>;
    const old = owner[name];
    if (old?.onInteraction) for (const event of events) document.removeEventListener(event, old.onInteraction, true);
    const marker: Marker = { key, operation, answer, dirty: false };
    marker.onInteraction = event => { if (event.isTrusted) marker.dirty = true; };
    for (const event of events) document.addEventListener(event, marker.onInteraction, true);
    owner[name] = marker;
  }, { name: markerName, events: interactionEvents, key, operation, answer: digest(answer) });
}

export async function checkPageHistory(page: Page, expected: {
  key: string; operation: string; answerDigest: string;
}, observed: { idle: boolean; assistantTail: boolean; answer: string }): Promise<boolean> {
  const marker = await page.evaluate(name => {
    const value = (globalThis as unknown as Record<string, Marker | undefined>)[name];
    if (!value || typeof value.key !== "string" || typeof value.operation !== "string"
      || typeof value.answer !== "string" || typeof value.dirty !== "boolean") return undefined;
    return { key: value.key, operation: value.operation, answer: value.answer, dirty: value.dirty };
  }, markerName);
  const allowed = surfaceResume({
    $: "Evidence", present: marker !== undefined, untouched: marker?.dirty === false,
    idle: observed.idle, assistant_tail: observed.assistantTail,
    recorded_key: marker?.key ?? "", key: expected.key,
    recorded_operation: marker?.operation ?? "", operation: expected.operation,
    // Both the saved receipt and the live same-document witness must agree with
    // what the read-only DOM adapter just observed.
    recorded_answer: marker?.answer ?? "", expected_answer: expected.answerDigest,
    answer: digest(observed.answer),
  });
  if (!allowed) return false;
  // The caller now owns the same document for one new turn. The page is not
  // replayable again until a new completion installs the next witness.
  return page.evaluate(({ name, events, observedMarker }) => {
    const owner = globalThis as unknown as Record<string, Marker | undefined>;
    const marker = owner[name];
    // Compare-and-consume: an interaction or a new completion between the read
    // and this effect must not be erased by a stale positive decision.
    if (!marker || !observedMarker || marker.dirty || marker.key !== observedMarker.key
      || marker.operation !== observedMarker.operation || marker.answer !== observedMarker.answer) return false;
    if (marker?.onInteraction) for (const event of events) document.removeEventListener(event, marker.onInteraction, true);
    delete owner[name];
    return true;
  }, { name: markerName, events: interactionEvents, observedMarker: marker });
}
