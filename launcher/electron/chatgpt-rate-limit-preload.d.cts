export interface ChatGptRateLimitProtocol {
  readonly stateId: string;
  readonly scanEvent: string;
  readonly dialogSelector: string;
  readonly titlePattern: string;
  readonly buttonPattern: string;
  readonly closeTimeoutMs: number;
}
export const chatGptRateLimitProtocol: ChatGptRateLimitProtocol;
export function installChatGptRateLimitHandler(protocol: ChatGptRateLimitProtocol): void;
