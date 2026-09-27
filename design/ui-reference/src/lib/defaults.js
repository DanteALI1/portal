export const DEFAULT_SYSTEMS = [
  {
    id: 'netbox',
    name: 'NetBox',
    description:
      'Учёт сетевой инфраструктуры: стойки, устройства, кабельные соединения, IP-адресное пространство и VLAN.',
    url: '/netbox/',
    icon: 'network',
    accent: 'blue',
    category: 'Инфраструктура',
    tags: ['DCIM', 'IPAM'],
    owner: 'Отдел сетевой инфраструктуры',
    newTab: false,
    pinned: true,
    builtin: true,
    createdAt: '2026-01-15T09:00:00.000Z',
    updatedAt: '2026-01-15T09:00:00.000Z',
  },
  {
    id: 'mediawiki',
    name: 'Корпоративная Вики',
    description:
      'База знаний на MediaWiki: регламенты, инструкции, описания сервисов и технические статьи.',
    url: '/wiki/',
    icon: 'book',
    accent: 'teal',
    category: 'Документация',
    tags: ['MediaWiki', 'База знаний'],
    owner: 'Служба поддержки',
    newTab: false,
    pinned: true,
    builtin: true,
    createdAt: '2026-01-15T09:00:00.000Z',
    updatedAt: '2026-01-15T09:00:00.000Z',
  },
];

// Палитра акцентов для карточек систем
export const ACCENTS = {
  blue: { label: 'Синий', a: '#4C8DFF', b: '#6A5CFF' },
  teal: { label: 'Бирюзовый', a: '#14C8B4', b: '#1E9BD7' },
  green: { label: 'Зелёный', a: '#34C77B', b: '#12A1A1' },
  amber: { label: 'Янтарный', a: '#F2B33D', b: '#F07A3A' },
  rose: { label: 'Розовый', a: '#F2557A', b: '#C64FD8' },
  violet: { label: 'Фиолетовый', a: '#9B6BFF', b: '#5B6CFF' },
  slate: { label: 'Графит', a: '#8A97AD', b: '#56627A' },
  sky: { label: 'Голубой', a: '#3CC2F5', b: '#4C7DFF' },
};
