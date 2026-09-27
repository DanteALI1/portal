import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar, Topbar, NAV } from './components/Shell.jsx';
import SystemModal from './components/SystemModal.jsx';
import SystemDrawer from './components/SystemDrawer.jsx';
import ShortcutsModal from './components/ShortcutsModal.jsx';
import Kiosk from './components/Kiosk.jsx';
import { CommandPalette, ConfirmDialog, Toasts } from './components/Overlays.jsx';
import { healthState } from './components/SystemCard.jsx';
import Overview from './pages/Overview.jsx';
import Monitoring from './pages/Monitoring.jsx';
import Audit from './pages/Audit.jsx';
import Settings from './pages/Settings.jsx';
import { config } from './lib/config.js';
import { store } from './lib/storage.js';
import { auditApi, meApi, systemsApi } from './lib/api.js';
import { useHealth, STATE_LABEL } from './lib/health.js';
import { copyText, downloadFile, formatMs, fullUrl } from './lib/format.js';

const PREFS_KEY = 'portal.prefs.v1';

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

// Поля, которые передаются на сервер при создании и изменении
const SYSTEM_FIELDS = [
  'name', 'url', 'description', 'category', 'owner', 'icon', 'accent', 'tags',
  'healthUrl', 'internalHealthUrl', 'newTab', 'pinned',
];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

