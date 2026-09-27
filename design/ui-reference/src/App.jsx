import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar, Topbar, NAV } from './components/Shell.jsx';
import SystemModal from './components/SystemModal.jsx';
import { CommandPalette, ConfirmDialog, Toasts } from './components/Overlays.jsx';
import { healthState } from './components/SystemCard.jsx';
import Overview from './pages/Overview.jsx';
import Monitoring from './pages/Monitoring.jsx';
import Audit from './pages/Audit.jsx';
import Settings from './pages/Settings.jsx';
import { config } from './lib/config.js';
import { DEFAULT_SYSTEMS } from './lib/defaults.js';
import { createApiRepo, createLocalRepo, slugify, store } from './lib/storage.js';
import { useHealth, STATE_LABEL } from './lib/health.js';
import { copyText, downloadFile, formatMs, fullUrl } from './lib/format.js';

const PREFS_KEY = 'portal.prefs.v1';
const AUDIT_KEY = 'portal.audit.v1';
const PAGES = NAV.map((n) => n.id);

const DEFAULT_PREFS = {
  theme: 'dark',
  view: 'grid',
  sort: 'pinned',
  category: 'all',
  status: 'all',
  query: '',
  interval: config.healthInterval,
  motion: true,
  collapsed: false,
};

const FIELD_LABELS = {
  name: 'название', url: 'адрес', description: 'описание', category: 'категория', owner: 'ответственный',
  icon: 'иконка', accent: 'цвет', tags: 'теги', healthUrl: 'адрес проверки', newTab: 'новая вкладка', pinned: 'избранное',
};

function pageFromHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  return PAGES.includes(h) ? h : 'overview';
}

