import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from './config.js';

const HISTORY = 40;

/**
 * Проверка доступности одного адреса.
 * Для маршрутов на том же домене (/netbox/, /wiki/) читается реальный HTTP-код:
 * 502/503/504 от Nginx означают, что контейнер недоступен.
 * Для внешних адресов используется no-cors: доступен/недоступен без кода.
 */
export async function probe(url, timeoutMs = 8000) {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const target = new URL(url, window.location.href);
    const sameOrigin = target.origin === window.location.origin;
    const res = await fetch(target.href, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
      credentials: 'same-origin',
      mode: sameOrigin ? 'same-origin' : 'no-cors',
      signal: ctrl.signal,
    });
    const latency = Math.round(performance.now() - started);
    if (res.type === 'opaque' || res.type === 'opaqueredirect') {
      return { ts: Date.now(), ok: true, latency, code: null };
    }
    const ok = res.status < 500;
    return { ts: Date.now(), ok, latency, code: res.status };
  } catch (e) {
    return {
      ts: Date.now(),
      ok: false,
      latency: null,
      code: null,
      error: e.name === 'AbortError' ? 'Превышено время ожидания' : 'Нет соединения',
    };
  } finally {
    clearTimeout(timer);
  }
}

// Имитация проверки для демо-режима
async function demoProbe(url) {
  await new Promise((r) => setTimeout(r, 250 + Math.random() * 700));
  const seed = [...url].reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 40 + (seed % 120);
  return { ts: Date.now(), ok: true, latency: Math.round(base + Math.random() * 60), code: 200 };
}

function seedHistory(url) {
  const now = Date.now();
  const seed = [...url].reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 40 + (seed % 120);
  return Array.from({ length: HISTORY - 1 }, (_, i) => ({
    ts: now - (HISTORY - 1 - i) * 60_000,
    ok: true,
    latency: Math.round(base + Math.sin(i / 3 + seed) * 25 + Math.random() * 30),
    code: 200,
  }));
}

export function stateOf(sample) {
  if (!sample) return 'unknown';
  if (!sample.ok) return 'offline';
  if (sample.latency != null && sample.latency > config.slowThresholdMs) return 'degraded';
  return 'online';
}

export const STATE_LABEL = {
  online: 'Работает',
  degraded: 'Медленно',
  offline: 'Недоступна',
  checking: 'Проверка…',
  unknown: 'Нет данных',
};

export function uptime(history) {
  if (!history?.length) return null;
  return (history.filter((h) => h.ok).length / history.length) * 100;
}

export function avgLatency(history) {
  const xs = (history || []).filter((h) => h.ok && h.latency != null).map((h) => h.latency);
  if (!xs.length) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/** Хук мониторинга: периодически проверяет все системы и шлюз */
export function useHealth(systems, intervalSec, onTransition) {
  const [health, setHealth] = useState({});
  const [gateway, setGateway] = useState({ state: 'unknown', history: [] });
  const [lastRun, setLastRun] = useState(null);
  const [running, setRunning] = useState(false);
  const systemsRef = useRef(systems);
  systemsRef.current = systems;
  const transitionRef = useRef(onTransition);
  transitionRef.current = onTransition;
  const doProbe = config.demo ? demoProbe : probe;

  const checkOne = useCallback(
    async (sys) => {
      setHealth((h) => ({
        ...h,
        [sys.id]: { ...(h[sys.id] || { history: config.demo ? seedHistory(sys.url) : [] }), checking: true },
      }));
      const sample = await doProbe(sys.healthUrl || sys.url);
      setHealth((h) => {
        const prev = h[sys.id] || { history: [] };
        const history = [...(prev.history || []), sample].slice(-HISTORY);
        const prevState = prev.last ? stateOf(prev.last) : null;
        const nextState = stateOf(sample);
        if (prevState && prevState !== nextState) {
          queueMicrotask(() => transitionRef.current?.(sys, prevState, nextState));
        }
        return { ...h, [sys.id]: { last: sample, history, checking: false } };
      });
    },
    [doProbe],
  );

  const checkGateway = useCallback(async () => {
    const sample = await doProbe(config.gatewayHealthUrl);
    setGateway((g) => ({ state: stateOf(sample), last: sample, history: [...g.history, sample].slice(-HISTORY) }));
  }, [doProbe]);

  const checkAll = useCallback(async () => {
    setRunning(true);
    await Promise.all([checkGateway(), ...systemsRef.current.map((s) => checkOne(s))]);
    setLastRun(Date.now());
    setRunning(false);
  }, [checkOne, checkGateway]);

  // Первая проверка и проверка новых систем
  const idsKey = systems.map((s) => s.id + s.url + (s.healthUrl || '')).join('|');
  useEffect(() => {
    if (!systems.length) return;
    checkAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => {
    if (!intervalSec) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') checkAll();
    }, intervalSec * 1000);
    return () => clearInterval(id);
  }, [intervalSec, checkAll]);

  return { health, gateway, lastRun, running, checkAll, checkOne };
}
