import { DEFAULT_SYSTEMS } from './defaults.js';

// Безопасная обёртка над localStorage: в приватном режиме или при запрете
// хранилища портал продолжает работать, просто без сохранения.
export const store = {
  get(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* хранилище недоступно */
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const SYSTEMS_KEY = 'portal.systems.v1';

/** Репозиторий систем в браузере пользователя */
export function createLocalRepo() {
  return {
    mode: 'local',
    async list() {
      return store.get(SYSTEMS_KEY, null) ?? structuredClone(DEFAULT_SYSTEMS);
    },
    async save(list) {
      store.set(SYSTEMS_KEY, list);
    },
    async create(item, list) {
      await this.save([...list, item]);
      return item;
    },
    async update(item, list) {
      await this.save(list.map((s) => (s.id === item.id ? item : s)));
      return item;
    },
    async remove(id, list) {
      await this.save(list.filter((s) => s.id !== id));
    },
    async replaceAll(list) {
      await this.save(list);
    },
  };
}

/**
 * Репозиторий систем на сервере (общий список для всех пользователей).
 * Ожидаемый контракт REST API:
 *   GET    {apiBase}/systems        → PortalSystem[]
 *   POST   {apiBase}/systems        → PortalSystem
 *   PUT    {apiBase}/systems/:id    → PortalSystem
 *   DELETE {apiBase}/systems/:id    → 204
 *   PUT    {apiBase}/systems        → замена всего списка (импорт)
 */
export function createApiRepo(apiBase) {
  const base = apiBase.replace(/\/$/, '');
  async function req(path, opts = {}) {
    const res = await fetch(base + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opts,
    });
    if (!res.ok) throw new Error(`Сервер ответил ${res.status} ${res.statusText}`);
    return res.status === 204 ? null : res.json();
  }
  return {
    mode: 'api',
    list: () => req('/systems'),
    create: (item) => req('/systems', { method: 'POST', body: JSON.stringify(item) }),
    update: (item) => req(`/systems/${encodeURIComponent(item.id)}`, { method: 'PUT', body: JSON.stringify(item) }),
    remove: (id) => req(`/systems/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    replaceAll: (list) => req('/systems', { method: 'PUT', body: JSON.stringify(list) }),
  };
}

export function slugify(name) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
    л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
    ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const base = name
    .toLowerCase()
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return (base || 'system') + '-' + Math.random().toString(36).slice(2, 6);
}
