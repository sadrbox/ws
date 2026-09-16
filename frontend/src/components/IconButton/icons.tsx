/**
 * Единый реестр иконок интерфейса.
 *
 * СТИЛЬ: заполненный замкнутый контур (fill-based). Ни одной stroke-иконки: линии
 * выражены геометрией — полосами, кольцами и отверстиями через `fill-rule="evenodd"`.
 *
 * ПОЧЕМУ НЕ STROKE. Прежний набор был line-style со `stroke-width: 1.4` и круглыми
 * окончаниями. В 16×16 такая линия не ложится на пиксельную сетку: 1.4 px размазывается
 * на два пикселя с разной яркостью, а круглые окончания добавляют полупрозрачные хвосты —
 * иконки выглядели мыльными и «жирнее» шрифта рядом. Заполненный контур с целочисленными
 * координатами даёт ровно те пиксели, которые нарисованы.
 *
 * ПРАВИЛА ГЕОМЕТРИИ (их стоит соблюдать и в новых иконках):
 *   • viewBox 0 0 16 16, поля не меньше 1.5 px от края;
 *   • толщина основных элементов ~1 px; полосы кладутся на целые координаты
 *     (rect y=7 h=1 — это ровно один пиксель, y=7.3 — два серых);
 *   • контурная форма = кольцо: внешний контур + внутренний в ОДНОМ path с evenodd,
 *     а не две фигуры друг на друге;
 *   • массивная заливка только там, где она несёт смысл (каретка, звезда,
 *     индикатор проведения) — остальное сохраняет лёгкость контура;
 *   • цвет — `currentColor`; функциональные цвета (белая галка в «проведён»)
 *     заданы явно и не наследуют цвет текста.
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
  fill: "currentColor",
  fillRule: "evenodd" as const,
  clipRule: "evenodd" as const,
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": true as const,
  focusable: false,
};

// ── Toolbar / общие действия ─────────────────────────────────────────────

/** Пересчитать — калькулятор: корпус-кольцо, дисплей и сетка кнопок 3×3. */
export const RecalcIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3 2h10v12H3V2Zm1 1v10h8V3H4Z" />
    <path d="M5 4h6v2H5V4Z" />
    <path d="M5.1 7.6h1.2v1.2H5.1V7.6Zm2.3 0h1.2v1.2H7.4V7.6Zm2.3 0h1.2v1.2H9.7V7.6ZM5.1 9.9h1.2v1.2H5.1V9.9Zm2.3 0h1.2v1.2H7.4V9.9Zm2.3 0h1.2v1.2H9.7V9.9ZM5.1 12.2h1.2v1.2H5.1v-1.2Zm2.3 0h1.2v1.2H7.4v-1.2Zm2.3 0h1.2v1.2H9.7v-1.2Z" />
  </svg>
);

/** Бухгалтерские проводки — книга-журнал: корешок слева, записи справа. */
export const LedgerIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3 2h10v12H3V2Zm1 1v10h8V3H4Z" />
    <path d="M5 2h1v12H5V2Z" />
    <path d="M7 5h4v1H7V5Zm0 2.5h4v1H7v-1ZM7 10h2.5v1H7v-1Z" />
  </svg>
);

/** Настройки колонок — три ползунка: полосы с кольцевыми ручками. */
export const SettingsIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2 3h6.5v1H2V3Zm10.5 0H14v1h-1.5V3Z" />
    <path d="M10.5 1.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
    <path d="M2 7.5h1.5v1H2v-1Zm5.5 0H14v1H7.5v-1Z" />
    <path d="M5.5 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
    <path d="M2 12h6.5v1H2v-1Zm10.5 0H14v1h-1.5v-1Z" />
    <path d="M10.5 10.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
  </svg>
);

/** Обновить — круговая стрелка против часовой. */
export const ReloadIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    {/* Отражение прежней иконки по горизонтали: x → 16 − x, флаг обхода дуг инвертирован, стрелка слева. */}
    <path d="M4.85 3.49A5.5 5.5 0 1 0 9.88 2.83L9.54 3.77A4.5 4.5 0 1 1 5.42 4.31Z" />
    <path d="M5.2 1.9 1.9 4.1 5.6 5.9Z" />
  </svg>
);

