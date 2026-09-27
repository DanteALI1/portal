import { Menu, StatusBadge, SystemGlyph, Sparkline } from './ui.jsx';
import { healthState, systemActions } from './SystemCard.jsx';
import { avgLatency, uptime } from '../lib/health.js';
import { formatMs, timeAgo } from '../lib/format.js';
import Icon from './Icon.jsx';

export default function SystemTable({ systems, health, actions, variant = 'catalog', now }) {
  const monitoring = variant === 'monitoring';
  return (
    <div className="table-wrap card">
      <table className="table">
        <thead>
          <tr>
            <th>Система</th>
            <th>Статус</th>
            {!monitoring && <th className="hide-md">Категория</th>}
            {!monitoring && <th className="hide-lg">Ответственный</th>}
            <th className="num">Отклик</th>
            {monitoring && <th className="num hide-md">Средний</th>}
            <th className="num hide-sm">Доступность</th>
            {monitoring && <th className="hide-lg">Динамика</th>}
            {monitoring && <th className="hide-md">Проверено</th>}
            <th aria-label="Действия" />
          </tr>
        </thead>
        <tbody>
          {systems.map((s) => {
            const h = health[s.id];
            const st = healthState(h);
            const up = uptime(h?.history);
            return (
              <tr key={s.id}>
                <td>
                  <a className="row-sys" href={s.url} target={s.newTab ? '_blank' : undefined} rel="noopener">
                    <SystemGlyph icon={s.icon} accent={s.accent} size={32} />
                    <span>
                      <strong>
                        {s.name}
                        {s.pinned && <Icon name="star" size={12} className="pin-mark" />}
                      </strong>
                      <span className="mono muted">{s.url}</span>
                    </span>
                  </a>
                </td>
                <td>
                  <StatusBadge state={st} />
                </td>
                {!monitoring && <td className="hide-md">{s.category || '—'}</td>}
                {!monitoring && <td className="hide-lg muted">{s.owner || '—'}</td>}
                <td className="num mono">{formatMs(h?.last?.latency)}</td>
                {monitoring && <td className="num mono hide-md">{formatMs(avgLatency(h?.history))}</td>}
                <td className="num mono hide-sm">{up == null ? '—' : up.toFixed(1) + '%'}</td>
                {monitoring && (
                  <td className="hide-lg">
                    <Sparkline values={(h?.history || []).map((x) => (x.ok ? x.latency : null))} width={140} height={28} />
                  </td>
                )}
                {monitoring && (
                  <td className="hide-md muted">
                    {h?.checking ? 'проверяется…' : timeAgo(h?.last?.ts, now)}
                    {h?.last?.code ? <span className="mono code-pill">HTTP {h.last.code}</span> : null}
                  </td>
                )}
                <td className="cell-actions">
                  <Menu items={systemActions(s, actions)} label={`Действия: ${s.name}`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
