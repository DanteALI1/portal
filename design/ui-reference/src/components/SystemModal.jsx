import { useEffect, useMemo, useState } from 'react';
import Icon, { SYSTEM_ICONS } from './Icon.jsx';
import { Modal, SystemGlyph } from './ui.jsx';
import { ACCENTS } from '../lib/defaults.js';
import { config } from '../lib/config.js';

const EMPTY = {
  name: '',
  url: '/',
  description: '',
  category: '',
  tags: [],
  owner: '',
  icon: 'server',
  accent: 'blue',
  healthUrl: '',
  newTab: false,
  pinned: false,
};

function validate(f, systems, editingId) {
  const e = {};
  if (!f.name.trim()) e.name = 'Укажите название системы';
  else if (f.name.trim().length > 60) e.name = 'Не длиннее 60 символов';
  else if (systems.some((s) => s.id !== editingId && s.name.trim().toLowerCase() === f.name.trim().toLowerCase()))
    e.name = 'Система с таким названием уже есть';

  const url = f.url.trim();
  if (!url || url === '/') e.url = 'Укажите маршрут, например /grafana/, или полный адрес';
  else if (!/^\/[^\s]*$/.test(url) && !/^https?:\/\/[^\s]+$/i.test(url))
    e.url = 'Маршрут начинается с «/», адрес — с http:// или https://';
  else if (systems.some((s) => s.id !== editingId && s.url === url)) e.url = 'Этот адрес уже используется другой системой';

  if (f.healthUrl && !/^\/[^\s]*$/.test(f.healthUrl) && !/^https?:\/\/[^\s]+$/i.test(f.healthUrl))
    e.healthUrl = 'Маршрут начинается с «/», адрес — с http:// или https://';
  if (f.description.length > 240) e.description = 'Не длиннее 240 символов';
  return e;
}

