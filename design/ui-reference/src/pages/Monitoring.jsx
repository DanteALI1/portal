import Icon from '../components/Icon.jsx';
import SystemTable from '../components/SystemTable.jsx';
import { healthState } from '../components/SystemCard.jsx';
import { HealthBars, StatusBadge, EmptyState } from '../components/ui.jsx';
import { STATE_LABEL, uptime } from '../lib/health.js';
import { formatMs, timeAgo } from '../lib/format.js';
import { config } from '../lib/config.js';

export default function Monitoring({ systems, health, gateway, lastRun, running, onCheckAll, interval, actions, now }) {
  const states = systems.map((s) => healthState(health[s.id]));
  const offline = states.filter((s) => s === 'offline').length;
  const degraded = states.filter((s) => s === 'degraded').length;
  const tone = gateway.state === 'offline' || offline ? 'bad' : degraded ? 'warn' : 'ok';
  const headline =
    gateway.state === 'offline'
      ? 'Шлюз Nginx не отвечает'
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
            {interval ? `автоматически каждые ${interval >= 60 ? interval / 60 + ' мин' : interval + ' с'}` : 'автопроверка выключена'}
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
              <Icon name="shieldCheck" size={16} /> Шлюз Nginx
            </h3>
            <StatusBadge state={gateway.state} />
          </header>
          <dl className="facts">
            <div>
              <dt>Точка проверки</dt>
              <dd className="mono">{config.gatewayHealthUrl}</dd>
            </div>
            <div>
              <dt>Отклик</dt>
              <dd className="mono">{formatMs(gateway.last?.latency)}</dd>
            </div>
            <div>
              <dt>Доступность</dt>
              <dd className="mono">{gwUp == null ? '—' : gwUp.toFixed(1) + '%'}</dd>
            </div>
            <div>
              <dt>Протокол</dt>
              <dd className="mono">HTTPS · TLS 1.2/1.3</dd>
            </div>
          </dl>
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
        Проверка выполняется из браузера. Для маршрутов на {config.domain} ответ 5xx или отсутствие соединения считается
        недоступностью; для внешних адресов определяется только факт ответа. Время ответа выше {formatMs(config.slowThresholdMs)} —
        статус «Медленно».
      </p>
    </div>
  );
}