function pageFromHash(pages) {
  const h = window.location.hash.replace(/^#\/?/, '');
  return pages.includes(h) ? h : 'overview';
}

export default function App() {
  const [me, setMe] = useState(null);
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [prefs, setPrefsState] = useState(() => ({ ...DEFAULT_PREFS, ...store.get(PREFS_KEY, {}), query: '' }));
  const [audit, setAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState({ open: false, initial: null, errors: {} });
  const [confirm, setConfirm] = useState(null);
  const [palette, setPalette] = useState(false);
  const [detail, setDetail] = useState(null); // система в дровере подробностей
  const [shortcuts, setShortcuts] = useState(false); // оверлей горячих клавиш
  const [kiosk, setKiosk] = useState(false); // режим витрины (NOC-стена)
  const [mobileNav, setMobileNav] = useState(false);
  const [now, setNow] = useState(Date.now());

  const isAdmin = Boolean(me?.isAdmin);
  const nav = useMemo(() => NAV.filter((n) => !n.adminOnly || isAdmin), [isAdmin]);
  const pages = nav.map((n) => n.id);
  const [page, setPage] = useState(() => pageFromHash(NAV.map((n) => n.id)));

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
  const fail = useCallback(
    (e, title) =>
      toast({
        type: 'error',
        title: e.status === 403 ? 'Недостаточно прав' : title,
        text: e.message || 'Попробуйте ещё раз',
      }),
    [toast],
  );

  // ——— пользователь и каталог ———
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [user, list] = await Promise.all([meApi(), systemsApi.list()]);
      setMe(user);
      setSystems(list);
    } catch (e) {
      if (e.status !== 401) setLoadError(e.status === 403 ? 'Нет доступа к порталу' : e.message || 'Не удалось загрузить каталог');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // ——— журнал (только для администраторов) ———
  const loadAudit = useCallback(async () => {
    if (!isAdmin) return;
    setAuditLoading(true);
    try {
      setAudit(await auditApi(300));
    } catch (e) {
      fail(e, 'Не удалось загрузить журнал');
    } finally {
      setAuditLoading(false);
    }
  }, [isAdmin, fail]);
  useEffect(() => {
    if (page === 'audit') loadAudit();
  }, [page, loadAudit]);

  // ——— мониторинг ———
  const onTransition = useCallback(
    (sys, from, to) => {
      if (to === 'offline') toast({ type: 'error', title: `${sys.name} недоступна`, text: 'Система перестала отвечать на проверку' });
      if (from === 'offline' && to !== 'offline') toast({ type: 'success', title: `${sys.name} снова работает` });
    },
    [toast],
  );
  const { health, gateway, components, lastRun, running, checkAll, checkOne } = useHealth(
    systems,
    prefs.interval,
    onTransition,
    Boolean(me),
  );

  const alerts = useMemo(
    () =>
      systems
        .map((sys) => {
          const h = health[sys.id];
          const state = healthState(h);
          if (state === 'offline') return { sys, state, message: h?.last?.detail || 'Нет ответа' };
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
    const onHash = () => setPage(pageFromHash(pages));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [pages]);
  // Журнал недоступен без прав администратора
  useEffect(() => {
    if (me && !pages.includes(page)) navigate('overview');
  }, [me, pages, page, navigate]);
  useEffect(() => {
    const title = NAV.find((n) => n.id === page)?.label;
    document.title = `${title} · ${config.title}`;
  }, [page]);

  const openAdd = useCallback(() => {
    if (isAdmin) setModal({ open: true, initial: null, errors: {} });
  }, [isAdmin]);

  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      const plain = !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (plain && e.key === '?') {
        e.preventDefault();
        setShortcuts((s) => !s);
      } else if (plain && (e.key === 'v' || e.key === 'м') && !modal.open && !palette) {
        e.preventDefault();
        setKiosk((k) => !k);
      } else if (isAdmin && plain && (e.key === 'n' || e.key === 'т') && !modal.open && !palette) {
        e.preventDefault();
        openAdd();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal.open, palette, openAdd, isAdmin]);

  // ——— операции с каталогом (сервер повторно проверяет права и поля) ———
  const saveSystem = async (form) => {
    try {
      if (modal.initial?.id) {
        const saved = await systemsApi.update({ id: modal.initial.id, ...pick(form, SYSTEM_FIELDS) });
        setSystems((list) => list.map((s) => (s.id === saved.id ? saved : s)));
        toast({ title: 'Изменения сохранены', text: saved.name });
      } else {
        const saved = await systemsApi.create(pick(form, SYSTEM_FIELDS));
        setSystems((list) => [...list, saved]);
        toast({
          title: 'Система добавлена',
          text: saved.url.startsWith('/') ? `Проверьте, что в Nginx настроен маршрут ${saved.url}` : saved.name,
        });
      }
      setModal({ open: false, initial: null, errors: {} });
    } catch (e) {
      if (e.fields && Object.keys(e.fields).length) setModal((m) => ({ ...m, errors: e.fields }));
      fail(e, 'Не удалось сохранить систему');
    }
  };

  // Отмена удаления: повторный POST исходной записи с тем же id
  const restore = async (sys, index) => {
    try {
      const saved = await systemsApi.create(sys);
      setSystems((list) => {
        const next = list.filter((s) => s.id !== saved.id);
        next.splice(Math.min(index, next.length), 0, saved);
        return next;
      });
      toast({ title: 'Система восстановлена', text: sys.name });
    } catch (e) {
      fail(e, 'Не удалось восстановить систему');
    }
  };

  const deleteSystem = async (sys) => {
    const index = systems.findIndex((s) => s.id === sys.id);
    try {
      await systemsApi.remove(sys.id);
      setSystems((list) => list.filter((s) => s.id !== sys.id));
      toast({ title: 'Система удалена', text: sys.name, action: { label: 'Отменить', icon: 'undo', onClick: () => restore(sys, index) } });
    } catch (e) {
      fail(e, 'Не удалось удалить систему');
    }
  };

  const togglePin = async (sys) => {
    try {
      const saved = await systemsApi.update({ ...pick(sys, SYSTEM_FIELDS), id: sys.id, pinned: !sys.pinned });
      setSystems((list) => list.map((s) => (s.id === saved.id ? saved : s)));
      toast({ title: saved.pinned ? 'Добавлено в избранное' : 'Убрано из избранного', text: sys.name });
    } catch (e) {
      fail(e, 'Не удалось обновить систему');
    }
  };

  const actions = {
    canEdit: isAdmin,
    onDetails: (sys) => setDetail(sys.id),
    onEdit: (sys) => setModal({ open: true, initial: sys, errors: {} }),
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
    const payload = { format: 'rep-portal/systems', version: 2, exportedAt: new Date().toISOString(), domain: config.domain, systems };
    downloadFile(`portal-systems-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  };

  const importJson = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      const raw = Array.isArray(data) ? data : data.systems;
      if (!Array.isArray(raw)) throw new Error('В файле нет списка систем');
      const list = raw
        .filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string')
        .map((s) => ({ ...pick(s, [...SYSTEM_FIELDS, 'id', 'createdAt', 'builtin']) }));
      if (!list.length) throw new Error('Не найдено ни одной системы с полями name и url');
      setConfirm({
        title: `Заменить каталог (${list.length})?`,
        text: `Текущие ${systems.length} систем будут заменены содержимым файла «${file.name}». Перед импортом рекомендуем сделать экспорт.`,
        confirmLabel: 'Импортировать',
        onConfirm: async () => {
          try {
            const saved = await systemsApi.replaceAll(list, 'import', file.name);
            setSystems(saved);
            toast({ title: 'Каталог импортирован', text: `Систем: ${saved.length}` });
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
          const saved = await systemsApi.replaceAll([], 'reset');
          setSystems(saved);
          toast({ title: 'Каталог сброшен' });
        } catch (e) {
          fail(e, 'Не удалось сбросить каталог');
        }
      },
    });

  const commands = [
    isAdmin && { icon: 'plus', label: 'Добавить систему', keywords: 'новая создать', hint: 'N', run: openAdd },
    { icon: 'dashboard', label: 'Перейти: Каталог систем', keywords: 'главная обзор', run: () => navigate('overview') },
    { icon: 'activity', label: 'Перейти: Мониторинг', keywords: 'статус доступность', run: () => navigate('monitoring') },
    isAdmin && { icon: 'audit', label: 'Перейти: Журнал действий', keywords: 'аудит история', run: () => navigate('audit') },
    { icon: 'sliders', label: 'Перейти: Настройки', keywords: 'параметры', run: () => navigate('settings') },
    { icon: 'refresh', label: 'Проверить доступность всех систем', keywords: 'health', run: checkAll },
    { icon: 'monitor', label: 'Режим витрины (NOC-стена)', keywords: 'kiosk дашборд экран стена tv', hint: 'V', run: () => setKiosk(true) },
    { icon: 'command', label: 'Горячие клавиши', keywords: 'shortcuts помощь клавиатура', hint: '?', run: () => setShortcuts(true) },
    {
      icon: prefs.theme === 'dark' ? 'sun' : 'moon',
      label: prefs.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему',
      keywords: 'тема оформление',
      run: () => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' }),
    },
    { icon: 'download', label: 'Экспорт каталога в JSON', keywords: 'выгрузка резервная копия', run: exportJson },
    { icon: 'users', label: 'Профиль единого входа', keywords: 'пароль учётная запись', run: () => window.location.assign(config.profileUrl) },
    { icon: 'lock', label: 'Выйти', keywords: 'выход logout', run: () => window.location.assign(config.logoutUrl) },
  ].filter(Boolean);

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
        nav={nav}
        page={page}
        onNavigate={navigate}
        systems={systems}
        health={health}
        counts={{ overview: systems.length, monitoring: alerts.length ? alerts.length : null, alerts: alerts.length }}
        open={mobileNav}
        onClose={() => setMobileNav(false)}
        collapsed={prefs.collapsed}
        onToggleCollapse={() => setPrefs({ collapsed: !prefs.collapsed })}
        user={me}
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
          user={me}
        />
        <main className="content" id="main">
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
            <Overview systems={systems} health={health} gateway={gateway} prefs={prefs} setPrefs={setPrefs} actions={actions} onAdd={openAdd} loading={loading} canEdit={isAdmin} user={me} />
          ) : page === 'monitoring' ? (
            <Monitoring systems={systems} health={health} gateway={gateway} components={components} lastRun={lastRun} running={running} onCheckAll={checkAll} interval={prefs.interval} actions={actions} now={now} />
          ) : page === 'audit' && isAdmin ? (
            <Audit entries={audit} loading={auditLoading} onReload={loadAudit} now={now} />
          ) : (
            <Settings prefs={prefs} setPrefs={setPrefs} systemsCount={systems.length} onExport={exportJson} onImport={importJson} onReset={resetCatalog} canEdit={isAdmin} user={me} />
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

      {isAdmin && (
        <button type="button" className="fab only-mobile" onClick={openAdd} aria-label="Добавить систему">
          +
        </button>
      )}

      <SystemModal
        open={modal.open}
        initial={modal.initial}
        systems={systems}
        serverErrors={modal.errors}
        onClose={() => setModal({ open: false, initial: null, errors: {} })}
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
      <SystemDrawer
        system={systems.find((s) => s.id === detail) || null}
        health={detail ? health[detail] : undefined}
        actions={actions}
        now={now}
        onClose={() => setDetail(null)}
      />
      <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} canEdit={isAdmin} />
      <Kiosk open={kiosk} systems={systems} health={health} gateway={gateway} onExit={() => setKiosk(false)} onRefresh={checkAll} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