export default function SystemModal({ open, initial, systems, onClose, onSubmit }) {
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState(EMPTY);
  const [tagDraft, setTagDraft] = useState('');
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, ...(initial || {}), tags: [...(initial?.tags || [])] });
      setTagDraft('');
      setTouched({});
      setSubmitted(false);
    }
  }, [open, initial]);

  const errors = useMemo(() => validate(form, systems, initial?.id), [form, systems, initial]);
  const categories = useMemo(() => [...new Set(systems.map((s) => s.category).filter(Boolean))], [systems]);
  const show = (k) => (submitted || touched[k]) && errors[k];
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const blur = (k) => setTouched((t) => ({ ...t, [k]: true }));

  const addTag = (raw) => {
    const parts = raw.split(',').map((t) => t.trim()).filter(Boolean);
    if (!parts.length) return;
    setForm((f) => ({ ...f, tags: [...new Set([...f.tags, ...parts])].slice(0, 8) }));
    setTagDraft('');
  };

  const submit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (tagDraft.trim()) addTag(tagDraft);
    if (Object.keys(errors).length) return;
    const tags = tagDraft.trim() ? [...new Set([...form.tags, ...tagDraft.split(',').map((t) => t.trim()).filter(Boolean)])] : form.tags;
    onSubmit({
      ...form,
      name: form.name.trim(),
      url: form.url.trim(),
      description: form.description.trim(),
      category: form.category.trim(),
      owner: form.owner.trim(),
      healthUrl: form.healthUrl.trim(),
      tags,
    });
  };

  const isRoute = form.url.trim().startsWith('/');

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={680}
      icon={<SystemGlyph icon={form.icon} accent={form.accent} size={40} />}
      title={editing ? `Редактирование: ${initial.name}` : 'Новая система'}
      subtitle={editing ? 'Изменения сразу появятся в каталоге' : 'Система появится в каталоге и попадёт под мониторинг'}
      footer={
        <>
          <span className="muted small">
            <span className="req">*</span> обязательные поля
          </span>
          <div className="row gap-8">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" form="system-form" className="btn btn--primary">
              <Icon name="check" size={16} />
              {editing ? 'Сохранить' : 'Добавить систему'}
            </button>
          </div>
        </>
      }
    >
      <form id="system-form" className="form" onSubmit={submit} noValidate>
        <div className="form__grid">
          <label className={`field ${show('name') ? 'field--error' : ''}`}>
            <span className="field__label">
              Название <span className="req">*</span>
            </span>
            <input
              id="sys-name"
              data-autofocus
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              onBlur={() => blur('name')}
              placeholder="Например, Grafana"
              maxLength={80}
            />
            {show('name') && <span className="field__error">{errors.name}</span>}
          </label>

          <label className={`field ${show('url') ? 'field--error' : ''}`}>
            <span className="field__label">
              Адрес или маршрут <span className="req">*</span>
            </span>
            <input
              id="sys-url"
              className="mono"
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              onBlur={() => blur('url')}
              placeholder="/grafana/"
              spellCheck={false}
            />
            {show('url') ? (
              <span className="field__error">{errors.url}</span>
            ) : (
              <span className="field__hint">
                {isRoute ? (
                  <>
                    Откроется как <span className="mono">https://{config.domain}{form.url.trim() || '/'}</span>
                  </>
                ) : (
                  'Внешний адрес, мониторинг только «доступен / недоступен»'
                )}
              </span>
            )}
          </label>

          <label className={`field field--wide ${show('description') ? 'field--error' : ''}`}>
            <span className="field__label">
              Описание <span className="field__count">{form.description.length}/240</span>
            </span>
            <textarea
              id="sys-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              onBlur={() => blur('description')}
              placeholder="Для чего нужна система и кому она полезна"
            />
            {show('description') && <span className="field__error">{errors.description}</span>}
          </label>

          <label className="field">
            <span className="field__label">Категория</span>
            <input
              id="sys-category"
              list="category-options"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="Инфраструктура"
            />
            <datalist id="category-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <label className="field">
            <span className="field__label">Ответственный</span>
            <input
              id="sys-owner"
              value={form.owner}
              onChange={(e) => set('owner', e.target.value)}
              placeholder="Подразделение или сотрудник"
            />
          </label>

          <div className="field field--wide">
            <span className="field__label">Теги</span>
            <div className="tag-input" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
              {form.tags.map((t) => (
                <span key={t} className="tag tag--removable">
                  {t}
                  <button
                    type="button"
                    aria-label={`Удалить тег ${t}`}
                    onClick={() => set('tags', form.tags.filter((x) => x !== t))}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
              <input
                id="sys-tags"
                value={tagDraft}
                onChange={(e) => (e.target.value.endsWith(',') ? addTag(e.target.value) : setTagDraft(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag(tagDraft);
                  } else if (e.key === 'Backspace' && !tagDraft && form.tags.length) {
                    set('tags', form.tags.slice(0, -1));
                  }
                }}
                placeholder={form.tags.length ? '' : 'Enter или запятая — добавить тег'}
              />
            </div>
          </div>

          <div className="field field--wide">
            <span className="field__label">Иконка</span>
            <div className="icon-picker" role="radiogroup" aria-label="Иконка">
              {SYSTEM_ICONS.map(([k, label]) => (
                <button
                  type="button"
                  key={k}
                  role="radio"
                  aria-checked={form.icon === k}
                  className={form.icon === k ? 'is-active' : ''}
                  onClick={() => set('icon', k)}
                  title={label}
                >
                  <Icon name={k} size={18} />
                </button>
              ))}
            </div>
          </div>

          <div className="field field--wide">
            <span className="field__label">Цвет</span>
            <div className="swatches" role="radiogroup" aria-label="Цвет">
              {Object.entries(ACCENTS).map(([k, c]) => (
                <button
                  type="button"
                  key={k}
                  role="radio"
                  aria-checked={form.accent === k}
                  aria-label={c.label}
                  title={c.label}
                  className={form.accent === k ? 'is-active' : ''}
                  style={{ '--ga': c.a, '--gb': c.b }}
                  onClick={() => set('accent', k)}
                />
              ))}
            </div>
          </div>

          <details className="field field--wide advanced">
            <summary>
              <Icon name="chevronRight" size={14} /> Дополнительно
            </summary>
            <div className="form__grid">
              <label className={`field field--wide ${show('healthUrl') ? 'field--error' : ''}`}>
                <span className="field__label">Адрес проверки доступности</span>
                <input
                  id="sys-health"
                  className="mono"
                  value={form.healthUrl}
                  onChange={(e) => set('healthUrl', e.target.value)}
                  onBlur={() => blur('healthUrl')}
                  placeholder={`По умолчанию — ${form.url || '/'}`}
                  spellCheck={false}
                />
                {show('healthUrl') ? (
                  <span className="field__error">{errors.healthUrl}</span>
                ) : (
                  <span className="field__hint">Например, /grafana/api/health. Код 5xx считается недоступностью.</span>
                )}
              </label>
              <label className="check">
                <input id="sys-newtab" type="checkbox" checked={form.newTab} onChange={(e) => set('newTab', e.target.checked)} />
                <span>Открывать в новой вкладке</span>
              </label>
              <label className="check">
                <input id="sys-pinned" type="checkbox" checked={form.pinned} onChange={(e) => set('pinned', e.target.checked)} />
                <span>Показывать в избранном</span>
              </label>
            </div>
          </details>
        </div>
      </form>
    </Modal>
  );
}