export default function App() {
  const repo = useMemo(() => (config.apiBase ? createApiRepo(config.apiBase) : createLocalRepo()), []);
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [prefs, setPrefsState] = useState(() => ({ ...DEFAULT_PREFS, ...store.get(PREFS_KEY, {}), query: '' }));
  const [page, setPage] = useState(pageFromHash);
  const [audit, setAudit] = useState(() => store.get(AUDIT_KEY, []));
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState({ open: false, initial: null });
  const [confirm, setConfirm] = useState(null);
  const [palette, setPalette] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [now, setNow] = useState(Date.now());

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      const { query, ...persist } = next;
      store.set(PREFS_KEY, persist);
      return next;
    });
  }, []);

  // ——— уведомления ———
  const toastId = useRef(0);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t) => {
      const id = ++toastId.current;
      setToasts((list) => [...list.slice(-3), { id, type: 'success', ...t }]);
      setTimeout(() => dismiss(id), t.action ? 8000 : 4500);
    },
    [dismiss],
  );

  // ——— журнал ———
  const log = useCallback((action, target, details) => {
    setAudit((a) => {
      const next = [{ id: Date.now() + Math.random().toString(36).slice(2, 6), ts: Date.now(), action, target, details }, ...a].slice(0, 300);
      store.set(AUDIT_KEY, next);
      return next;
    });
  }, []);

  // ——— загрузка каталога ———
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSystems(await repo.list());
    } catch (e) {
      setLoadError(e.message || 'Не удалось загрузить каталог');
    } finally {
      setLoading(false);
    }
  }, [repo]);
  useEffect(() => {
    load();
  }, [load]);

  // ——— мониторинг ———
  const onTransition = useCallback(
    (sys, from, to) => {
      if (from === 'checking' || from === 'unknown') return;
      log('status', sys.name, `${STATE_LABEL[from]} → ${STATE_LABEL[to]}`);
      if (to === 'offline') toast({ type: 'error', title: `${sys.name} недоступна`, text: 'Система перестала отвечать на проверку' });
      if (from === 'offline' && to === 'online') toast({ type: 'success', title: `${sys.name} снова работает` });
    },
    [log, toast],
  );
  const { health, gateway, lastRun, running, checkAll, checkOne } = useHealth(systems, prefs.interval, onTransition);

  const alerts = useMemo(
    () =>
      systems
        .map((sys) => {
          const h = health[sys.id];
          const state = healthState(h);
          if (state === 'offline') return { sys, state, message: h?.last?.code ? `HTTP ${h.last.code}` : h?.last?.error || 'Нет ответа' };
          if (state === 'degraded') return { sys, state, message: `Ответ ${formatMs(h?.last?.latency)}` };
          return null;
        })
        .filter(Boolean),
    [systems, health],
  );

  // ——— тема, анимации, часы ———
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prefs.theme);
    root.setAttribute('data-motion', prefs.motion ? 'on' : 'off');
  }, [prefs.theme, prefs.motion]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // ——— навигация ———
  const navigate = useCallback((p) => {
    setPage(p);
    setMobileNav(false);
    try {
      if (window.location.hash !== '#' + p) window.history.replaceState(null, '', '#' + p);
    } catch {
      /* песочница может запрещать изменение адреса */
    }
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const title = NAV.find((n) => n.id === page)?.label;
    document.title = `${title} · ${config.title}`;
  }, [page]);

  const openAdd = useCallback(() => setModal({ open: true, initial: null }), []);

  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === 'т') && !modal.open && !palette) {
        e.preventDefault();
        openAdd();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal.open, palette, openAdd]);

  // ——— операции с каталогом ———
  const fail = (e, title) => toast({ type: 'error', title, text: e.message || 'Попробуйте ещё раз' });

  const saveSystem = async (form) => {
    const stamp = new Date().toISOString();
    try {
      if (modal.initial?.id) {
        const prev = modal.initial;
        const item = { ...prev, ...form, updatedAt: stamp };
        const saved = await repo.update(item, systems);
        setSystems((list) => list.map((s) => (s.id === item.id ? saved || item : s)));
        const changed = Object.keys(FIELD_LABELS).filter((k) => JSON.stringify(prev[k] ?? '') !== JSON.stringify(item[k] ?? ''));
        log('update', item.name, changed.length ? 'Изменено: ' + changed.map((k) => FIELD_LABELS[k]).join(', ') : 'Без изменений');
        toast({ title: 'Изменения сохранены', text: item.name });
      } else {
        const item = { ...form, id: slugify(form.name), createdAt: stamp, updatedAt: stamp };
        const saved = await repo.create(item, systems);
        setSystems((list) => [...list, saved || item]);
        log('create', item.name, `Адрес ${item.url}${item.category ? ', категория «' + item.category + '»' : ''}`);
        toast({
          title: 'Система добавлена',
          text: item.url.startsWith('/') ? `Проверьте, что в Nginx настроен маршрут ${item.url}` : item.name,
        });
      }
      setModal({ open: false, initial: null });
    } catch (e) {
      fail(e, 'Не удалось сохранить систему');
    }
  };

  const restore = async (sys, index) => {
    try {
      await repo.create(sys, systems.filter((s) => s.id !== sys.id));
      setSystems((list) => {
        const next = list.filter((s) => s.id !== sys.id);
        next.splice(Math.min(index, next.length), 0, sys);
        if (repo.mode === 'local') repo.save(next);
        return next;
      });
      log('restore', sys.name, 'Удаление отменено');
      toast({ title: 'Система восстановлена', text: sys.name });
    } catch (e) {
      fail(e, 'Не удалось восстановить систему');
    }
  };

  const deleteSystem = async (sys) => {
    const index = systems.findIndex((s) => s.id === sys.id);
    try {
      await repo.remove(sys.id, systems);
      setSystems((list) => list.filter((s) => s.id !== sys.id));
      log('delete', sys.name, `Адрес ${sys.url}`);
      toast({ title: 'Система удалена', text: sys.name, action: { label: 'Отменить', icon: 'undo', onClick: () => restore(sys, index) } });
    } catch (e) {
      fail(e, 'Не удалось удалить систему');
    }
  };

  const togglePin = async (sys) => {
    const item = { ...sys, pinned: !sys.pinned, updatedAt: new Date().toISOString() };
    try {
      await repo.update(item, systems);
      setSystems((list) => list.map((s) => (s.id === item.id ? item : s)));
      toast({ title: item.pinned ? 'Добавлено в избранное' : 'Убрано из избранного', text: sys.name });
    } catch (e) {
      fail(e, 'Не удалось обновить систему');
    }
  };

  const actions = {
    onEdit: (sys) => setModal({ open: true, initial: sys }),
    onDelete: (sys) =>
      setConfirm({
        title: `Удалить «${sys.name}»?`,
        text: `Система исчезнет из каталога портала. Сам сервис по адресу ${sys.url} продолжит работать, маршрут в Nginx не изменится.`,
        confirmLabel: 'Удалить',
        onConfirm: () => deleteSystem(sys),
      }),
    onTogglePin: togglePin,
    onCopy: async (sys) => {
      const ok = await copyText(fullUrl(sys.url, config.domain));
      toast(ok ? { title: 'Ссылка скопирована', text: fullUrl(sys.url, config.domain) } : { type: 'error', title: 'Не удалось скопировать ссылку' });
    },
    onCheck: (sys) => {
      checkOne(sys);
      toast({ type: 'info', title: `Проверяем ${sys.name}…` });
    },
  };

  const exportJson = () => {
    const payload = { format: 'rep-portal/systems', version: 1, exportedAt: new Date().toISOString(), domain: config.domain, systems };
    downloadFile(`portal-systems-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
    log('export', 'Каталог', `Выгружено систем: ${systems.length}`);
  };

  const importJson = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      const raw = Array.isArray(data) ? data : data.systems;
      if (!Array.isArray(raw)) throw new Error('В файле нет списка систем');
      const stamp = new Date().toISOString();
      const list = raw
        .filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string')
        .map((s) => ({
          icon: 'server', accent: 'blue', tags: [], description: '', category: '', owner: '', newTab: false, pinned: false,
          ...s,
          id: s.id || slugify(s.name),
          createdAt: s.createdAt || stamp,
          updatedAt: stamp,
        }));
      if (!list.length) throw new Error('Не найдено ни одной системы с полями name и url');
      setConfirm({
        title: `Заменить каталог (${list.length})?`,
        text: `Текущие ${systems.length} систем будут заменены содержимым файла «${file.name}». Перед импортом рекомендуем сделать экспорт.`,
        confirmLabel: 'Импортировать',
        onConfirm: async () => {
          try {
            await repo.replaceAll(list);
            setSystems(list);
            log('import', file.name, `Загружено систем: ${list.length}`);
            toast({ title: 'Каталог импортирован', text: `Систем: ${list.length}` });
          } catch (e) {
            fail(e, 'Не удалось импортировать');
          }
        },
      });
    } catch (e) {
      fail(e, 'Файл не подходит для импорта');
    }
  };

  const resetCatalog = () =>
    setConfirm({
      title: 'Сбросить каталог?',
      text: 'Все добавленные системы будут удалены из каталога, останутся NetBox и Корпоративная Вики.',
      confirmLabel: 'Сбросить',
      onConfirm: async () => {
        try {
          const list = structuredClone(DEFAULT_SYSTEMS);
          await repo.replaceAll(list);
          setSystems(list);
          log('reset', 'Каталог', 'Восстановлен исходный состав');
          toast({ title: 'Каталог сброшен' });
        } catch (e) {
          fail(e, 'Не удалось сбросить каталог');
        }
      },
    });

  const clearAudit = () =>
    setConfirm({
      title: 'Очистить журнал?',
      text: `Будет удалено записей: ${audit.length}. Действие нельзя отменить — при необходимости сначала выгрузите CSV.`,
      confirmLabel: 'Очистить',
      onConfirm: () => {
        setAudit([]);
        store.set(AUDIT_KEY, []);
        toast({ title: 'Журнал очищен' });
      },
    });

  const commands = [
    { icon: 'plus', label: 'Добавить систему', keywords: 'новая создать', hint: 'N', run: openAdd },
    { icon: 'dashboard', label: 'Перейти: Каталог систем', keywords: 'главная обзор', run: () => navigate('overview') },
    { icon: 'activity', label: 'Перейти: Мониторинг', keywords: 'статус доступность', run: () => navigate('monitoring') },
    { icon: 'audit', label: 'Перейти: Журнал действий', keywords: 'аудит история', run: () => navigate('audit') },
    { icon: 'sliders', label: 'Перейти: Настройки', keywords: 'параметры', run: () => navigate('settings') },
    { icon: 'refresh', label: 'Проверить доступность всех систем', keywords: 'health', run: checkAll },
    {
      icon: prefs.theme === 'dark' ? 'sun' : 'moon',
      label: prefs.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему',
      keywords: 'тема оформление',
      run: () => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' }),
    },
    { icon: 'download', label: 'Экспорт каталога в JSON', keywords: 'выгрузка резервная копия', run: exportJson },
  ];

  const titles = {
    overview: ['Каталог систем', 'Главная'],
    monitoring: ['Мониторинг', 'Состояние'],
    audit: ['Журнал действий', 'Аудит'],
    settings: ['Настройки', 'Параметры'],
  };

  return (
    <div className={`app ${prefs.collapsed ? 'app--collapsed' : ''}`}>
      <div className="backdrop" aria-hidden="true" />
      <Sidebar
        page={page}
        onNavigate={navigate}
        systems={systems}
        health={health}
        counts={{ overview: systems.length, monitoring: alerts.length ? alerts.length : null, alerts: alerts.length }}
        open={mobileNav}
        onClose={() => setMobileNav(false)}
        collapsed={prefs.collapsed}
        onToggleCollapse={() => setPrefs({ collapsed: !prefs.collapsed })}
        storageMode={repo.mode}
      />
      <div className="main">
        <Topbar
          title={titles[page][0]}
          crumbs={titles[page][1]}
          onMenu={() => setMobileNav(true)}
          onPalette={() => setPalette(true)}
          theme={prefs.theme}
          onTheme={(t) => setPrefs({ theme: t })}
          gateway={gateway}
          alerts={alerts}
          onNavigate={navigate}
          onAdd={openAdd}
        />
        <main className="content" id="main">
          {config.demo && (
            <div className="demo-bar">
              <span className="pill tone--info">Демо</span>
              Статусы систем имитируются: превью открыто вне сервера {config.domain}. На сервере проверка идёт по-настоящему.
            </div>
          )}
          {loadError ? (
            <div className="banner banner--bad">
              <span className="banner__icon">!</span>
              <div className="banner__text">
                <strong>Каталог не загружен</strong>
                <span>{loadError}</span>
              </div>
              <button type="button" className="btn btn--ghost" onClick={load}>
                Повторить
              </button>
            </div>
          ) : page === 'overview' ? (
            <Overview systems={systems} health={health} gateway={gateway} prefs={prefs} setPrefs={setPrefs} actions={actions} onAdd={openAdd} loading={loading} />
          ) : page === 'monitoring' ? (
            <Monitoring systems={systems} health={health} gateway={gateway} lastRun={lastRun} running={running} onCheckAll={checkAll} interval={prefs.interval} actions={actions} now={now} />
          ) : page === 'audit' ? (
            <Audit entries={audit} onClear={clearAudit} now={now} />
          ) : (
            <Settings prefs={prefs} setPrefs={setPrefs} storageMode={repo.mode} systemsCount={systems.length} onExport={exportJson} onImport={importJson} onReset={resetCatalog} />
          )}
        </main>
        <footer className="app-foot">
          <span>
            © {new Date().getFullYear()} {config.organization}
          </span>
          <span className="mono">
            {config.domain} · v{config.version}
          </span>
        </footer>
      </div>

      <button type="button" className="fab only-mobile" onClick={openAdd} aria-label="Добавить систему">
        +
      </button>

      <SystemModal
        open={modal.open}
        initial={modal.initial}
        systems={systems}
        onClose={() => setModal({ open: false, initial: null })}
        onSubmit={saveSystem}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        text={confirm?.text}
        confirmLabel={confirm?.confirmLabel}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          c?.onConfirm();
        }}
      />
      <CommandPalette open={palette} onClose={() => setPalette(false)} systems={systems} health={health} commands={commands} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
