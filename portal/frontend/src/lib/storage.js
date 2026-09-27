// localStorage — только для личных настроек (тема, вид, интервал обновления).
// Каталог и журнал хранятся на сервере. В приватном режиме портал работает без сохранения настроек.
export const store = {
  get(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* хранилище недоступно */
    }
  },
};
