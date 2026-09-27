import Icon from './Icon.jsx';
import { HealthBars, Menu, StatusBadge, SystemGlyph } from './ui.jsx';
import { stateOf, uptime } from '../lib/health.js';
import { formatMs } from '../lib/format.js';

export function systemActions(sys, { onEdit, onDelete, onTogglePin, onCopy, onCheck }) {
  return [
    { icon: 'external', label: 'Открыть в новой вкладке', onClick: () => window.open(sys.url, '_blank', 'noopener') },
    { icon: 'copy', label: 'Копировать ссылку', onClick: () => onCopy(sys) },
    { icon: 'refresh', label: 'Проверить доступность', onClick: () => onCheck(sys) },
    { icon: 'star', label: sys.pinned ? 'Убрать из избранного' : 'В избранное', onClick: () => onTogglePin(sys) },
    '-',
    { icon: 'edit', label: 'Редактировать', onClick: () => onEdit(sys) },
    { icon: 'trash', label: 'Удалить', danger: true, onClick: () => onDelete(sys) },
  ];
}

export function healthState(h) {
  if (!h) return 'checking';
  if (h.checking && !h.last) return 'checking';
  return stateOf(h.last);
}

export default function SystemCard({ sys, health, actions, index = 0 }) {
  const state = healthState(health);
  const up = uptime(health?.history);
  const path = sys.url.replace(/^https?:\/\//, '');
  return (
    <article className={`card sys-card sys-card--${state}`} style={{ '--i': index }}>
      <a
        className="sys-card__link"
        href={sys.url}
        target={sys.newTab ? '_blank' : undefined}
        rel={sys.newTab ? 'noopener' : undefined}
        aria-label={`Открыть ${sys.name}`}
      />
      <div className="sys-card__head">
        <SystemGlyph icon={sys.icon} accent={sys.accent} />
        <div className="sys-card__title">
          <h3>
            {sys.name}
            {sys.pinned && <Icon name="star" size={13} className="pin-mark" />}
          </h3>
          <span className="muted">{sys.category || 'Без категории'}</span>
        </div>
        <div className="sys-card__menu">
          <Menu items={systemActions(sys, actions)} label={`Действия: ${sys.name}`} />
        </div>
      </div>

      <p className="sys-card__desc">{sys.description || 'Описание не указано.'}</p>

      {sys.tags?.length > 0 && (
        <ul className="tags">
          {sys.tags.map((t) => (
            <li key={t} className="tag">
              {t}
            </li>
          ))}
        </ul>
      )}

      <div className="sys-card__health">
        <HealthBars history={health?.history} slots={30} height={22} />
      </div>

      <footer className="sys-card__foot">
        <StatusBadge state={state} />
        <span className="sys-card__metrics mono">
          <span title="Время ответа">{formatMs(health?.last?.latency)}</span>
          <span className="dot-sep" />
          <span title="Доступность за период наблюдения">{up == null ? '—' : up.toFixed(up === 100 ? 0 : 1) + '%'}</span>
        </span>
        <span className="sys-card__path mono" title={sys.url}>
          {path}
          <Icon name={sys.newTab ? 'external' : 'arrowRight'} size={14} />
        </span>
      </footer>
    </article>
  );
}

export function AddCard({ onClick, index }) {
  return (
    <button type="button" className="card add-card" onClick={onClick} style={{ '--i': index }}>
      <span className="add-card__icon">
        <Icon name="plus" size={22} />
      </span>
      <strong>Добавить систему</strong>
      <span className="muted">Название, адрес и иконка — остальное можно заполнить позже</span>
    </button>
  );
}
