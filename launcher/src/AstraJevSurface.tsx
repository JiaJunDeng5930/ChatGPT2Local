import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "./icons";
import type {
  AstraJevSettingsInput,
  AstraJevState,
  HistoryDetail,
  HistorySummary,
  JevProvider,
  Language,
} from "./types";

const POLL_INTERVAL_MS = 5_000;
const MAX_VISIBLE_MESSAGES = 8;

interface AstraJevSurfaceProps {
  language: Language;
}

interface AstraJevLabels {
  title: string;
  eyebrow: string;
  subtitle: string;
  refresh: string;
  refreshing: string;
  configured: string;
  unconfigured: string;
  provider: string;
  apiKey: string;
  apiKeyPlaceholderConfigured: string;
  apiKeyPlaceholderMissing: string;
  clearApiKey: string;
  clearApiKeyBody: string;
  save: string;
  saving: string;
  saved: string;
  endpoint: string;
  timeout: string;
  retention: string;
  messageLimit: string;
  efforts: string;
  histories: string;
  autoRefresh: string;
  noHistories: string;
  noHistoriesBody: string;
  loading: string;
  historyExpired: string;
  noDetail: string;
  historyId: string;
  lastActive: string;
  expires: string;
  activeRequests: string;
  modelEffort: string;
  recentMessages: string;
  updates: string;
  noMessages: string;
  noUpdates: string;
  user: string;
  assistant: string;
  system: string;
  message: string;
  emptyMessage: string;
  truncated: string;
  copyJson: string;
  copied: string;
  copyFailed: string;
  updatePositionStart: string;
  updatePositionAfter: string;
  updatePositionUnknown: string;
  notAvailable: string;
  saveError: string;
}

const englishLabels: AstraJevLabels = {
  title: "Astra Jev",
  eyebrow: "MODEL ROUTE",
  subtitle: "Configure the Jev provider and inspect retained request history.",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  configured: "Configured",
  unconfigured: "API key required",
  provider: "Provider",
  apiKey: "API key",
  apiKeyPlaceholderConfigured: "Leave blank to keep the saved key",
  apiKeyPlaceholderMissing: "Enter a provider API key",
  clearApiKey: "Clear saved API key",
  clearApiKeyBody: "This is explicit and cannot be undone from the launcher.",
  save: "Save settings",
  saving: "Saving…",
  saved: "Settings saved",
  endpoint: "Endpoint",
  timeout: "Timeout",
  retention: "Retention",
  messageLimit: "Recent messages",
  efforts: "Supported efforts",
  histories: "Retained history",
  autoRefresh: "Refreshes every 5 seconds while visible",
  noHistories: "No retained history",
  noHistoriesBody: "Histories with no activity for 24 hours are cleaned up automatically. Viewing this surface does not extend retention.",
  loading: "Loading…",
  historyExpired: "This history is missing or expired. The list will refresh shortly.",
  noDetail: "Select a history to inspect its recent messages and updates.",
  historyId: "History ID",
  lastActive: "Last active",
  expires: "Expires",
  activeRequests: "Active requests",
  modelEffort: "Model / effort",
  recentMessages: "Recent messages",
  updates: "Configuration updates",
  noMessages: "This history has no displayable recent messages.",
  noUpdates: "This history has no injected configuration updates.",
  user: "User",
  assistant: "Assistant",
  system: "System",
  message: "Message",
  emptyMessage: "(empty message)",
  truncated: "Content truncated",
  copyJson: "Copy JSON",
  copied: "Copied",
  copyFailed: "Copy failed",
  updatePositionStart: "Inserted at the start",
  updatePositionAfter: "Inserted after input {index}",
  updatePositionUnknown: "Insertion position unknown",
  notAvailable: "—",
  saveError: "Unable to save settings.",
};