/** Поиск — лупа: кольцо линзы и ручка. */
export const SearchIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 1a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" />
    <path d="M9.63 10.77 13.03 14.17 14.17 13.03 10.77 9.63Z" />
  </svg>
);

/** Календарь / период. */
export const CalendarIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4 1h1v3H4V1Zm7 0h1v3h-1V1Z" />
    <path d="M2 3h12v11H2V3Zm1 1v9h10V4H3Z" />
    <path d="M3 6h10v1H3V6Z" />
  </svg>
);

/** Inline-редактирование — карандаш над строкой. */
export const EditInlineIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M10.9 2.6 12.9 4.6 6.3 11.2 3.4 12.1 4.3 9.2 10.9 2.6Zm0 1.6L5.2 9.9l-.4 1.3 1.3-.4 5.7-5.7-.9-.9Z" />
    <path d="M2 13h12v1H2v-1Z" />
  </svg>
);

/** Сделать основным — звезда (сплошная: это отметка состояния, а не контур). */
export const MakePrimaryIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M8 1.6 9.9 5.5 14.2 6.1 11.1 9.1 11.8 13.4 8 11.4 4.2 13.4 4.9 9.1 1.8 6.1 6.1 5.5Z" />
  </svg>
);

/** Закрыть — крест. */
export const CloseIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3.58 4.42 11.58 12.42 12.42 11.58 4.42 3.58Z" />
    <path d="M11.58 3.58 3.58 11.58 4.42 12.42 12.42 4.42Z" />
  </svg>
);

// ── FieldActions (LookupField) ───────────────────────────────────────────

/** Очистить поле — крест (тот же глиф, что «Закрыть»: жест один и тот же). */
export const ClearIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3.58 4.42 11.58 12.42 12.42 11.58 4.42 3.58Z" />
    <path d="M11.58 3.58 3.58 11.58 4.42 12.42 12.42 4.42Z" />
  </svg>
);

/** Плюс — увеличение количества (степпер строки). */
export const PlusIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M7.4 3.4h1.2v9.2H7.4V3.4Z" />
    <path d="M3.4 7.4h9.2v1.2H3.4V7.4Z" />
  </svg>
);

/** Минус — уменьшение количества (степпер строки). */
export const MinusIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3.4 7.4h9.2v1.2H3.4V7.4Z" />
  </svg>
);

/**
 * Документ проведён — заполненный кружок с белой галочкой.
 *
 * Галочка задана СВОИМ цветом, а не currentColor: она читается как «вырез» в диске и
 * обязана оставаться светлой на любом фоне кнопки, иначе сливается с ним.
 */
export const PostedIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M7.1 12 3.9 8.8 5 7.7 7.1 9.8 11 5.9 12.1 7Z" fill="var(--sv-color60, #fff)" />
  </svg>
);

/** Документ НЕ проведён — кольцо. */
export const NotPostedIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 1a5 5 0 1 1 0 10A5 5 0 0 1 8 3Z" />
  </svg>
);

/** Быстрый выбор — шеврон вниз (контурный, в пару к каретке). */
export const QuickSelectIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3.74 6.86 7.54 10.66 8.46 9.74 4.66 5.94Z" />
    <path d="M11.34 5.94 7.54 9.74 8.46 10.66 12.26 6.86Z" />
  </svg>
);

/** Выбрать из списка — маркированный список: маркер + строка ×3. */
export const ListIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2.3 3h2v2h-2V3Zm0 4h2v2h-2V7Zm0 4h2v2h-2v-2Z" />
    <path d="M6 3.5h7.5v1H6v-1Zm0 4h7.5v1H6v-1Zm0 4h7.5v1H6v-1Z" />
  </svg>
);

