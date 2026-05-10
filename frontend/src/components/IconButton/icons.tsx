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

/** Открыть список (multi-line list). */
export const ListIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M2.5 4h11" />
    <path d="M2.5 8h11" />
    <path d="M2.5 12h11" />
  </svg>
);

/** Открыть элемент в новом окне/панели (rect + arrow «open in new»). */
export const OpenIcon: FC<SvgProps> = (props) => (
  <svg {...baseProps} {...props}>
    {/* Прямоугольник с отсутствующим правым-верхним углом */}
    <path d="M8 2.5H3.5a1 1 0 0 0-1 1V12.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8" />
    {/* Стрелка наружу */}
    <path d="M9.5 2.5h4v4" strokeWidth={1.6} />
    <path d="M13.5 2.5l-6 6" strokeWidth={1.6} />
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

// ── Реестр + универсальный <Icon name="…" /> ─────────────────────────────

export const ICONS = {
  recalc: RecalcIcon,
  settings: SettingsIcon,
  reload: ReloadIcon,
  search: SearchIcon,
  calendar: CalendarIcon,
  editInline: EditInlineIcon,
  makePrimary: MakePrimaryIcon,
  close: CloseIcon,
  clear: ClearIcon,
  quickselect: QuickSelectIcon,
  list: ListIcon,
  open: OpenIcon,
  print: PrintIcon,
  posted: PostedIcon,
  notPosted: NotPostedIcon,
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps extends SvgProps {
  name: IconName;
}

export const Icon: FC<IconProps> = ({ name, ...rest }) => {
  const Cmp = ICONS[name];
  return <Cmp {...rest} />;
};