const chineseLabels: AstraJevLabels = {
  title: "Astra Jev",
  eyebrow: "模型路由",
  subtitle: "配置 Jev provider，并查看仍在保留的请求 history。",
  refresh: "刷新",
  refreshing: "刷新中…",
  configured: "已配置",
  unconfigured: "需要 API key",
  provider: "Provider",
  apiKey: "API key",
  apiKeyPlaceholderConfigured: "留空以保留已保存的 key",
  apiKeyPlaceholderMissing: "输入 provider API key",
  clearApiKey: "清除已保存的 API key",
  clearApiKeyBody: "这是明确操作，启动器不会提供撤销入口。",
  save: "保存配置",
  saving: "保存中…",
  saved: "配置已保存",
  endpoint: "Endpoint",
  timeout: "超时",
  retention: "保留时间",
  messageLimit: "最近消息",
  efforts: "支持的 effort",
  histories: "保留的 history",
  autoRefresh: "界面可见时每 5 秒刷新",
  noHistories: "暂无保留的 history",
  noHistoriesBody: "连续 24 小时没有活动的 history 会自动清理，查看页面不会延长保留时间。",
  loading: "读取中…",
  historyExpired: "这个 history 不存在或已过期，列表会很快刷新。",
  noDetail: "选择一个 history 查看最近消息和配置更新。",
  historyId: "History ID",
  lastActive: "最后活动",
  expires: "到期时间",
  activeRequests: "活动请求",
  modelEffort: "模型 / effort",
  recentMessages: "最近消息",
  updates: "配置更新",
  noMessages: "这个 history 没有可显示的最近消息。",
  noUpdates: "这个 history 没有代理插入的配置更新。",
  user: "用户",
  assistant: "助手",
  system: "系统",
  message: "消息",
  emptyMessage: "（空消息）",
  truncated: "内容已截断",
  copyJson: "复制 JSON",
  copied: "已复制",
  copyFailed: "复制失败",
  updatePositionStart: "插在 history 开头",
  updatePositionAfter: "插在第 {index} 条输入之后",
  updatePositionUnknown: "插入位置未知",
  notAvailable: "—",
  saveError: "无法保存配置。",
};

function labelsFor(language: Language): AstraJevLabels {
  return language === "zh-CN" || language === "zh-TW" ? chineseLabels : englishLabels;
}

function localeFor(language: Language): string {
  if (language === "zh-CN") return "zh-CN";
  if (language === "zh-TW") return "zh-TW";
  if (language === "ja") return "ja-JP";
  if (language === "ko") return "ko-KR";
  return "en-US";
}

function errorMessage(value: unknown, secret = ""): string {
  const raw = value instanceof Error ? value.message : String(value);
  return secret && raw.includes(secret) ? raw.replaceAll(secret, "[redacted]") : raw;
}

function isExpiredHistoryError(value: unknown): boolean {
  const candidate = value as { status?: unknown; code?: unknown } | null;
  return candidate?.status === 404
    || candidate?.code === "history_not_found"
    || /missing or expired|not found|expired/i.test(errorMessage(value));
}

function formatDateTime(value: number, language: Language, fallback: string): string {
  if (!Number.isFinite(value)) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(localeFor(language), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function historyTitle(history: HistorySummary, fallback: string): string {
  return history.title.trim() || fallback;
}

function providerLabel(provider: JevProvider): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "typesafe") return "TypeSafe";
  return "Vercel";
}

function formatUpdatePosition(index: number, labels: AstraJevLabels): string {
  if (index === 0) return labels.updatePositionStart;
  if (Number.isFinite(index)) return labels.updatePositionAfter.replace("{index}", String(index));
  return labels.updatePositionUnknown;
}