/** Дерево — маркеры лесенкой: вложенность видна отступом. */
export const TreeIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2 3h2.2v2.2H2V3Z" />
    <path d="M5.2 3.6h8.3v1H5.2v-1Z" />
    <path d="M4.6 6.9h2.2v2.2H4.6V6.9Zm0 4.4h2.2v2.2H4.6v-2.2Z" />
    <path d="M7.8 7.5h5.7v1H7.8v-1Zm0 4.4h5.7v1H7.8v-1Z" />
  </svg>
);

/** Список + предпросмотр: две панели. */
export const ViewSplitIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2 3h5v10H2V3Zm1 1v8h3V4H3Z" />
    <path d="M9 3h5v10H9V3Zm1 1v8h3V4h-3Z" />
  </svg>
);

/** Одиночная панель — выключенное состояние тумблера «Переключить вид списка». */
export const ViewSingleIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2 3h12v10H2V3Zm1 1v8h10V4H3Z" />
    <path d="M4.5 6h7v1h-7V6Zm0 3h7v1h-7V9Z" />
  </svg>
);

/** Открыть элемент — стрелка «наружу вверх-вправо». */
export const OpenIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M5.03 10.27 10.27 5.03 10.97 5.73 5.73 10.97Z" />
    <path d="M11.5 4.5v4.7h-1V5.5H6.8v-1Z" />
  </svg>
);

/** Печать — принтер: корпус, лист сверху, вывод снизу. */
export const PrintIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4.5 2h7v4h-1V3h-5v3h-1V2Z" />
    <path d="M2 6h12v5h-2.5v-1H13V7H3v3h1.5v1H2V6Z" />
    <path d="M4 9h8v5H4V9Zm1 1v3h6v-3H5Z" />
  </svg>
);

/** Несохранённые изменения — карандаш с чертой. */
export const DirtyIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M10.9 2.6 12.9 4.6 6.3 11.2 3.4 12.1 4.3 9.2 10.9 2.6Zm0 1.6L5.2 9.9l-.4 1.3 1.3-.4 5.7-5.7-.9-.9Z" />
    <path d="M3 13h4v1H3v-1Z" />
  </svg>
);

/** Восстановить — круговая стрелка против часовой с точкой в центре. */
export const RestoreIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M5.13 3.9A5 5 0 1 0 10.5 3.67L10 4.54A4 4 0 1 1 5.71 4.72Z" />
    <path d="M5.2 1.9 1.9 4.1 5.6 5.9Z" />
    <circle cx="8" cy="8" r="1.4" />
  </svg>
);

/** Сохранить — дискета: корпус со срезанным углом, шторка и наклейка. */
export const SaveIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2 2h9.4L14 4.6V14H2V2Zm1 1v10h10V5L11 3H3Z" />
    <path d="M5 3h4v2.5H5V3Z" />
    <path d="M4.5 8.5h7V14h-1v-4.5h-5V14h-1V8.5Z" />
  </svg>
);

/** Каретка ▼ для dropdown-кнопок (сплошная: это не глиф-контур, а указатель). */
export const CaretDownIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4 6.2h8L8 10.8Z" />
  </svg>
);

/** На основании — исходный документ, стрелка, целевой документ. */
export const FromBasisIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M1.5 2h6v9h-6V2Zm1 1v7h4V3h-4Z" />
    <path d="M3.3 4.2h2.4v1H3.3v-1Zm0 2h1.8v1H3.3v-1Zm0 2h1.2v1H3.3v-1Z" />
    <path d="M8.4 6h2.2v1H8.4V6Z" />
    <path d="M10.2 4.9 12.4 6.5 10.2 8.1Z" />
    <path d="M11.5 3.5h3v6h-3v-1h2V4.5h-2Z" />
  </svg>
);

/** Связанные документы — дерево связей: узел-основание и порождённые. */
export const DocumentChainIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
    <path d="M13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
    <path d="M13 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
    <path d="M5 7.5h2.5v1H5v-1Z" />
    <path d="M7.5 3.5h1v9h-1v-9Z" />
    <path d="M8.5 3.5H11v1H8.5v-1Zm0 8H11v1H8.5v-1Z" />
  </svg>
);

