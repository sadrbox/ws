/**
 * Единый реестр иконок интерфейса.
 *
 * Все иконки — современный line-style, 16×16, stroke=1.5,
 * `stroke="currentColor"` (наследуют цвет родителя — работают в светлой
 * и тёмной теме одинаково), centered viewBox 0 0 16 16, fill="none"
 * для линейных, и заливка currentColor только для решёток (list).
 *
 * Использование:
 *   import { Icon } from "src/components/icons";
 *   <Icon name="recalc" />
 *
 * или прямое:
 *   import { RecalcIcon } from "src/components/icons";
 */

import type { FC, SVGProps } from "react";

type SvgProps = SVGProps<SVGSVGElement> & { title?: string };

const baseProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": true as const,
  focusable: false,
};

// ── Toolbar / общие действия ─────────────────────────────────────────────

/** Пересчитать — калькулятор: дисплей + сетка кнопок 3×2.
 *  Ассоциация «арифметический пересчёт сумм» точнее, чем «обновить». */
export const RecalcIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <rect x="3" y="2" width="10" height="12" rx="1.5" />
    <rect x="4.5" y="3.5" width="7" height="2.2" rx="0.4" />
    <circle cx="5.5" cy="8" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="8" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="5.5" cy="10.25" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="8" cy="10.25" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="10.25" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="5.5" cy="12.5" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="8" cy="12.5" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="12.5" r="0.55" fill="currentColor" stroke="none" />
  </svg>
);

/** Бухгалтерские проводки — книга-журнал с записями (Дт/Кт). */
export const LedgerIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9.5H4.5A1.5 1.5 0 0 1 3 12V2.5z" />
    <path d="M3 2.5v11" />
    <path d="M5.5 5.5h5" />
    <path d="M5.5 8h5" />
    <path d="M5.5 10.5h3" />
  </svg>
);

/** Настройки колонок — слайдеры (горизонтальные ползунки с ручками). */
export const SettingsIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2 4h7" />
    <path d="M12 4h2" />
    <circle cx="10.5" cy="4" r="1.5" />
    <path d="M2 8h2" />
    <path d="M7 8h7" />
    <circle cx="5.5" cy="8" r="1.5" />
    <path d="M2 12h7" />
    <path d="M12 12h2" />
    <circle cx="10.5" cy="12" r="1.5" />
  </svg>
);

/** Обновить — изогнутая стрелка по кругу. */
export const ReloadIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.5 2.5v3h-3" />
  </svg>
);

/** Поиск — лупа. */
export const SearchIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </svg>
);

/** Календарь / период. */
export const CalendarIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" />
    <path d="M2 6.5h12" />
    <path d="M5 2v3" />
    <path d="M11 2v3" />
  </svg>
);

/** Inline-редактирование — карандаш на строке. */
export const EditInlineIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2 14h12" />
    <path d="M9.5 3.5l3 3-6.5 6.5H3v-3z" />
    <path d="M8.5 4.5l3 3" />
  </svg>
);

/** Сделать основным — звезда. */
export const MakePrimaryIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M8 2l1.85 3.75 4.15.6-3 2.93.71 4.13L8 11.45l-3.71 1.96.71-4.13-3-2.93 4.15-.6z" />
  </svg>
);

/** Закрыть — крест. */
export const CloseIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3.5 3.5l9 9" />
    <path d="M12.5 3.5l-9 9" />
  </svg>
);

// ── FieldActions (LookupField) ───────────────────────────────────────────

/** Очистить поле — крест (по тому же визуальному стилю, что CloseIcon). */
export const ClearIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3.5 3.5l9 9" />
    <path d="M12.5 3.5l-9 9" />
  </svg>
);

/** Плюс — увеличение количества (степпер строки). */
export const PlusIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M8 3.5v9" />
    <path d="M3.5 8h9" />
  </svg>
);

/** Минус — уменьшение количества (степпер строки). */
export const MinusIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3.5 8h9" />
  </svg>
);

/** Документ проведён — заполненный кружок с галочкой.
 *  Используется в списках для индикации проведённого документа
 *  вместо ранее использовавшейся точки <span> с inline-стилями. */
export const PostedIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="8" cy="8" r="6" fill="currentColor" stroke="currentColor" />
    <path
      d="M5 8.2l2.2 2.2L11 6.4"
      stroke="#fff"
      strokeWidth={1.8}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Документ НЕ проведён — пустой кружок (контур). */
