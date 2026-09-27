import { Modal } from './ui.jsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

// keys — массив «клавиш», label — что делает
function buildRows(canEdit) {
  return [
    { keys: [MOD, 'K'], label: 'Быстрый поиск систем и команд' },
    { keys: ['/'], label: 'Поиск по каталогу' },
    canEdit && { keys: ['N'], label: 'Добавить систему' },
    { keys: ['V'], label: 'Режим витрины (NOC-стена)' },
    { keys: ['?'], label: 'Эта подсказка' },
    { keys: ['Esc'], label: 'Закрыть окно, меню или витрину' },
    { keys: ['↑', '↓'], label: 'Навигация в списках и палитре' },
    { keys: ['Enter'], label: 'Открыть выбранный элемент' },
  ].filter(Boolean);
}

export default function ShortcutsModal({ open, onClose, canEdit }) {
  return (
    <Modal open={open} onClose={onClose} width={480} title="Горячие клавиши" subtitle="Управление порталом с клавиатуры">
      <ul className="keymap">
        {buildRows(canEdit).map((row) => (
          <li key={row.label} className="keymap__row">
            <span className="keymap__keys">
              {row.keys.map((k, i) => (
                <kbd key={i}>{k}</kbd>
              ))}
            </span>
            <span className="keymap__label">{row.label}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
