(() => {
  'use strict';

  const POLL_INTERVAL_MS = 5000;
  const endpoints = {
    status: '/api/status',
    histories: '/api/histories',
  };

  const state = {
    status: null,
    histories: [],
    selectedId: null,
    details: new Map(),
    loaded: {
      status: false,
      histories: false,
    },
    detailLoading: false,
    refreshInFlight: false,
    refreshSequence: 0,
    detailSequence: 0,
    errors: {
      status: null,
      histories: null,
      detail: null,
    },
  };

  const elements = {
    serviceState: document.querySelector('#serviceState'),
    refreshButton: document.querySelector('#refreshButton'),
    errorNotice: document.querySelector('#errorNotice'),
    proxyName: document.querySelector('#proxyName'),
    upstreamBaseUrl: document.querySelector('#upstreamBaseUrl'),
    retentionSummary: document.querySelector('#retentionSummary'),
    startedAt: document.querySelector('#startedAt'),
    historyTabs: document.querySelector('#historyTabs'),
    lastRefreshed: document.querySelector('#lastRefreshed'),
    emptyState: document.querySelector('#emptyState'),
    emptyTitle: document.querySelector('#emptyTitle'),
    emptyDescription: document.querySelector('#emptyDescription'),
    historyView: document.querySelector('#historyView'),
    historyTitle: document.querySelector('#historyTitle'),
    historyId: document.querySelector('#historyId'),
    historyLastActiveAt: document.querySelector('#historyLastActiveAt'),
    historyExpiresAt: document.querySelector('#historyExpiresAt'),
    historyActiveRequests: document.querySelector('#historyActiveRequests'),
    historyModelEffort: document.querySelector('#historyModelEffort'),
    detailLoading: document.querySelector('#detailLoading'),
    messageCount: document.querySelector('#messageCount'),
    messagesList: document.querySelector('#messagesList'),
    updateCount: document.querySelector('#updateCount'),
    updatesList: document.querySelector('#updatesList'),
  };

  const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function formatDateTime(timestamp) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      return '—';
    }

    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
  }

  function formatHistoryTitle(history) {
    return typeof history.title === 'string' && history.title.trim() !== ''
      ? history.title
      : '未命名 history';
  }

  function formatCount(value, suffix) {
    return typeof value === 'number' && Number.isFinite(value)
      ? `${value}${suffix}`
      : `—${suffix}`;
  }

  function formatError(error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      return '无法连接代理，请检查服务状态。';
    }

    return error instanceof Error && error.message
      ? error.message
      : '读取数据失败。';
  }

  async function fetchJSON(url) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`请求失败（HTTP ${response.status}）`);
    }

    return response.json();
  }

  function setText(element, value) {
    element.textContent = value === null || value === undefined ? '—' : String(value);
  }

  function setError(kind, error) {
    state.errors[kind] = error;
    renderError();
  }

  function clearError(kind) {
    state.errors[kind] = null;
    renderError();
  }

  function renderError() {
    const messages = Object.entries(state.errors)
      .filter(([, error]) => error)
      .map(([kind, error]) => {
        const prefix = kind === 'detail' ? '当前 history' : kind === 'status' ? '代理状态' : 'history 列表';
        return `${prefix}：${formatError(error)}`;
      });

    elements.errorNotice.hidden = messages.length === 0;
    elements.errorNotice.textContent = messages.join('；');
  }

  function renderStatus() {
    const status = state.status;

    if (status) {
      setText(elements.proxyName, status.name || '未命名代理');
      setText(elements.upstreamBaseUrl, status.upstreamBaseUrl || '—');
      const retention = formatCount(status.retentionHours, ' 小时');
      const messageLimit = formatCount(status.latestMessageLimit, ' 条消息');
      setText(elements.retentionSummary, `${retention} · 最近 ${messageLimit}`);
      setText(elements.startedAt, formatDateTime(status.startedAt));
    }

    const hasStatusError = Boolean(state.errors.status);
    const hasData = state.loaded.status || state.loaded.histories;
    elements.serviceState.dataset.state = hasStatusError ? 'error' : hasData ? 'ready' : 'loading';
    elements.serviceState.textContent = hasStatusError ? '连接异常' : hasData ? '已连接' : '连接中';
  }

  function renderRefreshButton() {
    elements.refreshButton.disabled = state.refreshInFlight;
    elements.refreshButton.textContent = state.refreshInFlight ? '刷新中…' : '刷新';
  }

  function createTab(history, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(history.id === state.selectedId));
    button.tabIndex = history.id === state.selectedId ? 0 : -1;
    button.dataset.historyId = history.id;

    const title = document.createElement('strong');
    title.className = 'history-tab-title';
    title.textContent = formatHistoryTitle(history);

    const activity = document.createElement('span');
    activity.className = 'history-tab-meta';
    activity.textContent = `最后活动 ${formatDateTime(history.lastActiveAt)}`;

    const expiry = document.createElement('span');
    expiry.className = 'history-tab-meta history-tab-expiry';
    expiry.textContent = `到期 ${formatDateTime(history.expiresAt)}`;

    const position = document.createElement('span');
    position.className = 'history-tab-index';
    position.textContent = String(index + 1).padStart(2, '0');

    button.append(title, activity, expiry, position);
    button.addEventListener('click', () => selectHistory(history.id));
    return button;
  }

  function renderTabs() {
    elements.historyTabs.replaceChildren();

    state.histories.forEach((history, index) => {
      elements.historyTabs.append(createTab(history, index));
    });
  }

  function renderEmptyState() {
    const hasHistories = state.histories.length > 0;
    const loaded = state.loaded.histories;

    elements.emptyState.hidden = hasHistories;
    if (hasHistories) {
      return;
    }

    if (!loaded) {
      elements.emptyTitle.textContent = '正在读取 history';
      elements.emptyDescription.textContent = '从代理读取仍在保留的记录。';
      return;
    }

    elements.emptyTitle.textContent = '暂无保留的 history';
    const retentionHours = state.status && Number.isFinite(state.status.retentionHours)
      ? state.status.retentionHours
      : 24;
    elements.emptyDescription.textContent = `超过 ${retentionHours} 小时没有活动的 history 会自动清理。浏览页面不会延长保留时间。`;
  }

  function renderHistoryMetadata(history) {
    setText(elements.historyTitle, formatHistoryTitle(history));
    setText(elements.historyId, history.id || '—');
    setText(elements.historyLastActiveAt, formatDateTime(history.lastActiveAt));
    setText(elements.historyExpiresAt, formatDateTime(history.expiresAt));
    setText(elements.historyActiveRequests, formatCount(history.activeRequests, ' 个'));

    const model = history.model || '—';
    const effort = history.effort || '—';
    setText(elements.historyModelEffort, `${model} / ${effort}`);
  }

  function renderMessage(message) {
    const article = document.createElement('article');
    article.className = 'message-item';

    const header = document.createElement('div');
    header.className = 'item-heading';

    const label = document.createElement('span');
    label.className = 'item-label';
    const role = typeof message.role === 'string' && message.role.trim() !== '' ? message.role : message.type;
    label.textContent = role === 'user' ? '用户' : role === 'assistant' ? '助手' : role === 'system' ? '系统' : role || '消息';

    const index = document.createElement('span');
    index.className = 'item-index';
    index.textContent = typeof message.index === 'number' ? `第 ${message.index} 条` : '消息';

    header.append(label, index);

    const body = document.createElement('p');
    body.className = 'message-body';
    body.textContent = typeof message.text === 'string' && message.text !== '' ? message.text : '（空消息）';

    const footer = document.createElement('div');
    footer.className = 'item-footer';
    if (message.truncated === true) {
      const truncated = document.createElement('span');
      truncated.textContent = '内容已截断';
      footer.append(truncated);
    }

    article.append(header, body, footer);
    return article;
  }

  function renderMessages(messages) {
    elements.messagesList.replaceChildren();
    const list = Array.isArray(messages) ? messages : [];
    elements.messageCount.textContent = `${list.length} 条`;

    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'panel-empty';
      empty.textContent = '这个 history 暂无可显示的最近消息。';
      elements.messagesList.append(empty);
      return;
    }

    list.forEach((message) => elements.messagesList.append(renderMessage(message)));
  }

  function stringifyItem(item) {
    try {
      return JSON.stringify(item, null, 2);
    } catch {
      return '{}';
    }
  }

  function updatePositionLabel(index) {
    if (index === 0) {
      return '插在历史开头';
    }

    return typeof index === 'number' && Number.isFinite(index)
      ? `插在第 ${index} 条输入之后`
      : '插入位置未知';
  }

  function renderUpdate(update) {
    const article = document.createElement('article');
    article.className = 'update-item';

    const header = document.createElement('div');
    header.className = 'item-heading';

    const position = document.createElement('span');
    position.className = 'item-label update-label';
    position.textContent = updatePositionLabel(update.afterInputIndex);

    const createdAt = document.createElement('span');
    createdAt.className = 'item-index';
    createdAt.textContent = formatDateTime(update.createdAt);
    header.append(position, createdAt);

    const json = stringifyItem(update.item);
    const code = document.createElement('pre');
    code.className = 'json-block';
    code.textContent = json;

    const footer = document.createElement('div');
    footer.className = 'json-footer';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'button button-small';
    copy.textContent = '复制 JSON';
    copy.addEventListener('click', () => copyJSON(json, copy));
    footer.append(copy);

    article.append(header, code, footer);
    return article;
  }

  function renderUpdates(updates) {
    elements.updatesList.replaceChildren();
    const list = Array.isArray(updates) ? updates : [];
    elements.updateCount.textContent = `${list.length} 条`;

    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'panel-empty';
      empty.textContent = '这个 history 没有代理插入的配置更新。';
      elements.updatesList.append(empty);
      return;
    }

    list.forEach((update) => elements.updatesList.append(renderUpdate(update)));
  }

  function renderDetails() {
    const selected = state.histories.find((history) => history.id === state.selectedId);
    if (!selected) {
      elements.historyView.hidden = true;
      return;
    }

    elements.historyView.hidden = false;
    renderHistoryMetadata(state.details.get(state.selectedId)?.history || selected);

    const detail = state.details.get(state.selectedId);
    renderMessages(detail?.recentMessages);
    renderUpdates(detail?.updates);
    elements.detailLoading.hidden = !state.detailLoading;
  }

  function renderAll() {
    renderStatus();
    renderRefreshButton();
    renderTabs();
    renderEmptyState();
    renderDetails();
    renderError();
  }

  async function copyJSON(value, button) {
    let copied = false;

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
      textarea.remove();
    }

    const original = button.textContent;
    button.textContent = copied ? '已复制' : '复制失败';
    button.disabled = copied;
    window.setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1600);
  }

  async function loadDetails(historyId) {
    if (!historyId) {
      return;
    }

    const sequence = ++state.detailSequence;
    state.detailLoading = true;
    clearError('detail');
    renderDetails();

    try {
      const encodedId = encodeURIComponent(historyId);
      const payload = await fetchJSON(`/api/histories/${encodedId}`);
      if (sequence !== state.detailSequence || state.selectedId !== historyId) {
        return;
      }

      if (!isRecord(payload) || !isRecord(payload.history)) {
        throw new Error('详情响应格式无效');
      }

      state.details.set(historyId, {
        history: payload.history,
        recentMessages: Array.isArray(payload.recentMessages) ? payload.recentMessages : [],
        updates: Array.isArray(payload.updates) ? payload.updates : [],
      });
      clearError('detail');
    } catch (error) {
      if (sequence === state.detailSequence && state.selectedId === historyId) {
        setError('detail', error);
      }
    } finally {
      if (sequence === state.detailSequence && state.selectedId === historyId) {
        state.detailLoading = false;
        renderDetails();
      }
    }
  }

  function selectHistory(historyId) {
    if (!state.histories.some((history) => history.id === historyId)) {
      return;
    }

    if (state.selectedId === historyId && state.details.has(historyId)) {
      return;
    }

    state.selectedId = historyId;
    state.detailLoading = true;
    state.detailSequence += 1;
    clearError('detail');
    renderAll();
    void loadDetails(historyId);
  }

  function applyHistories(histories) {
    const previousSelectedId = state.selectedId;
    state.histories = histories;

    if (histories.length === 0) {
      state.selectedId = null;
      state.detailLoading = false;
      state.detailSequence += 1;
      renderAll();
      return null;
    }

    const selectedStillExists = histories.some((history) => history.id === previousSelectedId);
    if (!selectedStillExists) {
      state.selectedId = histories[0].id;
      state.detailLoading = true;
      state.detailSequence += 1;
    }

    renderAll();
    return state.selectedId;
  }

  async function refreshData() {
    if (state.refreshInFlight) {
      return;
    }

    state.refreshInFlight = true;
    const sequence = ++state.refreshSequence;
    renderRefreshButton();

    const results = await Promise.allSettled([
      fetchJSON(endpoints.status),
      fetchJSON(endpoints.histories),
    ]);

    if (sequence !== state.refreshSequence) {
      state.refreshInFlight = false;
      renderRefreshButton();
      return;
    }

    let selectedIdToLoad = null;

    const statusResult = results[0];
    if (statusResult.status === 'fulfilled') {
      state.status = statusResult.value;
      state.loaded.status = true;
      clearError('status');
    } else {
      setError('status', statusResult.reason);
    }

    const historiesResult = results[1];
    if (historiesResult.status === 'fulfilled') {
      const payload = historiesResult.value;
      if (isRecord(payload) && Array.isArray(payload.histories)) {
        state.loaded.histories = true;
        clearError('histories');
        selectedIdToLoad = applyHistories(payload.histories.filter(isRecord));
      } else {
        setError('histories', new Error('history 列表响应格式无效'));
      }
    } else {
      setError('histories', historiesResult.reason);
    }

    setText(elements.lastRefreshed, `最近刷新 ${formatDateTime(Date.now())}`);
    renderAll();

    if (selectedIdToLoad) {
      await loadDetails(selectedIdToLoad);
    }

    state.refreshInFlight = false;
    renderRefreshButton();
  }

  elements.refreshButton.addEventListener('click', () => {
    void refreshData();
  });

  elements.historyTabs.addEventListener('keydown', (event) => {
    const tabs = Array.from(elements.historyTabs.querySelectorAll('[role="tab"]'));
    const currentIndex = tabs.indexOf(document.activeElement);
    if (currentIndex < 0 || tabs.length === 0) {
      return;
    }

    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  });

  renderAll();
  void refreshData();
  window.setInterval(() => {
    void refreshData();
  }, POLL_INTERVAL_MS);
})();