export const NotPostedIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="8" cy="8" r="6" />
  </svg>
);

/** Быстрый выбор (dropdown chevron). */
export const QuickSelectIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4 6.5l4 4 4-4" />
  </svg>
);

/** Выбрать из списка — маркированный список (точка + строка ×3).
 *  Раньше были три голые линии: неотличимо от «гамбургер-меню» и не читалось как
 *  «список, из которого выбирают». Маркеры делают смысл однозначным, а сам глиф —
 *  лаконичнее по восприятию. */
export const ListIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="3.25" cy="4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="3.25" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="3.25" cy="12" r="0.9" fill="currentColor" stroke="none" />
    <path d="M6.5 4h7" />
    <path d="M6.5 8h7" />
    <path d="M6.5 12h7" />
  </svg>
);

export const ViewSplitIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <rect x="2" y="3" width="5" height="10" rx="1" />
    <rect x="9" y="3" width="5" height="10" rx="1" />
  </svg>
);

/** Одиночная панель (список без предпросмотра) — ВЫКЛЮЧЕННОЕ состояние тумблера
 *  «Переключить вид списка». Раньше там стояла ListIcon (три полоски) — та же самая
 *  иконка, что у кнопки «Показать в списке», и пользователи их путали. Теперь тумблер
 *  имеет собственную пару «одна панель ↔ две панели» (ViewSingle ↔ ViewSplit):
 *  иконки читаются как состояния одного переключателя и ни с чем не пересекаются. */
export const ViewSingleIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M4.5 6.5h7" />
    <path d="M4.5 9.5h7" />
  </svg>
);

/** Открыть элемент — классическая «external link»: рамка с открытым правым-верхним
 *  углом и стрелка, выходящая наружу. Углы скруглены, линии выровнены по сетке —
 *  читается мгновенно и не спорит с рамкой поля вокруг. */
export const OpenIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M8 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V8" />
    <path d="M9.5 3.5H13V7" />
    <path d="M13 3.5L7.75 8.75" />
  </svg>
);

/** Печать (принтер). */
export const PrintIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    {/* Верхний «лист» */}
    <path d="M4.5 5.5V2.5h7v3" />
    {/* Корпус принтера */}
    <path d="M3 5.5h10a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1.5" />
    <path d="M3 5.5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1.5" />
    {/* Бумажный «выход» */}
    <rect x="4.5" y="9" width="7" height="4.5" rx="0.5" />
    <path d="M6 10.5h4" />
    <path d="M6 12h3" />
  </svg>
);

/** Индикатор несохранённых изменений — карандаш. */
export const DirtyIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3 13h2l7-7-2-2-7 7z" />
    <path d="M10 4l2 2" />
    <path d="M3 13.5h3" />
  </svg>
);

/** Восстановить несохранённые изменения — закруглённая стрелка против часовой
 *  со стрелкой-наконечником и точкой в центре. Используется в кнопке stash
 *  (PaneItemHeaderToolbar) для восстановления данных прошлой сессии. */
export const RestoreIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    {/* Дуга, открытая слева сверху */}
    <path d="M3 8a5 5 0 1 0 1.5-3.5" />
    {/* Стрелка наконечник */}
    <path d="M3 3v3h3" />
    {/* Точка в центре — индикатор изменений */}
    <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="currentColor" />
  </svg>
);

/** Сохранение/скачивание — дискета с лёгкой стрелкой вниз. */
export const SaveIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3 2.5h7l3 3V13a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 2 13V3a.5.5 0 0 1 .5-.5z" />
    <path d="M4.5 2.5v3.5h6V2.5" />
    <rect x="5" y="9" width="5.5" height="4.5" />
  </svg>
);

/** Каретка ▼ для dropdown-кнопок. */
export const CaretDownIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

/** На основании — исходный документ + стрелка + целевой документ (создать на базе другого). */
export const FromBasisIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <rect x="1.5" y="1.5" width="6.5" height="8.5" rx="1" />
    <path d="M3 4.5h3.5" />
    <path d="M3 6.5h2.5" />
    <path d="M3 8.5h1.5" />
    <path d="M8.5 6h2" />
    <path d="M9.5 5l1.5 1-1.5 1" />
    <rect x="11" y="4" width="3.5" height="5.5" rx="1" />
  </svg>
);

