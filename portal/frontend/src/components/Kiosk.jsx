import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { HealthBars, SystemGlyph } from './ui.jsx';
import { healthState } from './SystemCard.jsx';
import { uptime, STATE_LABEL } from '../lib/health.js';
import { formatMs, plural } from '../lib/format.js';
import { config } from '../lib/config.js';

const TILES_PER_PAGE = 8;
const ROTATE_MS = 12000;
const REFRESH_MS = 30000;

/**
 * Режим витрины: полноэкранный статус-борд для настенного монитора (NOC).
 * Крупные плитки, авторотация страниц и авто-обновление статусов.
 * Данные берутся из уже работающего мониторинга; выход — Esc.
 */
export default function Kiosk({ open, systems, health, gateway, onExit, onRefresh }) {
  const [clock, setClock] = useState(() => new Date());
  const [page, setPage] = useState(0);

  // Часы
  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, [open]);

  // Живое обновление статусов даже при выключенном автообновлении в настройках
  useEffect(() => {
    if (!open || !onRefresh) return undefined;
    const id = setInterval(() => onRefresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [open, onRefresh]);

  // Выход по Esc
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onExit();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onExit]);

  const tiles = useMemo(
    () =>
      systems.map((s) => {
        const h = health[s.id];
        return { sys: s, state: healthState(h), up: uptime(h?.history), latency: h?.last?.latency, history: h?.history || [] };
      }),
    [systems, health],
  );

  const stats = useMemo(() => {
    const online = tiles.filter((t) => t.state === 'online').length;
    const problems = tiles.filter((t) => t.state === 'offline' || t.state === 'degraded').length;
    return { online, problems, total: tiles.length };
  }, [tiles]);

  const pageCount = Math.max(1, Math.ceil(tiles.length / TILES_PER_PAGE));

  // Авторотация страниц, если систем много
  useEffect(() => {
    if (!open || pageCount < 2) return undefined;
    const id = setInterval(() => setPage((p) => (p + 1) % pageCount), ROTATE_MS);
    return () => clearInterval(id);
  }, [open, pageCount]);
  useEffect(() => {
    if (page >= pageCount) setPage(0);
  }, [pageCount, page]);

  if (!open) return null;

  const shown = tiles.slice(page * TILES_PER_PAGE, page * TILES_PER_PAGE + TILES_PER_PAGE);
  const tone = gateway.state === 'offline' || stats.problems ? 'bad' : stats.online < stats.total ? 'warn' : 'ok';
  const headline =
    gateway.state === 'offline'
      ? 'Шлюз Nginx не отвечает'
      : stats.problems
        ? `${stats.problems} ${plural(stats.problems, 'система требует', 'системы требуют', 'систем требуют')} внимания`
        : `Все ${stats.total} ${plural(stats.total, 'система работает', 'системы работают', 'систем работают')} штатно`;

  return (
    <div className={`kiosk kiosk--${tone}`}>
      <header className="kiosk__top">
        <div className="kiosk__brand">
          <span className={`kiosk__pulse kiosk__pulse--${tone}`} />
          <div>
            <strong>{config.organization}</strong>
            <span className="mono">{config.domain}</span>
          </div>
        </div>
        <div className="kiosk__headline">
          <span className={`kiosk__chip kiosk__chip--${tone}`}>{headline}</span>
          <span className="kiosk__counts mono">
            {stats.online}/{stats.total} онлайн · шлюз {STATE_LABEL[gateway.state] || '—'}
          </span>
        </div>
        <div className="kiosk__clock">
          <strong className="mono">{clock.toLocaleTimeString('ru-RU')}</strong>
          <span>{clock.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
        <button type="button" className="kiosk__exit" onClick={onExit} aria-label="Выйти из витрины (Esc)">
          <Icon name="x" size={22} />
        </button>
      </header>

      {tiles.length === 0 ? (
        <div className="kiosk__empty">Нет систем в каталоге</div>
      ) : (
        <div className="kiosk__grid" data-count={shown.length}>
          {shown.map(({ sys, state, up, latency, history }) => (
            <article key={sys.id} className={`kiosk-tile kiosk-tile--${state}`}>
              <div className="kiosk-tile__head">
                <SystemGlyph icon={sys.icon} accent={sys.accent} size={46} />
                <div className="kiosk-tile__name">
                  <strong>{sys.name}</strong>
                  <span>{sys.category || 'Без категории'}</span>
                </div>
                <span className="kiosk-tile__dot" />
              </div>
              <div className="kiosk-tile__state">{STATE_LABEL[state]}</div>
              <div className="kiosk-tile__bars">
                <HealthBars history={history} slots={36} height={40} />
              </div>
              <div className="kiosk-tile__foot mono">
                <span>{formatMs(latency)}</span>
                <span>{up == null ? '—' : up.toFixed(up === 100 ? 0 : 1) + '%'}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <footer className="kiosk__foot">
        {pageCount > 1 && (
          <span className="kiosk__pager">
            {Array.from({ length: pageCount }).map((_, i) => (
              <span key={i} className={i === page ? 'is-active' : ''} />
            ))}
          </span>
        )}
        <span className="mono">Обновление каждые 30 с · выход — Esc</span>
      </footer>
    </div>
  );
}
