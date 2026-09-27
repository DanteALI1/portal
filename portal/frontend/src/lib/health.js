import { useCallback, useEffect, useRef, useState } from 'react';
import { statusApi } from './api.js';

/*
 * Мониторинг: системы проверяет сервер портала напрямую по внутренним адресам,
 * в обход единого входа (иначе страница входа выглядела бы как «работает»).
 * Браузер только забирает готовые статусы и историю из GET /api/status.
 */

// Серверная запись → формат, который ждут карточки и таблицы
function toHealth(entry) {
  if (!entry) return undefined;
  const last = entry.checkedAt
    ? {
        ts: Date.parse(entry.checkedAt),
        ok: entry.status === 'unknown' ? null : entry.status !== 'offline',
        latency: entry.latencyMs,
        code: entry.httpCode,
        error: entry.status === 'online' || entry.status === 'degraded' ? null : entry.detail,
        status: entry.status,
        detail: entry.detail,
      }
    : null;
  return { last, history: entry.history || [], checking: false };
}

export function stateOf(sample) {
  if (!sample) return 'unknown';
  if (sample.status) return sample.status;
  if (sample.ok === null) return 'unknown';
  return sample.ok ? 'online' : 'offline';
}

export const STATE_LABEL = {
  online: 'Работает',
  degraded: 'Медленно',
  offline: 'Недоступна',
  checking: 'Проверка…',
  unknown: 'Нет данных',
};

const known = (history) => (history || []).filter((h) => h.ok !== null && h.ok !== undefined);

export function uptime(history) {
  const xs = known(history);
  if (!xs.length) return null;
  return (xs.filter((h) => h.ok).length / xs.length) * 100;
}

export function avgLatency(history) {
  const xs = known(history).filter((h) => h.ok && h.latency != null).map((h) => h.latency);
  if (!xs.length) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/** Хук мониторинга: периодически забирает статусы с сервера */
export function useHealth(systems, intervalSec, onTransition, enabled = true) {
  const [health, setHealth] = useState({});
  const [components, setComponents] = useState([]);
  const [lastRun, setLastRun] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const systemsRef = useRef(systems);
  systemsRef.current = systems;
  const transitionRef = useRef(onTransition);
  transitionRef.current = onTransition;
  const prevStates = useRef({});

  const apply = useCallback((data) => {
    const next = {};
    for (const [id, entry] of Object.entries(data.systems || {})) next[id] = toHealth(entry);
    // Уведомления о смене состояния (только между «работает» и «недоступна»)
    for (const sys of systemsRef.current) {
      const now = stateOf(next[sys.id]?.last);
      const before = prevStates.current[sys.id];
      if (before && before !== now && [before, now].includes('offline') && ![before, now].includes('unknown')) {
        queueMicrotask(() => transitionRef.current?.(sys, before, now));
      }
      prevStates.current[sys.id] = now;
    }
    setHealth(next);
    setComponents(
      (data.components || []).map((c) => ({ id: c.id, name: c.name, ...toHealth(c), state: c.status })),
    );
    setLastRun(data.checkedAt ? Date.parse(data.checkedAt) : Date.now());
    setError(null);
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      if (!enabled) return;
      if (refresh) setRunning(true);
      try {
        apply(await statusApi(refresh));
      } catch (e) {
        setError(e.message || 'Не удалось получить статусы');
      } finally {
        if (refresh) setRunning(false);
      }
    },
    [apply, enabled],
  );

  const checkAll = useCallback(() => load(true), [load]);
  // Проверка одной системы = свежая проверка на сервере (не чаще раза в 5 с)
  const checkOne = useCallback(() => load(true), [load]);

  const idsKey = systems.map((s) => s.id + s.url + (s.healthUrl || '') + (s.internalHealthUrl || '')).join('|');
  useEffect(() => {
    if (!systems.length) return;
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, enabled]);

  useEffect(() => {
    if (!intervalSec || !enabled) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load(false);
    }, intervalSec * 1000);
    return () => clearInterval(id);
  }, [intervalSec, load, enabled]);

  const gatewayRaw = components.find((c) => c.id === 'gateway');
  const gateway = gatewayRaw
    ? { state: gatewayRaw.state, last: gatewayRaw.last, history: gatewayRaw.history }
    : { state: 'unknown', history: [] };

  return { health, gateway, components, lastRun, running, error, checkAll, checkOne };
}