/** Перезаполнить по основанию — стрелки синхронизации + мини-документ в центре. */
/** Связанные документы (цепочка) — ДЕРЕВО СВЯЗЕЙ: узел-основание слева, порождённые
 *  документы справа. Раньше здесь стояла FromBasisIcon — та же иконка, что у дропдауна
 *  «На основании», причём обе кнопки соседствуют в шапке формы, и пользователи их путали.
 *  «На основании» = СОЗДАТЬ (документ→стрелка→документ), цепочка = ПОСМОТРЕТЬ (граф). */
export const DocumentChainIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="3" cy="8" r="2" />
    <circle cx="13" cy="4" r="2" />
    <circle cx="13" cy="12" r="2" />
    <path d="M5 8h3" />
    <path d="M8 4v8" />
    <path d="M8 4h3" />
    <path d="M8 12h3" />
  </svg>
);

export const SyncFromBasisIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M13.5 8A5.5 5.5 0 0 0 8 2.5" />
    <path d="M13.5 5v3h-3" />
    <path d="M2.5 8A5.5 5.5 0 0 0 8 13.5" />
    <path d="M2.5 11v-3h3" />
    <rect x="5.5" y="5.5" width="5" height="5" rx="0.7" />
    <path d="M7 7.5h2" />
    <path d="M7 9h1.5" />
  </svg>
);

// ── Реестр + универсальный <Icon name="…" /> ─────────────────────────────

/** Удалить — корзина. */
export const TrashIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3 4.5h10" />
    <path d="M6.5 4.5V3h3v1.5" />
    <path d="M4.5 4.5l.7 8.5h5.6l.7-8.5" />
    <path d="M6.7 6.8v4.4M9.3 6.8v4.4" />
  </svg>
);

/** Ссылка (цепочка) — копировать ссылку на текущую панель. */
export const LinkIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M6.5 9.5l3-3" />
    <path d="M8 4.5l.8-.8a2.5 2.5 0 0 1 3.5 3.5l-.8.8" />
    <path d="M8 11.5l-.8.8a2.5 2.5 0 0 1-3.5-3.5l.8-.8" />
  </svg>
);

/** Скачать (стрелка вниз в лоток). */
export const DownloadIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M8 2.5v7" />
    <path d="M5 7l3 3 3-3" />
    <path d="M3 12.5h10" />
  </svg>
);

/** Серийные номера — знак «№» (hash). Читается как «номер единицы». */
export const SerialIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M6.25 2.75L4.75 13.25" />
    <path d="M11.25 2.75L9.75 13.25" />
    <path d="M3.25 6.25H13" />
    <path d="M3 9.75H12.75" />
  </svg>
);

/** Партия — картонная коробка (3D): партия/лот товара со сроком годности. */
export const BatchIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M8 2.5l5.25 2.75v5.5L8 13.5 2.75 10.75v-5.5L8 2.5Z" />
    <path d="M2.75 5.25L8 8l5.25-2.75" />
    <path d="M8 8v5.5" />
  </svg>
);

export const ICONS = {
  recalc: RecalcIcon,
  serial: SerialIcon,
  batch: BatchIcon,
  trash: TrashIcon,
  link: LinkIcon,
  download: DownloadIcon,
  ledger: LedgerIcon,
  settings: SettingsIcon,
  reload: ReloadIcon,
  search: SearchIcon,
  calendar: CalendarIcon,
  editInline: EditInlineIcon,
  makePrimary: MakePrimaryIcon,
  close: CloseIcon,
  clear: ClearIcon,
  plus: PlusIcon,
  minus: MinusIcon,
  quickselect: QuickSelectIcon,
  list: ListIcon,
  viewSplit: ViewSplitIcon,
  viewSingle: ViewSingleIcon,
  documentChain: DocumentChainIcon,
  open: OpenIcon,
  print: PrintIcon,
  posted: PostedIcon,
  notPosted: NotPostedIcon,
  dirty: DirtyIcon,
  restore: RestoreIcon,
  save: SaveIcon,
  caretDown: CaretDownIcon,
  fromBasis: FromBasisIcon,
  syncFromBasis: SyncFromBasisIcon,
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps extends SvgProps {
  name: IconName;
}

export const Icon: FC<IconProps> = ({ name, ...rest }) => {
  const Cmp = ICONS[name];
  return <Cmp {...rest} />;
};