/** Документ — лист с загнутым углом и строками. */
export const DocumentIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3.5 1.5h6L12.5 4.5V14.5h-9V1.5Zm1 1v11h7V5h-2.5V2.5H4.5Zm5 .7V4h.8Z" />
    <path d="M5.5 7h5v1h-5V7Zm0 2.4h5v1h-5v-1Zm0-4.8h2.2v1H5.5v-1Z" />
  </svg>
);

/** Перезаполнить по основанию — круговая стрелка (в один штрих, как соседи в ряду поля). */
export const SyncFromBasisIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3.96 6.53A4.3 4.3 0 1 1 9.47 3.96L9.13 4.9A3.3 3.3 0 1 0 4.9 6.87Z" />
    <path d="M8.6 2.2 11.2 4.2 8.4 5.6Z" />
  </svg>
);

// ── Реестр + универсальный <Icon name="…" /> ─────────────────────────────

/** Удалить — корзина: крышка, ручка, корпус-кольцо и прорези. */
export const TrashIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2.5 4h11v1h-11V4Z" />
    <path d="M6.5 2h3v2h-1V3h-1v1h-1V2Z" />
    <path d="M4 5.5h8l-.75 8.5H4.75L4 5.5Zm1.1 1 .57 6.5h4.66l.57-6.5H5.1Z" />
    <path d="M6.7 7.4h.9v4.6h-.9V7.4Zm1.7 0h.9v4.6h-.9V7.4Z" />
  </svg>
);

/** Ссылка — звенья цепи. */
export const LinkIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M5.2 8a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm0 1a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z" />
    <path d="M10.8 2.4a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm0 1a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z" />
    <path d="M6.62 10.22 10.22 6.62 9.38 5.78 5.78 9.38Z" />
  </svg>
);

/** Скачать — стрелка вниз над лотком. */
export const DownloadIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M7.4 2.5h1.2v5.3H7.4V2.5Z" />
    <path d="M5 7.2h6L8 11Z" />
    <path d="M3 12.4h10v1.2H3v-1.2Z" />
  </svg>
);

/** Серийные номера — знак «решётка»: две наклонные и две горизонтали. */
export const SerialIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M5.65 2.66 6.85 2.83 5.35 13.34 4.15 13.17Z" />
    <path d="M10.65 2.66 11.85 2.83 10.35 13.34 9.15 13.17Z" />
    <path d="M3.2 5.8h9.8v1.2H3.2V5.8Z" />
    <path d="M3 9.3h9.8v1.2H3V9.3Z" />
  </svg>
);

/** Партия — коробка: контур короба и рёбра. */
export const BatchIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M8 2.2 13.6 5.2v5.6L8 13.8 2.4 10.8V5.2L8 2.2Zm0 1.14L3.4 5.8v4.4L8 12.66 12.6 10.2V5.8L8 3.34Z" />
    <path d="m2.65 5.3.5-.9L8 7.43l4.85-3.03.5.9L8.5 8.4v5.3h-1V8.4Z" />
  </svg>
);

/** Заметка — лист с загнутым уголком и строками. */
export const NoteIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M3.5 2h6l3 3v9h-9V2Zm1 1v10h7V5.5H9V3H4.5Z" />
    <path d="M5.5 8h5v1h-5V8Zm0 2.4h3.5v1H5.5v-1Z" />
  </svg>
);

/** Область справа — рамка экрана с залитой правой долей. */
export const DockRightIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2 3h12v10H2V3Zm1 1v8h10V4H3Z" />
    <path d="M10 4.5h3.2v7H10v-7Z" />
  </svg>
);

/** Область внизу — та же рамка, залита нижняя доля. */
export const DockBottomIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2 3h12v10H2V3Zm1 1v8h10V4H3Z" />
    <path d="M3.2 9.5h9.6v2.7H3.2V9.5Z" />
  </svg>
);

export const ICONS = {
  recalc: RecalcIcon,
  note: NoteIcon,
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
  tree: TreeIcon,
  viewSplit: ViewSplitIcon,
  dockRight: DockRightIcon,
  dockBottom: DockBottomIcon,
  viewSingle: ViewSingleIcon,
  documentChain: DocumentChainIcon,
  document: DocumentIcon,
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
