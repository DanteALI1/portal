import { useEffect, useState } from "react";

const ICONS = {
  grid: "▣",
  network: "◈",
  book: "☰",
  link: "↗",
};

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

function StatusBadge({ status }) {
  const label =
    status === "online" ? "online" : status === "offline" ? "offline" : "проверка";
  return (
    <span className="badge">
      <span className={`dot ${status || ""}`} />
      {label}
    </span>
  );
}

function AddModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    url: "",
    healthUrl: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onCreate({
        name: form.name.trim(),
        description: form.description.trim(),
        url: form.url.trim(),
        healthUrl: form.healthUrl.trim() || form.url.trim(),
        icon: "link",
        category: "custom",
      });
      onClose();
    } catch (err) {
      setError(err.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Добавить систему</h3>
        {error ? <div className="error">{error}</div> : null}
        <form className="form" onSubmit={submit}>
          <label>
            Название
            <input
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Grafana"
            />
          </label>
          <label>
            Описание
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Кратко, зачем система"
            />
          </label>
          <label>
            URL
            <input
              required
              value={form.url}
              onChange={(e) => update("url", e.target.value)}
              placeholder="/grafana/ или https://..."
            />
          </label>
          <label>
            Health URL (опционально)
            <input
              value={form.healthUrl}
              onChange={(e) => update("healthUrl", e.target.value)}
              placeholder="/grafana/api/health"
            />
          </label>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Сохранение…" : "Добавить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [systems, setSystems] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadSystems() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/systems");
      setSystems(data);
    } catch (err) {
      setError(err.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  async function refreshStatuses(list) {
    const target = list || systems;
    const next = { ...statuses };
    await Promise.all(
      target.map(async (item) => {
        try {
          const result = await api(`/api/systems/${item.id}/status`);
          next[item.id] = result.status;
        } catch {
          next[item.id] = "offline";
        }
      })
    );
    setStatuses({ ...next });
  }

  useEffect(() => {
    loadSystems().then((_) => {});
  }, []);

  useEffect(() => {
    if (!systems.length) return;
    refreshStatuses(systems);
    const timer = setInterval(() => refreshStatuses(systems), 30000);
    return () => clearInterval(timer);
  }, [systems.map((s) => s.id).join(",")]);

  async function createSystem(payload) {
    await api("/api/systems", { method: "POST", body: JSON.stringify(payload) });
    await loadSystems();
  }

  async function removeSystem(id, e) {
    e.stopPropagation();
    if (!confirm("Удалить систему из портала?")) return;
    try {
      await api(`/api/systems/${id}`, { method: "DELETE" });
      await loadSystems();
    } catch (err) {
      setError(err.message || "Не удалось удалить");
    }
  }

  function openSystem(url) {
    if (!url) return;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      window.location.href = url;
      return;
    }
    window.location.href = url;
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div className="brand-name">
            <span>REP Portal</span>
          </div>
        </div>
        <p>
          Единый доступ к корпоративным системам на <strong>rep.local.inion</strong>.
          Выберите сервис или добавьте новый маршрут в каталог.
        </p>
      </header>

      <div className="toolbar">
        <h2>Доступные системы</h2>
        <div className="actions">
          <button className="btn" onClick={() => refreshStatuses()} type="button">
            Обновить статусы
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)} type="button">
            Добавить
          </button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="grid">
        {loading && !systems.length ? (
          <div className="system">Загрузка…</div>
        ) : (
          systems.map((item, index) => (
            <article
              key={item.id}
              className="system"
              style={{ animationDelay: `${index * 60}ms` }}
              onClick={() => openSystem(item.url)}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") openSystem(item.url);
              }}
            >
              <div className="system-top">
                <div className="icon">{ICONS[item.icon] || ICONS.link}</div>
                {!item.builtin ? (
                  <button
                    className="ghost-btn"
                    type="button"
                    title="Удалить"
                    onClick={(e) => removeSystem(item.id, e)}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              <div>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
              </div>
              <div className="meta">
                <StatusBadge status={statuses[item.id]} />
                <span className="badge">{item.url}</span>
              </div>
            </article>
          ))
        )}
      </section>

      <footer className="footer">
        Red OS 8 · Nginx · Docker · NetBox · MediaWiki
      </footer>

      {showAdd ? (
        <AddModal onClose={() => setShowAdd(false)} onCreate={createSystem} />
      ) : null}
    </div>
  );
}
