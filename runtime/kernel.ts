/** Foreign representation only. Application decisions execute compiled Bend. */
import * as compiled from "../.build/core.cjs";

export { compiled };
export type State = compiled.M_application_domain.State;
export type Input = compiled.M_application_domain.Input;
export type Decision = compiled.M_application_domain.Decision;
export type Effect = compiled.M_application_domain.Effect;
export type Reply = compiled.M_application_domain.Reply;
export type Facts = compiled.M_observation_domain.Facts;
export type Invocation = compiled.M_broker_domain.Invocation;

export function list<T>(items: readonly T[]): compiled.List<T> {
  let result: compiled.List<T> = { $: "Nil" };
  for (let i = items.length - 1; i >= 0; --i) result = { $: "Con", head: items[i]!, tail: result };
  return result;
}

export function array<T>(items: compiled.List<T>): T[] {
  const result: T[] = [];
  for (let rest = items; rest.$ === "Con"; rest = rest.tail) result.push(rest.head);
  return result;
}

export function initialize(full: boolean, tools: readonly string[], environment: string): State {
  const result = compiled.app_initialize(full, list(tools), environment);
  compiled.validate("application-domain.State", result);
  return result;
}

export function transition(state: State, input: Input): Decision {
  compiled.validate("application-domain.State", state);
  compiled.validate("application-domain.Input", input);
  const result = compiled.app_step(state, input);
  compiled.validate("application-domain.Decision", result);
  return result;
}

export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? { $nat: item.toString() } : item);
}

export function decode<T>(text: string, type: string): T {
  const value: unknown = JSON.parse(text, (_key, item: unknown) => {
    if (item && typeof item === "object" && Object.keys(item).length === 1 && "$nat" in item) {
      const number = (item as { $nat: unknown }).$nat;
      if (typeof number !== "string" || !/^(0|[1-9][0-9]*)$/.test(number) || number.length > 32)
        throw new Error("Invalid persisted Bend natural number");
      return BigInt(number);
    }
    return item;
  });
  compiled.validate(type, value);
  return value as T;
}
