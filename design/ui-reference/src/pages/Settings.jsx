import { useRef } from 'react';
import Icon from '../components/Icon.jsx';
import { Segmented } from '../components/ui.jsx';
import { config } from '../lib/config.js';

export default function Settings({ prefs, setPrefs, storageMode, systemsCount, onExport, onImport, onReset }) {
  const fileRef = useRef(null);
  return (
    <div className="page settings">
      <section className="card panel">
        <header className="panel__head">
          <h3>Внешний вид</h3>
        </header>
        <div className="setting">
          <div>
            <strong>Тема оформления</strong>
            <span className="muted">«Как в системе» следует настройке операционной системы</span>
          </div>
          <Segmented
            label="Тема"
            value={prefs.theme}
            onChange={(v) => setPrefs({ theme: v })}
            options={[
              { value: 'dark', icon: 'moon', label: 'Тёмная' },
              { value: 'light', icon: 'sun', label: 'Светлая' },
              { value: 'system', icon: 'monitorCog', label: 'Системная' },
            ]}
          />
        </div>
        <div className="setting">
          <div>
            <strong>Анимации интерфейса</strong>
            <span className="muted">Плавное появление карточек и фоновые градиенты</span>
          </div>
          <label className="switch">
            <input id="pref-motion" type="checkbox" checked={prefs.motion} onChange={(e) => setPrefs({ motion: e.target.checked })} />
            <span />
          </label>
        </div>
      </section>

      <section className="card panel">
        <header className="panel__head">
          <h3>Мониторинг</h3>
        </header>
        <div className="setting">
          <div>
            <strong>Автоматическая проверка</strong>
            <span className="muted">Проверка идёт только пока вкладка портала открыта</span>
          </div>
          <Segmented
            label="Интервал"
            value={prefs.interval}
            onChange={(v) => setPrefs({ interval: v })}
            options={[
              { value: 30, label: '30 с' },
              { value: 60, label: '1 мин' },
              { value: 300, label: '5 мин' },
              { value: 0, label: 'Выкл' },
            ]}
          />
        </div>
      </section>

      <section className="card panel">
        <header className="panel__head">
          <h3>Данные каталога</h3>
          <span className="muted small">
            {systemsCount} в каталоге · {storageMode === 'api' ? 'общий каталог на сервере' : 'хранится в этом браузере'}
          </span>
        </header>
        {storageMode !== 'api' && (
          <div className="callout">
            <Icon name="info" size={16} />
            <span>
              Сейчас список систем хранится в браузере, поэтому изменения видите только вы. Чтобы каталог был общим для всех
              сотрудников, подключите REST API: в файле <span className="mono">config.js</span> укажите{' '}
              <span className="mono">apiBase: '/api'</span>. Экспорт ниже поможет перенести текущий список.
            </span>
          </div>
        )}
        <div className="setting">
          <div>
            <strong>Экспорт</strong>
            <span className="muted">Файл JSON со всеми системами — для резервной копии или переноса</span>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onExport}>
            <Icon name="download" size={16} /> Скачать JSON
          </button>
        </div>
        <div className="setting">
          <div>
            <strong>Импорт</strong>
            <span className="muted">Заменит текущий список системами из файла</span>
          </div>
          <input
            id="import-file"
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} /> Загрузить JSON
          </button>
        </div>
        <div className="setting">
          <div>
            <strong>Сброс</strong>
            <span className="muted">Вернуть исходный каталог: NetBox и Корпоративная Вики</span>
          </div>
          <button type="button" className="btn btn--ghost btn--danger-text" onClick={onReset}>
            <Icon name="refresh" size={16} /> Сбросить
          </button>
        </div>
      </section>

      <section className="card panel">
        <header className="panel__head">
          <h3>О портале</h3>
        </header>
        <dl className="facts facts--cols">
          <div>
            <dt>Версия</dt>
            <dd className="mono">{config.version}</dd>
          </div>
          <div>
            <dt>Домен</dt>
            <dd className="mono">{config.domain}</dd>
          </div>
          <div>
            <dt>Хранилище</dt>
            <dd>{storageMode === 'api' ? `REST API (${config.apiBase})` : 'localStorage браузера'}</dd>
          </div>
          <div>
            <dt>Поддержка</dt>
            <dd className="mono">{config.supportContact}</dd>
          </div>
          {config.demo && (
            <div>
              <dt>Режим</dt>
              <dd>Демонстрация: статусы систем имитируются</dd>
            </div>
          )}
        </dl>
        <div className="shortcuts">
          <strong>Горячие клавиши</strong>
          <ul>
            <li>
              <kbd>Ctrl</kbd>
              <kbd>K</kbd> быстрый поиск и команды
            </li>
            <li>
              <kbd>/</kbd> поиск по каталогу
            </li>
            <li>
              <kbd>N</kbd> добавить систему
            </li>
            <li>
              <kbd>Esc</kbd> закрыть окно
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
