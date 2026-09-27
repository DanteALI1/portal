import { useMemo, useRef, useEffect } from 'react';
import Icon from '../components/Icon.jsx';
import SystemCard, { AddCard, healthState } from '../components/SystemCard.jsx';
import SystemTable from '../components/SystemTable.jsx';
import { EmptyState, Segmented } from '../components/ui.jsx';
import { avgLatency } from '../lib/health.js';
import { formatMs, greeting, plural } from '../lib/format.js';
import { config } from '../lib/config.js';

const STATUS_FILTERS = [
  { value: 'all', label: 'Все статусы' },
  { value: 'online', label: 'Работают' },
  { value: 'problem', label: 'С проблемами' },
];

const SORTS = [
  { value: 'pinned', label: 'Сначала избранные' },
  { value: 'name', label: 'По названию' },
  { value: 'status', label: 'По статусу' },
  { value: 'recent', label: 'Недавно добавленные' },
];

const ORDER = { offline: 0, degraded: 1, checking: 2, unknown: 3, online: 4 };

export default function Overview({ systems, health, gateway, prefs, setPrefs, actions, onAdd, loading }) {
  const searchRef = useRef(null);
  const { query, category, status, sort, view } = prefs;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const categories = useMemo(() => {
    const m = new Map();
    systems.forEach((s) => m.set(s.category || 'Без категории', (m.get(s.category || 'Без категории') || 0) + 1));
    return [...m.entries()];
  }, [systems]);

  const stats = useMemo(() => {
    const states = systems.map((s) => healthState(health[s.id]));
    const online = states.filter((s) => s === 'online' || s === 'degraded').length;
    const problems = states.filter((s) => s === 'offline' || s === 'degraded').length;
    const all = systems.flatMap((s) => health[s.id]?.history || []);
    const lat = avgLatency(all);
    const up = all.length ? (all.filter((h) => h.ok).length / all.length) * 100 : null;
    const checking = states.filter((s) => s === 'checking').length;
    return { online, problems, lat, up, checking, total: systems.length };
  }, [systems, health]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = systems.filter((s) => {
      if (category !== 'all' && (s.category || 'Без категории') !== category) return false;
      const st = healthState(health[s.id]);
      if (status === 'online' && st !== 'online') return false;
      if (status === 'problem' && st !== 'offline' && st !== 'degraded') return false;
      if (!q) return true;
      return [s.name, s.description, s.url, s.category, s.owner, ...(s.tags || [])].some((x) => (x || '').toLowerCase().includes(q));
    });
    const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
    if (sort === 'name') list = [...list].sort(byName);
    if (sort === 'pinned') list = [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || byName(a, b));
    if (sort === 'status')
      list = [...list].sort((a, b) => ORDER[healthState(health[a.id])] - ORDER[healthState(health[b.id])] || byName(a, b));
    if (sort === 'recent') list = [...list].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return list;
  }, [systems, health, query, category, status, sort]);

  const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const summary =
    stats.checking === stats.total && stats.total
      ? { tone: 'checking', text: 'Проверяем доступность систем…' }
      : stats.problems === 0
        ? { tone: 'ok', text: `Все ${stats.total} ${plural(stats.total, 'система работает', 'системы работают', 'систем работают')} штатно` }
        : {
            tone: 'warn',
            text: `${stats.problems} из ${stats.total} ${plural(stats.total, 'системы', 'систем', 'систем')} ${plural(stats.problems, 'требует', 'требуют', 'требуют')} внимания`,
          };
  const filtersActive = query || category !== 'all' || status !== 'all';

  return (
    <div className="page">
      <section className="hero">
        <div className="hero__glow" aria-hidden="true" />
        <div className="hero__text">
          <span className="eyebrow">{today}</span>
          <h2>{greeting()}!</h2>
          <p>
            Единая точка входа в корпоративные системы <span className="mono hero__domain">{config.domain}</span>
          </p>
          <span className={`hero__summary hero__summary--${summary.tone}`}>
            <span className="status__dot" />
            {summary.text}
          </span>
        </div>
        <dl className="kpis">
          <div className="kpi">
            <dt>Систем в каталоге</dt>
            <dd>{stats.total}</dd>
            <span className="kpi__sub">{categories.length} {plural(categories.length, 'категория', 'категории', 'категорий')}</span>
          </div>
          <div className="kpi">
            <dt>Доступны сейчас</dt>
            <dd>
              {stats.online}
              <small>/{stats.total}</small>
            </dd>
            <span className="kpi__meter">
              <span style={{ width: stats.total ? (stats.online / stats.total) * 100 + '%' : 0 }} />
            </span>
          </div>
          <div className="kpi">
            <dt>Средний отклик</dt>
            <dd>{formatMs(stats.lat)}</dd>
            <span className="kpi__sub">порог «медленно» — {formatMs(config.slowThresholdMs)}</span>
          </div>
          <div className="kpi">
            <dt>Доступность</dt>
            <dd>{stats.up == null ? '—' : stats.up.toFixed(stats.up === 100 ? 0 : 1) + '%'}</dd>
            <span className="kpi__sub">шлюз: {gateway.state === 'online' ? 'работает' : gateway.state === 'offline' ? 'недоступен' : 'проверка'}</span>
          </div>
        </dl>
      </section>

      <section className="toolbar" aria-label="Фильтры каталога">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            id="catalog-search"
            ref={searchRef}
            value={query}
            onChange={(e) => setPrefs({ query: e.target.value })}
            placeholder="Поиск по названию, тегу, адресу…"
            aria-label="Поиск систем"
          />
          {query ? (
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => setPrefs({ query: '' })} aria-label="Очистить поиск">
              <Icon name="x" size={14} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </label>
        <select id="status-filter" className="select" value={status} onChange={(e) => setPrefs({ status: e.target.value })} aria-label="Статус">
          {STATUS_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select id="sort-select" className="select" value={sort} onChange={(e) => setPrefs({ sort: e.target.value })} aria-label="Сортировка">
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Segmented
          label="Вид"
          value={view}
          onChange={(v) => setPrefs({ view: v })}
          options={[
            { value: 'grid', icon: 'grid', title: 'Плитка' },
            { value: 'list', icon: 'list', title: 'Таблица' },
          ]}
        />
      </section>

      <div className="chips" role="tablist" aria-label="Категории">
        <button type="button" role="tab" aria-selected={category === 'all'} className={`chip ${category === 'all' ? 'is-active' : ''}`} onClick={() => setPrefs({ category: 'all' })}>
          Все <span>{systems.length}</span>
        </button>
        {categories.map(([c, n]) => (
          <button key={c} type="button" role="tab" aria-selected={category === c} className={`chip ${category === c ? 'is-active' : ''}`} onClick={() => setPrefs({ category: c })}>
            {c} <span>{n}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card skeleton" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={filtersActive ? 'search' : 'layers'}
          title={filtersActive ? 'Ничего не найдено' : 'Каталог пуст'}
          text={filtersActive ? 'Измените запрос или сбросьте фильтры.' : 'Добавьте первую систему, чтобы она появилась на портале.'}
          action={
            filtersActive ? (
              <button type="button" className="btn btn--ghost" onClick={() => setPrefs({ query: '', category: 'all', status: 'all' })}>
                Сбросить фильтры
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={onAdd}>
                <Icon name="plus" size={16} /> Добавить систему
              </button>
            )
          }
        />
      ) : view === 'grid' ? (
        <div className="grid">
          {filtered.map((s, i) => (
            <SystemCard key={s.id} sys={s} health={health[s.id]} actions={actions} index={i} />
          ))}
          {!filtersActive && <AddCard onClick={onAdd} index={filtered.length} />}
        </div>
      ) : (
        <SystemTable systems={filtered} health={health} actions={actions} />
      )}
    </div>
  );
}