export function AstraJevSurface({ language }: AstraJevSurfaceProps) {
  const labels = useMemo(() => labelsFor(language), [language]);
  const api = window.codexWebLauncher;
  const mountedRef = useRef(true);
  const stateSequenceRef = useRef(0);
  const detailSequenceRef = useRef(0);
  const stateInFlightRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const refreshStateRef = useRef<(() => Promise<void>) | null>(null);
  const formInitializedRef = useRef(false);
  const [state, setState] = useState<AstraJevState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, HistoryDetail>>({});
  const [stateLoading, setStateLoading] = useState(true);
  const [stateRefreshing, setStateRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [provider, setProvider] = useState<JevProvider>("vercel");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [copiedUpdateId, setCopiedUpdateId] = useState<string | null>(null);

  const loadHistory = useCallback(async (historyId: string) => {
    if (!api) return;
    const sequence = ++detailSequenceRef.current;
    selectedIdRef.current = historyId;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const next = await api.getAstraJevHistory(historyId);
      if (!mountedRef.current || sequence !== detailSequenceRef.current || selectedIdRef.current !== historyId) return;
      setDetails((current) => ({ ...current, [historyId]: next }));
    } catch (cause) {
      if (!mountedRef.current || sequence !== detailSequenceRef.current || selectedIdRef.current !== historyId) return;
      if (isExpiredHistoryError(cause)) {
        setDetails((current) => {
          const next = { ...current };
          delete next[historyId];
          return next;
        });
        setDetailError(labels.historyExpired);
        void refreshStateRef.current?.();
      } else {
        setDetailError(errorMessage(cause));
      }
    } finally {
      if (mountedRef.current && sequence === detailSequenceRef.current && selectedIdRef.current === historyId) {
        setDetailLoading(false);
      }
    }
  }, [api, labels.historyExpired]);

  const refreshState = useCallback(async () => {
    if (!api || stateInFlightRef.current) return;
    stateInFlightRef.current = true;
    const sequence = ++stateSequenceRef.current;
    setStateRefreshing(true);
    try {
      const next = await api.getAstraJevState();
      if (!mountedRef.current || sequence !== stateSequenceRef.current) return;
      const histories = Array.isArray(next.histories) ? next.histories : [];
      setState({ ...next, histories });
      setStateError(null);
      if (!formInitializedRef.current) {
        setProvider(next.provider);
        formInitializedRef.current = true;
      }
      const previousId = selectedIdRef.current;
      const nextId = histories.some((history) => history.id === previousId)
        ? previousId
        : histories[0]?.id ?? null;
      selectedIdRef.current = nextId;
      setSelectedId(nextId);
      if (nextId) {
        void loadHistory(nextId);
      } else {
        ++detailSequenceRef.current;
        setDetailLoading(false);
      }
    } catch (cause) {
      if (mountedRef.current && sequence === stateSequenceRef.current) {
        setStateError(errorMessage(cause));
      }
    } finally {
      if (mountedRef.current && sequence === stateSequenceRef.current) {
        stateInFlightRef.current = false;
        setStateRefreshing(false);
        setStateLoading(false);
      }
    }
  }, [api, loadHistory]);

  refreshStateRef.current = refreshState;

  useEffect(() => {
    mountedRef.current = true;
    void refreshState();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshState();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshState();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mountedRef.current = false;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      ++stateSequenceRef.current;
      ++detailSequenceRef.current;
    };
  }, [refreshState]);

  const selectedHistory = state?.histories.find((history) => history.id === selectedId) ?? null;
  const selectedDetail = selectedId ? details[selectedId] : undefined;

  const selectHistory = (historyId: string) => {
    if (!state?.histories.some((history) => history.id === historyId)) return;
    selectedIdRef.current = historyId;
    setSelectedId(historyId);
    void loadHistory(historyId);
  };

  const saveSettings = async () => {
    if (!api) return;
    const hasKey = apiKey.trim().length > 0;
    if (clearApiKey && hasKey) {
      setSettingsError(labels.clearApiKeyBody);
      return;
    }
    const input: AstraJevSettingsInput = { provider };
    if (hasKey) input.apiKey = apiKey;
    if (clearApiKey) input.clearApiKey = true;
    setSettingsBusy(true);
    setSettingsError(null);
    setSettingsNotice(null);
    try {
      const next = await api.saveAstraJevSettings(input);
      if (!mountedRef.current) return;
      setState(next);
      setProvider(next.provider);
      setApiKey("");
      setClearApiKey(false);
      setSettingsNotice(labels.saved);
      setStateError(null);
    } catch (cause) {
      if (mountedRef.current) setSettingsError(errorMessage(cause, apiKey));
    } finally {
      if (mountedRef.current) setSettingsBusy(false);
    }
  };

  const copyJson = async (updateId: string, value: string) => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.readOnly = true;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      textarea.remove();
    }
    setCopiedUpdateId(copied ? updateId : `failed:${updateId}`);
    window.setTimeout(() => setCopiedUpdateId((current) => (
      current === updateId || current === `failed:${updateId}` ? null : current
    )), 1_600);
  };

  const providerOptions: JevProvider[] = ["vercel", "typesafe", "openrouter"];
  const detailHistory = selectedDetail?.history ?? selectedHistory;
  const displayMessages = selectedDetail?.recentMessages.slice(-MAX_VISIBLE_MESSAGES) ?? [];
  const displayUpdates = selectedDetail?.updates ?? [];

  return (
    <section className="content-surface astra-jev-surface">
      <div className="content-scroll astra-jev-scroll">
        <header className="surface-header astra-jev-header">
          <span>{labels.eyebrow}</span>
          <div className="astra-jev-title-row">
            <div>
              <h1>{labels.title}</h1>
              <p>{labels.subtitle}</p>
            </div>
            <button
              className="button-secondary astra-jev-refresh"
              disabled={stateRefreshing}
              onClick={() => void refreshState()}
              type="button"
            >
              <Icon name="reload" />
              <span>{stateRefreshing ? labels.refreshing : labels.refresh}</span>
            </button>
          </div>
        </header>

        {stateError ? <div className="astra-jev-notice is-error" role="alert">{stateError}</div> : null}
        {settingsError ? <div className="astra-jev-notice is-error" role="alert">{settingsError || labels.saveError}</div> : null}
        {settingsNotice ? <div className="astra-jev-notice is-success" role="status">{settingsNotice}</div> : null}

        <section className="astra-jev-settings panel" aria-labelledby="astra-jev-settings-title">
          <div className="astra-jev-panel-heading">
            <div>
              <span className="astra-jev-eyebrow">{labels.title}</span>
              <h2 id="astra-jev-settings-title">{labels.provider}</h2>
            </div>
            <span className={`astra-jev-status${state?.configured ? " is-configured" : " is-missing"}`}>
              <i aria-hidden="true" />
              {state ? state.configured ? labels.configured : labels.unconfigured : labels.loading}
            </span>
          </div>
          <div className="astra-jev-form-grid">
            <label className="astra-jev-field">
              <span>{labels.provider}</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value as JevProvider)}>
                {providerOptions.map((option) => <option key={option} value={option}>{providerLabel(option)}</option>)}
              </select>
            </label>
            <label className="astra-jev-field">
              <span>{labels.apiKey}</span>
              <input
                autoComplete="new-password"
                placeholder={state?.configured ? labels.apiKeyPlaceholderConfigured : labels.apiKeyPlaceholderMissing}
                type="password"
                value={apiKey}
                onChange={(event) => {
                  const value = event.target.value;
                  setApiKey(value);
                  if (value.trim()) setClearApiKey(false);
                }}
              />
            </label>
          </div>
          <div className="astra-jev-settings-footer">
            <label className="astra-jev-clear-key">
              <input
                checked={clearApiKey}
                disabled={settingsBusy || apiKey.trim().length > 0}
                onChange={(event) => setClearApiKey(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>{labels.clearApiKey}</strong>
                <small>{labels.clearApiKeyBody}</small>
              </span>
            </label>
            <button className="button-primary" disabled={settingsBusy} onClick={() => void saveSettings()} type="button">
              {settingsBusy ? labels.saving : labels.save}
            </button>
          </div>
        </section>

        {state ? (
          <section className="astra-jev-runtime panel" aria-label={labels.title}>
            <div className="astra-jev-runtime-item"><span>{labels.endpoint}</span><code title={state.endpoint}>{state.endpoint}</code></div>
            <div className="astra-jev-runtime-item"><span>{labels.timeout}</span><strong>{state.timeoutMs} ms</strong></div>
            <div className="astra-jev-runtime-item"><span>{labels.retention}</span><strong>{state.retentionHours} h</strong></div>
            <div className="astra-jev-runtime-item"><span>{labels.messageLimit}</span><strong>{state.latestMessageLimit}</strong></div>
            <div className="astra-jev-runtime-item"><span>{labels.efforts}</span><strong>{state.supportedEfforts.join(" · ") || labels.notAvailable}</strong></div>
          </section>
        ) : null}

        <section className="astra-jev-history-section" aria-labelledby="astra-jev-histories-title">
          <div className="astra-jev-section-heading">
            <div>
              <span className="astra-jev-eyebrow">{labels.histories}</span>
              <h2 id="astra-jev-histories-title">{labels.histories}</h2>
            </div>
            <span className="astra-jev-refresh-hint">{labels.autoRefresh}</span>
          </div>
          <div className="astra-jev-history-tabs" role="tablist" aria-label={labels.histories}>
            {state?.histories.map((history, index) => (
              <button
                aria-selected={history.id === selectedId}
                className={`astra-jev-history-tab${history.id === selectedId ? " is-selected" : ""}`}
                key={history.id}
                onClick={() => selectHistory(history.id)}
                role="tab"
                type="button"
              >
                <strong>{historyTitle(history, `${labels.message} ${index + 1}`)}</strong>
                <span>{labels.lastActive} {formatDateTime(history.lastActiveAt, language, labels.notAvailable)}</span>
                <span>{labels.expires} {formatDateTime(history.expiresAt, language, labels.notAvailable)}</span>
                <em>{String(index + 1).padStart(2, "0")}</em>
              </button>
            ))}
          </div>
        </section>

        {!state || stateLoading ? (
          <div className="astra-jev-empty"><Icon name="activity" /><span>{labels.loading}</span></div>
        ) : state.histories.length === 0 ? (
          <div className="astra-jev-empty"><Icon name="activity" /><div><strong>{labels.noHistories}</strong><p>{labels.noHistoriesBody}</p></div></div>
        ) : !selectedHistory || !detailHistory ? (
          <div className="astra-jev-empty"><Icon name="activity" /><span>{labels.noDetail}</span></div>
        ) : (
          <section className="astra-jev-detail" aria-labelledby="astra-jev-detail-title">
            <header className="astra-jev-detail-header panel">
              <div>
                <span className="astra-jev-eyebrow">{labels.histories}</span>
                <h2 id="astra-jev-detail-title">{historyTitle(detailHistory, labels.message)}</h2>
                <code>{detailHistory.id}</code>
              </div>
              <dl className="astra-jev-metadata">
                <div><dt>{labels.lastActive}</dt><dd>{formatDateTime(detailHistory.lastActiveAt, language, labels.notAvailable)}</dd></div>
                <div><dt>{labels.expires}</dt><dd>{formatDateTime(detailHistory.expiresAt, language, labels.notAvailable)}</dd></div>
                <div><dt>{labels.activeRequests}</dt><dd>{detailHistory.activeRequests}</dd></div>
                <div><dt>{labels.modelEffort}</dt><dd>{detailHistory.model || labels.notAvailable} / {detailHistory.effort || labels.notAvailable}</dd></div>
              </dl>
            </header>
            {detailError ? <div className="astra-jev-notice is-error" role="alert">{detailError}</div> : null}
            {detailLoading ? <div className="astra-jev-detail-loading" role="status">{labels.loading}</div> : null}
            <div className="astra-jev-content-grid">
              <section className="astra-jev-content-panel panel" aria-labelledby="astra-jev-messages-title">
                <div className="astra-jev-panel-heading">
                  <div><span className="astra-jev-eyebrow">{labels.recentMessages}</span><h3 id="astra-jev-messages-title">{labels.recentMessages}</h3></div>
                  <span className="astra-jev-count">{displayMessages.length}</span>
                </div>
                {displayMessages.length === 0 ? <p className="astra-jev-panel-empty">{selectedDetail ? labels.noMessages : labels.loading}</p> : (
                  <div className="astra-jev-message-list">
                    {displayMessages.map((message) => {
                      const role = message.role?.trim() || message.type;
                      const roleLabel = role === "user" ? labels.user : role === "assistant" ? labels.assistant : role === "system" ? labels.system : role || labels.message;
                      return (
                        <article className="astra-jev-message" key={message.id}>
                          <div className="astra-jev-item-heading"><span>{roleLabel}</span><small>{message.index}</small></div>
                          <p>{message.text || labels.emptyMessage}</p>
                          {message.truncated ? <small className="astra-jev-item-note">{labels.truncated}</small> : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
              <section className="astra-jev-content-panel panel" aria-labelledby="astra-jev-updates-title">
                <div className="astra-jev-panel-heading">
                  <div><span className="astra-jev-eyebrow">{labels.updates}</span><h3 id="astra-jev-updates-title">{labels.updates}</h3></div>
                  <span className="astra-jev-count">{displayUpdates.length}</span>
                </div>
                {displayUpdates.length === 0 ? <p className="astra-jev-panel-empty">{selectedDetail ? labels.noUpdates : labels.loading}</p> : (
                  <div className="astra-jev-update-list">
                    {displayUpdates.map((update) => {
                      const json = JSON.stringify(update.item, null, 2) ?? "{}";
                      const copied = copiedUpdateId === update.id;
                      return (
                        <article className="astra-jev-update" key={update.id}>
                          <div className="astra-jev-item-heading"><span>{formatUpdatePosition(update.afterInputIndex, labels)}</span><small>{formatDateTime(update.createdAt, language, labels.notAvailable)}</small></div>
                          {update.reason ? <p className="astra-jev-update-reason">{update.reason}</p> : null}
                          <pre>{json}</pre>
                          <button className="button-secondary astra-jev-copy" onClick={() => void copyJson(update.id, json)} type="button">
                            {copied ? labels.copied : labels.copyJson}
                          </button>
                          {!copied && copiedUpdateId === `failed:${update.id}` ? <small>{labels.copyFailed}</small> : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
