import Icon from '../components/Icon.jsx';
import SystemTable from '../components/SystemTable.jsx';
import { healthState } from '../components/SystemCard.jsx';
import { HealthBars, StatusBadge, EmptyState } from '../components/ui.jsx';
import { STATE_LABEL, uptime } from '../lib/health.js';
import { formatMs, timeAgo } from '../lib/format.js';
import { config } from '../lib/config.js';

export default function Monitoring({ systems, health, gateway, components = [], lastRun, running, onCheckAll, interval, actions, now }) {
  const states = systems.map((s) => healthState(health[s.id]));
  const offline = states.filter((s) => s === 'offline').length;
  const degraded = states.filter((s) => s === 'degraded').length;
  const brokenInfra = components.filter((c) => c.state === 'offline');
  const tone = gateway.state === 'offline' || offline || brokenInfra.length ? 'bad' : degraded ? 'warn' : 'ok';
  const headline =
    gateway.state === 'offline'
      ? 'Шлюз Nginx не отвечает'
      : brokenInfra.length
        ? `Не отвечает: ${brokenInfra.map((c) => c.name).join(', ')}`
        : offline
        ? `Недоступно систем: ${offline}`
        : degraded
          ? `Медленный ответ: ${degraded}`
          : 'Все системы доступны';
  const gwUp = uptime(gateway.history);
  const routes = [{ path: '/', target: 'Портал', port: 3000 }, ...systems.filter((s) => s.url.startsWith('/')).map((s) => ({ path: s.url, target: s.name }))];

  return (
    <div className="page">
      <section className={`banner banner--${tone}`}>
        <span className="banner__icon">
          <Icon name={tone === 'ok' ? 'shieldCheck' : 'alert'} size={22} />
        </span>
        <div className="banner__text">
          <strong>{headline}</strong>
          <span>
            Последняя проверка: {lastRun ? timeAgo(lastRun, now) : '—'} ·{' '}
            {interval ? `обновление каждые ${interval >= 60 ? interval / 60 + ' мин' : interval + ' с'}` : 'автообновление выключено'} ·
            сервер проверяет системы сам
          </span>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onCheckAll} disabled={running}>
          <Icon name="refresh" size={16} className={running ? 'spin' : ''} />
          {running ? 'Проверяем…' : 'Проверить сейчас'}
        </button>
      </section>

      <div className="mon-grid">
        <section className="card panel">
          <header className="panel__head">
            <h3>
              <Icon name="shieldCheck" size={16} /> Инфраструктура
            </h3>
            <span className="muted small">шлюз {gwUp == null ? '—' : gwUp.toFixed(1) + '%'}</span>
          </header>
          <ul className="routes">
            {components.map((c) => (
              <li key={c.id} title={c.last?.detail || ''}>
                <span className="routes__target">{c.name}</span>
                <span className="routes__line" aria-hidden="true" />
                <span className="mono muted small">{formatMs(c.last?.latency)}</span>
                <StatusBadge state={c.state || 'unknown'} compact />
              </li>
            ))}
          </ul>
          <HealthBars history={gateway.history} slots={40} height={32} />
        </section>

        <section className="card panel">
          <header className="panel__head">
            <h3>
              <Icon name="route" size={16} /> Маршруты {config.domain}
            </h3>
            <span className="muted small">{routes.length} маршрутов</span>
          </header>
          <ul className="routes">
            {routes.map((r) => {
              const sys = systems.find((s) => s.url === r.path);
              const st = sys ? healthState(health[sys.id]) : 'online';
              return (
                <li key={r.path}>
                  <span className="mono routes__path">{r.path}</span>
                  <span className="routes__line" aria-hidden="true" />
                  <span className="routes__target">{r.target}</span>
                  <StatusBadge state={st} compact />
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="section-head">
        <h3>Системы</h3>
        <span className="legend">
          {['online', 'degraded', 'offline'].map((s) => (
            <span key={s}>
              <StatusBadge state={s} compact /> {STATE_LABEL[s]}
            </span>
          ))}
        </span>
      </div>
      {systems.length ? (
        <SystemTable systems={systems} health={health} actions={actions} variant="monitoring" now={now} />
      ) : (
        <EmptyState icon="activity" title="Нет систем для мониторинга" text="Добавьте систему в каталог — проверка начнётся автоматически." />
      )}
      <p className="footnote">
        <Icon name="info" size={14} />
        Системы проверяет сервер портала напрямую по внутренним адресам, в обход единого входа: через шлюз любая
        страница отвечает переадресацией на вход и выключенный сервис выглядел бы рабочим. Ответ 5xx или отсутствие
        соединения — «Недоступна», переадресация на страницу входа — «Нет данных» (укажите внутренний адрес проверки).
        Время ответа выше {formatMs(config.slowThresholdMs)} — «Медленно».
      </p>
    </div>
  );
}
