// Клиент REST API портала. Все запросы идут через Nginx с проверкой единого входа.

export class ApiError extends Error {
  constructor(status, message, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

/** Сессия истекла или её нет: перезагружаемся в процедуру входа и вернёмся на ту же страницу */
export function relogin() {
  const rd = window.location.pathname + window.location.search + window.location.hash;
  window.location.assign('/oauth2/start?rd=' + encodeURIComponent(rd));
}

export async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      ...opts,
    });
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером');
  }
  // 401 от Nginx или редирект на страницу входа (opaqueredirect) — сессия закончилась
  if (res.status === 401 || res.type === 'opaqueredirect') {
    relogin();
    throw new ApiError(401, 'Сессия истекла, выполняется вход…');
  }
  if (res.status === 204) return null;
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* не JSON */
  }
  if (!res.ok) {
    // FastAPI: {detail: "..."} или {detail: {detail, fields}}
    const d = body?.detail;
    const message = (typeof d === 'string' ? d : d?.detail) || `Сервер ответил ${res.status}`;
    const fields = body?.fields || d?.fields || {};
    if (res.status === 403) throw new ApiError(403, message || 'Недостаточно прав', fields);
    throw new ApiError(res.status, message, fields);
  }
  return body;
}

export const systemsApi = {
  list: () => api('/systems'),
  create: (item) => api('/systems', { method: 'POST', body: JSON.stringify(item) }),
  update: (item) => api(`/systems/${encodeURIComponent(item.id)}`, { method: 'PUT', body: JSON.stringify(item) }),
  remove: (id) => api(`/systems/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  replaceAll: (list, action = 'import', source = '') =>
    api(`/systems?action=${action}&source=${encodeURIComponent(source)}`, { method: 'PUT', body: JSON.stringify(list) }),
};

export const meApi = () => api('/me');
export const auditApi = (limit = 300) => api(`/audit?limit=${limit}`);
export const statusApi = (refresh = false) => api(refresh ? '/status/refresh' : '/status', { method: refresh ? 'POST' : 'GET' });
