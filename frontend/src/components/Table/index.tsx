import styles from './Table.module.scss';
import { TableConfigModalForm } from './TableConfigModalForm';
import { DateRangeBar, FieldDateRangeModal, FieldFastSearchInternal } from './TableToolbarControls';
import { TableArea } from './TableArea';
import { ROW_HEIGHT } from './constants';

import {
  TColumn,
  TDataItem,
  TypeFormAction,
} from './types';
import { pruneSelection, isNarrowedView, toggleRowSelection, type SelectionState } from './services';

import { translate } from 'src/i18';
import {
  CHECKBOX_COL_ID,
  computeNextActiveColId,
  computeNextActiveRowId,
  getCellNavDirection,
  getTableNavDirection,
} from './tableKeyboardNav';

import { Button } from '../Button';
import { LoadingSpinner } from '../UI';
import Toolbar from 'src/components/Toolbar';

// dnd-kit / PiDots переехали в ./TableConfigColumns вместе с компонентами настройки.


import {
  Dispatch,
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  memo,
  Ref,
  SetStateAction,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  TableContextProvider,
  useTableContext, useTableVolatile,
  type TableContextProps, type TableVolatileState,
  type TTableVariant, type TOpenModelFormProps,
} from './context';

// Ре-экспорт публичной поверхности контекста (внешние импортируют из этого модуля,
// напр. PrimaryToolbarButton / TradeDocumentItemsTable — пути не меняются).
export { useTableContext, useTableVolatile };
export type { TableContextProps, TableVolatileState, TTableVariant, TOpenModelFormProps };
export type TypeModelProps = TableContextProps;


// ────────────────────────────────────────────────
// TableProps
// ────────────────────────────────────────────────

export interface TableProps {
  variant?: TTableVariant;
  /** false — скрыть колонку чекбоксов выбора строк. По умолчанию true. */
  selectable?: boolean;
  /** Отметки видны, но недоступны (см. context.selectionLocked). */
  selectionLocked?: boolean;
  onSelectItem?: (item: TDataItem) => void;
  enableDateRange?: boolean;
  componentName: string;
  rows: TDataItem[];
  columns: TColumn[];
  total: number;
  totalPages: number;
  isLoading: boolean;
  error: Error | null;
  pagination: TableContextProps['pagination'];
  sorting: TableContextProps['sorting'];
  filtering: TableContextProps['filtering'];
  search: TableContextProps['search'];
  actions: TableContextProps['actions'];
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  extraButtons?: React.ReactNode;
  /** Удаление выбранных строк. Может вернуть набор РЕАЛЬНО удалённых id —
   *  таблица сдвигает activeRow и снимает выделение только с них (неудалённые,
   *  напр. документ-основание с 409, остаются активными/выделенными). */
  onDelete?: (selectedRows: Set<number>, rows: TDataItem[]) => void | Promise<{ deletedIds?: Set<number> } | void>;
  /**
   * Отметки строк наружу. Раньше выделение было доступно только внутри onDelete —
   * то есть годилось лишь для удаления. Групповым операциям над выбранными строками
   * (напр. установка расширения в отмеченные базы) нужен сам набор.
   */
  onSelectionChange?: (selectedRows: Set<number>, rows: TDataItem[]) => void;
  /**
   * Начальные отметки строк — когда галочка означает СОСТОЯНИЕ данных, а не выбор
   * пользователя (право включено, база опубликована). Применяются при смене этого
   * набора, а не на каждый рендер: иначе отметка возвращалась бы обратно сразу после
   * щелчка, и снять её было бы невозможно.
   */
  presetSelectedRows?: Set<number>;
  /**
   * Ячейки переносят текст и тянутся под содержимое (до восьми строк).
   *
   * Для таблиц, где содержимое ячейки — ПРЕДЛОЖЕНИЕ, а не значение: текст технического
   * сообщения, ответ агента, причина отказа. Вместе с переносом выключается
   * виртуализация — она считает положение строки как index × ROW_HEIGHT и верит, что все
   * строки одной высоты. Поэтому перенос включают только там, где список заведомо
   * короткий и читаемый, а не листаемый.
   */
  wrapCells?: boolean;
  // ── Inline-редактирование ──────────────────────────────────────────────
  inlineEditing?: boolean;
  renderCell?: (row: TDataItem, col: TColumn) => React.ReactNode | undefined;
  onInlineAdd?: () => void;
  /**
   * Метаданные ячейки (ошибка / обязательное пустое) — передаются в
   * CellFieldStateScope, откуда Field-компоненты читают через useCellFieldState.
   * errorTooltip — визуальный узел ошибки, рендерящийся рядом с контентом.
   */
  getCellMeta?: (row: TDataItem, col: TColumn) => { required?: boolean; error?: boolean; errorMessage?: string; errorTooltip?: React.ReactNode } | null;
  /** Если true — скрыть кнопки «Добавить»/«Удалить» (режим только чтение по правам доступа) */
  readonly?: boolean;
  /** Если true — кнопка «Добавить» отображается как disabled */
  disableAdd?: boolean;
  /** Если true — скрыть кнопки «Добавить»/«Удалить», НЕ отключая inline-редактирование. */
  hideAddDelete?: boolean;
  /** Если true — скрыть ТОЛЬКО «Добавить» (удаление остаётся). Для журналов: записи
   *  порождаются системой, а не пользователем, но админ может их чистить. */
  hideAdd?: boolean;
  /** Если true — скрыть кнопку «Обновить» в тулбаре (когда перезагрузка с сервера не нужна). */
  hideReload?: boolean;
  /** Подпись кнопки «Обновить»: откуда именно она перечитывает данные. */
  reloadTitle?: string;
  /** Идёт обновление: крутится кнопка, таблица продолжает показывать прежние данные. */
  reloading?: boolean;
  /** Если true — НЕ рендерить панель управления (TableControlPanel) вовсе. Для
   *  пейнов, где тулбар вынесен на уровень панели (usePaneToolbar). По умолчанию
   *  false — на все существующие таблицы не влияет (референс pane-toolbar). */
  hideToolbar?: boolean;
  /** Раскрытые строки (expand) */
  expandedRowIds?: Set<string>;
  /** Рендер содержимого раскрытой строки */
  renderExpandedRow?: (row: TDataItem) => React.ReactNode;
  /** Строки-потомки раскрытой строки: рисуются тем же TableBodyRow (см. context.tsx). */
  childRows?: (row: TDataItem) => TDataItem[];
  onChildToggle?: (parent: TDataItem, child: TDataItem, next: boolean) => void;
  /** Раскрыть/свернуть строку — шеврон в ячейке группы (activeRow для этого НЕ используется). */
  onToggleExpand?: (row: TDataItem) => void;
  /**
   * Отключить активную строку целиком: щелчок не делает строку активной, подсветки и
   * перехода по строкам нет. Нужно там, где строка — не «текущая запись», а набор
   * отметок и раскрытий: активная строка там ничего не значит, но спорит с подсветкой
   * группы и уводит фокус.
   */
  disableActiveRow?: boolean;
  /** Что написать вместо пустой таблицы (см. context.emptyText). */
  emptyText?: string;
  /**
   * Активная строка сменилась — ОДИНОЧНЫЙ клик (и стрелки клавиатуры).
   *
   * Двойной клик уже занят открытием элемента (`onSelectItem`/`openModelForm`), и
   * связанные списки на нём делать нельзя: чтобы увидеть содержимое строки, пришлось бы
   * открывать форму. Одиночный клик — это «покажи, что с этим связано», без перехода.
   */
  onActiveRowChange?: (row: TDataItem | null) => void;
  /** Императивный ref для внешнего управления таблицей (activeRow, focus). */
  apiRef?: Ref<TableApi>;
  /** uuid строки для подсветки + центрирования («Показать в журнале»). */
  highlightUuid?: string;
  /** Нонс запроса подсветки: меняется при КАЖДОМ запросе, даже если uuid тот же
   *  (чтобы повторное «Показать в списке» снова центрировало строку). */
  highlightToken?: number;
}

/**
 * Императивный API таблицы — позволяет внешним обёрткам (напр. SubTable)
 * управлять activeRow без перевода фокуса на ячейки/поля.
 */
export interface TableApi {
  getActiveRow: () => number | null;
  setActiveRow: (id: number | null) => void;
  /** Идентификатор активной колонки (cell-level выделение) или null. */
  getActiveCell: () => string | null;
  setActiveCell: (identifier: string | null) => void;
  /** Передать фокус на скролл-контейнер таблицы (чтобы клавиатура работала без выбора ячейки). */
  focusContainer: () => void;
  /** Получить скролл-контейнер (для поиска DOM-элементов строк). */
  getScrollContainer: () => HTMLDivElement | null;
}

// ────────────────────────────────────────────────
// TableControlPanel - мемоизированная панель управления
// ────────────────────────────────────────────────

interface TableControlPanelProps {
  variant: TTableVariant;
  showDateRangeButton: boolean;
  isLoading: boolean;
  visibleDateRange: boolean;
  visibleFastSearch: boolean;
  onConfigOpen: () => void;
  onDateRangeToggle: () => void;
  onSearchToggle: () => void;
  /** Может вернуть промис — тогда «Обновить» крутится, пока он не завершится. */
  onRefresh: () => void | Promise<void>;
  onAddClick: () => void;
  onDeleteClick: () => void;
  /** Есть ли выбранные/выделенные строки — от этого зависит доступность кнопки «Удалить». */
  hasSelection: boolean;
  search: { value: string; onChange: (value: string) => void };
  extraButtons?: React.ReactNode;
  /** Если true — скрыть кнопки «Добавить»/«Удалить» (режим только чтение) */
  readonly?: boolean;
  /** Если true — кнопка «Добавить» отображается как disabled */
  disableAdd?: boolean;
  /** Если true — скрыть кнопки «Добавить»/«Удалить» (inline-редактирование сохраняется). */
  hideAddDelete?: boolean;
  /** Если true — скрыть ТОЛЬКО «Добавить» (удаление остаётся). */
  hideAdd?: boolean;
  /** Если true — скрыть кнопку «Обновить». */
  hideReload?: boolean;
  /** Подпись кнопки «Обновить»: экрану бывает важно сказать, ОТКУДА она перечитывает. */
  reloadTitle?: string;
  /**
   * Идёт обновление: крутим кнопку, но НЕ блокируем таблицу.
   *
   * Обновление содержимого базы у 1С занимает десятки секунд. Гасить на это время всю
   * таблицу неправильно: прежние данные никуда не делись, их можно читать, сортировать и
   * искать по ним — а человек вместо этого смотрел на пустой прямоугольник. Индикатор —
   * там, где нажали: на кнопке. Данные заменяются, когда придут.
   */
  reloading?: boolean;
  /** Если true — скрыть кнопку «Удалить» (удаление недоступно) */
  canDelete?: boolean;
  componentName?: string;
}

const TableControlPanel = memo(({
  variant,
  showDateRangeButton,
  isLoading,
  visibleDateRange,
  visibleFastSearch,
  onConfigOpen,
  onDateRangeToggle,
  onSearchToggle,
  onRefresh,
  onAddClick,
  onDeleteClick,
  hasSelection,
  search,
  extraButtons,
  readonly: isReadonly = false,
  disableAdd = false,
  hideAddDelete = false,
  hideAdd = false,
  hideReload = false,
  reloadTitle,
  reloading = false,
  canDelete = true,
  componentName,
}: TableControlPanelProps) => {
  /*
   * ВРАЩЕНИЕ «ОБНОВИТЬ» — ОТ НАЖАТИЯ И ДО КОНЦА ЗАПРОСА. Без нажатия не крутим: у таблиц с фоновым опросом (задания,
   * прогресс) загрузка идёт раз в несколько секунд, и иконка крутилась бы без остановки. Нажали — крутим не меньше
   * 700 мс и дальше, пока не завершится операция: промис, который вернул onRefresh, и признак загрузки таблицы
   * (isLoading/reloading). Потолка по времени нет: команда 1С идёт минутами, и остановка раньше конца врёт.
   */
  const [spinClick, setSpinClick] = useState(0);
  const [spinHold, setSpinHold] = useState(false);
  const [spinPending, setSpinPending] = useState(false);
  const busy = !!isLoading || reloading;
  useEffect(() => {
    if (!spinClick) return;
    setSpinHold(true);
    const hold = setTimeout(() => setSpinHold(false), 700);
    return () => clearTimeout(hold);
  }, [spinClick]);
  useEffect(() => {
    if (spinClick && !spinHold && !spinPending && !busy) setSpinClick(0);
  }, [spinClick, spinHold, spinPending, busy]);
  const spinClickRef = useRef(0);
  const handleReloadClick = () => {
    const click = Date.now();
    spinClickRef.current = click;
    setSpinClick(click);
    const result = onRefresh();
    if (result instanceof Promise) {
      setSpinPending(true);
      // Промис прежнего нажатия не гасит вращение нового.
      void result.catch(() => { }).finally(() => {
        if (spinClickRef.current === click) setSpinPending(false);
      });
    } else {
      setSpinPending(false);
    }
  };
  /*
   * И БЕЗ НАЖАТИЯ — ПОКА ЭКРАН ГОВОРИТ «РАБОТА ИДЁТ» (`reloading`). Так вращение переживает перезагрузку страницы:
   * работа, начатая до неё, поднимается в реестр, и экран передаёт её сюда. Экраны с фоновым опросом (задания,
   * прогресс, процессы) `reloading` от опроса не передают — иначе иконка крутилась бы без остановки.
   */
  const spinning = reloading || (spinClick > 0 && (spinHold || spinPending || busy));
  const isSelect = variant === 'select';
  const hideWrite = isSelect || isReadonly || hideAddDelete;
  return (
    <Toolbar
      right={visibleFastSearch ? <FieldFastSearchInternal value={search.value} onChange={search.onChange} /> : undefined}
    >
      {!hideWrite && !hideAdd && <Button onClick={onAddClick} disabled={isLoading || disableAdd} title={disableAdd ? translate("allModelsAssigned") : undefined}><span>{translate("add")}</span></Button>}
      {!hideWrite && <Button onClick={canDelete ? onDeleteClick : undefined} disabled={isLoading || !hasSelection || !canDelete} title={!hasSelection ? translate("selectRowsFirst") : undefined}><span>{translate("delete")}</span></Button>}
      {extraButtons && (
        <>
          {/* <Toolbar.Divider /> */}
          {extraButtons}
        </>
      )}
      {showDateRangeButton && (
        <>
          <Toolbar.Divider />
          <Toolbar.PeriodButton onClick={onDateRangeToggle} active={visibleDateRange} />
          {/* Переключатель вида списка (список / split-предпросмотр), персист per-list.
              Раскладку рендерит ModelList — она слушает CustomEvent "listLayoutToggle". */}
          {componentName && (
            <Toolbar.ToggleSplit
              pressed={(localStorage.getItem(`listPaneLayout:${componentName}`) || 'list') === 'split'}
              onClick={() => {
                const key = `listPaneLayout:${componentName}`;
                const next = (localStorage.getItem(key) || 'list') === 'split' ? 'list' : 'split';
                localStorage.setItem(key, next);
                window.dispatchEvent(new CustomEvent('listLayoutToggle', { detail: componentName }));
              }}
            />
          )}
        </>
      )}
      {!isSelect && <Toolbar.Divider />}
      {!hideReload && (
        <Toolbar.ReloadButton
          onClick={handleReloadClick}
          disabled={isLoading || reloading}
          loading={spinning}
          title={reloadTitle}
        />
      )}
      <Toolbar.SettingsButton onClick={onConfigOpen} />
      <Toolbar.SearchButton onClick={onSearchToggle} active={visibleFastSearch} />
      {/* <Toolbar.Divider /> */}
    </Toolbar>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.variant === nextProps.variant &&
    prevProps.showDateRangeButton === nextProps.showDateRangeButton &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.visibleDateRange === nextProps.visibleDateRange &&
    prevProps.visibleFastSearch === nextProps.visibleFastSearch &&
    prevProps.search === nextProps.search &&
    prevProps.extraButtons === nextProps.extraButtons &&
    prevProps.onDeleteClick === nextProps.onDeleteClick &&
    prevProps.onAddClick === nextProps.onAddClick &&
    prevProps.onRefresh === nextProps.onRefresh &&
    prevProps.hasSelection === nextProps.hasSelection &&
    prevProps.readonly === nextProps.readonly &&
    prevProps.disableAdd === nextProps.disableAdd &&
    prevProps.hideAddDelete === nextProps.hideAddDelete &&
    prevProps.hideAdd === nextProps.hideAdd &&
    prevProps.hideReload === nextProps.hideReload &&
    prevProps.reloadTitle === nextProps.reloadTitle &&
    prevProps.reloading === nextProps.reloading &&
    prevProps.canDelete === nextProps.canDelete
  );
});

TableControlPanel.displayName = 'TableControlPanel';

// ────────────────────────────────────────────────
// Table
// ────────────────────────────────────────────────

const Table: FC<TableProps> = memo((props) => {
  const {
    variant = 'default',
    selectable = true,
    selectionLocked = false,
    onSelectItem,
    onSelectionChange,
    presetSelectedRows,
    wrapCells,
    enableDateRange = true,
    componentName, rows, columns, total, totalPages,
    isLoading, error,
    pagination, sorting, filtering, search, actions,
    hasNextPage, isFetchingNextPage,
    extraButtons,
    onDelete,
    inlineEditing,
    renderCell,
    onInlineAdd,
    getCellMeta,
    readonly: isReadonly = false,
    disableAdd = false,
    hideAddDelete = false,
    hideAdd = false,
    hideReload = false,
    reloadTitle,
    reloading = false,
    hideToolbar = false,
    expandedRowIds,
    renderExpandedRow,
    childRows,
    onChildToggle,
    onToggleExpand,
    disableActiveRow = false,
    emptyText,
    onActiveRowChange,
    apiRef,
    highlightUuid,
    highlightToken,
  } = props;


  const { openModelForm, refetch } = actions;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Refs для inline-editing: не участвуют в contextValue, не триггерят ререндер ──
  const renderCellRef = useRef(renderCell);
  renderCellRef.current = renderCell;
  const inlineEditingRef = useRef(inlineEditing);
  inlineEditingRef.current = inlineEditing;
  const getCellMetaRef = useRef(getCellMeta);
  getCellMetaRef.current = getCellMeta;

  const [activeRow, setActiveRowState] = useState<number | null>(null);
  // Единственная точка, через которую строка становится активной: при отключённой
  // активной строке она просто ничего не делает, и остальному коду об этом знать не нужно.
  const setActiveRow = useCallback<Dispatch<SetStateAction<number | null>>>(
    (value) => { if (!disableActiveRow) setActiveRowState(value); },
    [disableActiveRow],
  );
  const [activeCell, setActiveCell] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isAllSelectedMode, setIsAllSelectedMode] = useState<boolean>(false);
  // Уведомляем владельца об изменении отметок. Через ref, чтобы нестабильный колбэк
  // из родителя не перезапускал эффект на каждый рендер.
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  // Пересев отметок: только когда пришёл ДРУГОЙ набор (сравниваем по составу, а не по
  // ссылке — родитель пересобирает Set на каждый рендер).
  //
  // Пересев делается В РЕНДЕРЕ, а не в эффекте, и это принципиально: уведомление об
  // отметках (onSelectionChange ниже) — тоже эффект, и в первом же коммите он успевал
  // сработать с ПУСТЫМ набором, то есть сообщал родителю «снято всё» ещё до того, как
  // начальные отметки применялись. Там, где галочка означает состояние данных (роли
  // пользователя в базе), это превращалось в мнимую правку «снять все роли».
  const presetKey = presetSelectedRows ? [...presetSelectedRows].sort((a, b) => a - b).join(",") : null;
  const [appliedPresetKey, setAppliedPresetKey] = useState<string | null>(null);
  if (presetKey !== null && presetKey !== appliedPresetKey) {
    setAppliedPresetKey(presetKey);
    setSelectedRows(new Set(presetKey ? presetKey.split(",").map(Number) : []));
  }

  /*
   * Текущие отметки и «сужен ли список» — в ref: колбэк отметки строки (toggleRowSelect)
   * должен быть СТАБИЛЬНЫМ, иначе смена выбора перерисовывала бы все строки в обход memo,
   * но правила выбора (services) считаются по актуальному набору.
   */
  const selectionRef = useRef<SelectionState>({ selected: selectedRows, allMode: isAllSelectedMode, excluded: excludedRows });
  selectionRef.current = { selected: selectedRows, allMode: isAllSelectedMode, excluded: excludedRows };
  const narrowedRef = useRef(false);
  narrowedRef.current = isNarrowedView(search.value, filtering.filters);
  const visibleIdsRef = useRef<number[]>([]);
  visibleIdsRef.current = rows.map((r) => Number(r.id));

  /*
   * Список СУЗИЛСЯ (быстрый поиск, отбор), а включён режим «выбраны все» — переводим режим в явный
   * список отметок по тому составу, который был виден до сужения.
   *
   * Иначе выбор молча схлопывался бы до найденного: наружу (onSelectionChange) уходят «все строки за
   * вычетом исключённых», а строки при поиске — только найденные. Перевод делаем лишь когда весь
   * список уже загружен (нет следующей страницы): у серверного списка «выбраны все» значит «все в
   * базе», и перечислить их панель не может.
   */
  const fullRowIdsRef = useRef<number[]>([]);
  if (!narrowedRef.current) fullRowIdsRef.current = visibleIdsRef.current;
  const wasNarrowedRef = useRef(narrowedRef.current);
  const narrowed = narrowedRef.current;
  useEffect(() => {
    const wasNarrowed = wasNarrowedRef.current;
    wasNarrowedRef.current = narrowed;
    if (!narrowed || wasNarrowed || !isAllSelectedMode || hasNextPage) return;
    setSelectedRows(new Set(fullRowIdsRef.current.filter((id) => !excludedRows.has(id))));
    setIsAllSelectedMode(false);
    setExcludedRows(new Set());
  }, [narrowed, isAllSelectedMode, excludedRows, hasNextPage]);

  const toggleRowSelect = useCallback((id: number, checked: boolean) => {
    const next = toggleRowSelection(selectionRef.current, id, checked, visibleIdsRef.current, narrowedRef.current);
    setIsAllSelectedMode(next.allMode);
    setSelectedRows(next.selected);
    setExcludedRows(next.excluded);
  }, []);

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    const notify = onSelectionChangeRef.current;
    if (!notify) return;
    // В режиме «выбраны все» selectedRows намеренно ПУСТ (иначе пришлось бы держать в нём
    // весь список), а фактический выбор — это все строки за вычетом исключённых. Без этого
    // «отметить всё» отдавало бы наружу пустой набор.
    const effective = isAllSelectedMode
      ? new Set(rows.map((r) => Number(r.id)).filter((id) => !excludedRows.has(id)))
      : selectedRows;
    notify(effective, rows);
    // rows намеренно вне зависимостей: сообщаем именно о СМЕНЕ ОТМЕТОК, а не о
    // каждой перезагрузке данных.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRows, isAllSelectedMode, excludedRows]);
  const [configModalAction, setConfigModalAction] = useState<TypeFormAction>('');
  const [dateRangeModalAction, setDateRangeModalAction] = useState<TypeFormAction>('');
  const [visibleFastSearch, setVisibleFastSearch] = useState(false);

  // ── Авто-активация первой строки и клавиатурная навигация (режим выбора) ──
  // Stable refs для использования в эффектах без лишних пересозданий
  const activeRowRef = useRef(activeRow);
  activeRowRef.current = activeRow;
  // Текущие строки в ref — чтобы центрирование по индексу не зависело от
  // виртуализации (искомая строка может быть НЕ отрисована в DOM).
  const rowsForCenterRef = useRef(rows);
  rowsForCenterRef.current = rows;
  const activeCellRef = useRef(activeCell);
  activeCellRef.current = activeCell;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onSelectItemRef = useRef(onSelectItem);
  onSelectItemRef.current = onSelectItem;

  // Сообщаем наружу о смене активной строки. Через ref: колбэк меняется на каждый рендер
  // родителя, а подписка на него не должна перезапускать эффект.
  const onActiveRowChangeRef = useRef(onActiveRowChange);
  onActiveRowChangeRef.current = onActiveRowChange;
  const rowsForActiveRef = useRef(rows);
  rowsForActiveRef.current = rows;
  useEffect(() => {
    const notify = onActiveRowChangeRef.current;
    if (!notify) return;
    notify(activeRow === null ? null : (rowsForActiveRef.current.find((r) => r.id === activeRow) ?? null));
  }, [activeRow]);

  // Автоматически активировать первую строку когда есть onSelectItem и загрузились данные
  useEffect(() => {
    if (!onSelectItem || rows.length === 0) return;
    setActiveRow((prev: number | null): number | null => {
      // Остаёмся на текущей строке если она ещё видна; иначе переходим на первую
      const stillVisible = prev !== null && rows.some(r => r.id === prev);
      return stillVisible ? prev : (rows[0].id);
    });
  }, [onSelectItem, rows]);

  // Центрирование активной строки по вертикали скролла таблицы. Таблица
  // ВИРТУАЛИЗИРОВАНА — строка вне видимой области не отрисована в DOM, поэтому
  // считаем позицию по ИНДЕКСУ строки (index × ROW_HEIGHT), а не по DOM-элементу.
  // Ждём, пока контейнер видим (clientHeight>0): при открытии из скрытой панели
  // высота появляется не сразу — делаем несколько кадров попыток.
  const centerActiveRow = useCallback(() => {
    const id = activeRowRef.current;
    if (id === null) return;
    const idx = rowsForCenterRef.current.findIndex((r) => r.id === id);
    if (idx < 0) return;
    let tries = 0;
    const tick = () => {
      const c = scrollRef.current;
      if (c && c.clientHeight > 0) {
        const target = idx * ROW_HEIGHT - (c.clientHeight - ROW_HEIGHT) / 2;
        c.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        return;
      }
      if (tries++ < 30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  // Прокрутка к активной строке при изменении activeRow.
  //  • обычная навигация (стрелки) — минимальный сдвиг (block: nearest);
  //  • подсветка (highlight) — ЦЕНТРИРОВАНИЕ (флаг centerNextScrollRef).
  const centerNextScrollRef = useRef(false);
  useEffect(() => {
    const c = scrollRef.current;
    if (activeRow === null || !c) return;
    if (centerNextScrollRef.current) {
      centerNextScrollRef.current = false;
      centerActiveRow();
      return;
    }
    const el = c.querySelector<HTMLElement>('[data-active="true"]');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeRow, centerActiveRow]);

  // Подсветка строки документа по uuid («Показать в списке» / после «Сохранить
  // и закрыть»): ВСЕГДА выставляем activeRow на найденную строку и центрируем.
  // Если строки ещё нет (пагинация) — догружаем страницы, пока не найдём.
  const highlightDoneRef = useRef(false);
  const highlightTriesRef = useRef(0);
  useEffect(() => { highlightDoneRef.current = false; highlightTriesRef.current = 0; }, [highlightUuid, highlightToken]);
  useEffect(() => {
    if (!highlightUuid || highlightDoneRef.current) return;
    const row = rows.find(r => r.uuid === highlightUuid);
    if (row) {
      highlightDoneRef.current = true;
      if (activeRowRef.current === row.id) {
        // Строка уже активна (setActiveRow не вызовет ре-рендер) — центрируем явно.
        centerActiveRow();
      } else {
        centerNextScrollRef.current = true; // отцентрировать после установки activeRow
        setActiveRow(row.id);
      }
    } else if (hasNextPage && !isFetchingNextPage && highlightTriesRef.current < 50) {
      highlightTriesRef.current += 1;
      actions.fetchNextPage?.();
    }
  }, [highlightUuid, highlightToken, rows, hasNextPage, isFetchingNextPage, actions, centerActiveRow]);

  // Сбрасываем activeCell, когда снимается activeRow (нет смысла подсвечивать
  // ячейку без активной строки).
  useEffect(() => {
    if (activeRow === null && activeCell !== null) setActiveCell(null);
  }, [activeRow, activeCell]);

  // Императивный API для внешних оберток (SubTable и т.п.)
  useImperativeHandle(
    apiRef,
    () => ({
      getActiveRow: () => activeRowRef.current,
      setActiveRow: (id) => setActiveRow(id),
      getActiveCell: () => activeCellRef.current,
      setActiveCell: (identifier) => setActiveCell(identifier),
      focusContainer: () => scrollRef.current?.focus(),
      getScrollContainer: () => scrollRef.current,
    }),
    [],
  );

  // Клавиатурная навигация: ↑ / ↓ / Enter — только когда открыт список для выбора
  useEffect(() => {
    if (!onSelectItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentRows = rowsRef.current;
      if (currentRows.length === 0) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        const currentActive = activeRowRef.current;
        const row = currentRows.find(r => r.id === currentActive);
        if (row) onSelectItemRef.current?.(row);
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveRow((prev: number | null): number | null => {
          const idx = prev !== null ? currentRows.findIndex(r => r.id === prev) : -1;
          if (e.key === 'ArrowDown') {
            return currentRows[Math.min(Math.max(idx + 1, 0), currentRows.length - 1)].id;
          } else {
            return currentRows[Math.max(idx <= 0 ? 0 : idx - 1, 0)].id;
          }
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectItem]);

  // Текущие значения dateRange из фильтров
  const dateRangeFilter = filtering.filters?.dateRange as { startDate?: string; endDate?: string } | undefined;
  const currentStartDate = dateRangeFilter?.startDate || '';
  const currentEndDate = dateRangeFilter?.endDate || '';
  const hasDateRange = !!(currentStartDate || currentEndDate);
  const showDateRangeButton = useMemo(
    () => enableDateRange && columns.some((column) => column.visible && (column.type === 'date' || column.type === 'datetime')),
    [enableDateRange, columns],
  );

  // extendedActions уже включают setAdaptiveLimit от родителя
  const extendedActions = useMemo(
    () => ({
      ...actions,
    }),
    [actions]
  );

  /**
   * Отметки групповой таблицы — по её ДАННЫМ, а не по selectedRows.
   *
   * У группы отметка означает «отмечены все вложенные» (см. TableBodyRow), поэтому и
   * заголовочный чекбокс обязан считать так же — иначе он навсегда остаётся неактивным:
   * выбирать в обычном смысле в такой таблице нечего.
   */
  const groupSelection = useMemo(() => {
    if (!childRows || !onChildToggle) return null;
    let total = 0;
    let selected = 0;
    for (const row of rows) {
      for (const child of childRows(row)) {
        /*
         * СЧИТАЕМ ТОЛЬКО ТО, ЧТО МОЖНО ОТМЕТИТЬ.
         *
         * Потомок без `__selected` — поясняющая строка: чекбокса у неё нет (см.
         * TableBodyRow), отметить её нельзя. Пока такие строки попадали в знаменатель,
         * «отмечено всё» было недостижимо: заголовочный чекбокс навсегда застревал в
         * промежуточном состоянии и на каждое нажатие снова отмечал всё вместо того, чтобы
         * снять. Живой случай — «Задания»: у базы, для которой команда даже не создалась
         * (отсеяли на постановке), отмечать нечего, а весь чекбокс из-за неё не работал.
         */
        if (child.__selected === undefined) continue;
        total += 1;
        if (child.__selected === true) selected += 1;
      }
    }
    if (!total) return null;
    return {
      all: selected === total,
      some: selected > 0 && selected < total,
      toggleAll: (next: boolean) => {
        for (const row of rows) {
          for (const child of childRows(row)) {
            if (child.__selected === undefined) continue;
            if ((child.__selected === true) !== next) onChildToggle(row, child, next);
          }
        }
      },
    };
  }, [childRows, onChildToggle, rows]);

  const contextValue = useMemo<TableContextProps>(
    () => ({
      variant, selectable, selectionLocked, onSelectItem,
      componentName, rows, deferredRowsForRender: rows, columns, total, totalPages,
      isLoading, error,
      pagination, sorting, filtering, search,
      actions: extendedActions,
      hasNextPage, isFetchingNextPage,
      inlineEditing, renderCell, onInlineAdd,
      canDelete: !!onDelete,
      // Групповая таблица тоже «умеет выбирать» — своими отметками (см. groupSelection).
      canSelect: !!onDelete || !!onSelectionChange || !!groupSelection,
      groupSelection,
      wrapCells,
      renderCellRef, inlineEditingRef, getCellMetaRef,
      scrollRef,
      expandedRowIds,
      renderExpandedRow,
      childRows,
      onChildToggle,
      onToggleExpand,
      disableActiveRow,
      emptyText,
      // Только сеттеры — стабильны, поэтому contextValue НЕ меняется при навигации.
      states: {
        toggleRowSelect,
        setSelectedRows,
        setIsAllSelectedMode,
        setExcludedRows,
        setActiveRow,
        setActiveCell,
      },
    }),
    [
      variant, selectable, selectionLocked, onSelectItem,
      componentName, rows, columns, total, totalPages,
      isLoading, error,
      pagination, sorting, filtering, search, extendedActions,
      hasNextPage, isFetchingNextPage,
      onInlineAdd, onDelete,
      // Раскрытие строк — часть значения контекста: без этих зависимостей раскрытие
      // обновлялось лишь попутно, когда менялись строки.
      expandedRowIds, renderExpandedRow, childRows, onChildToggle, onToggleExpand,
      disableActiveRow, emptyText, groupSelection, wrapCells,
      // сеттеры стабильны (useState) — в deps не нужны; волатильные ЗНАЧЕНИЯ ушли
      // в отдельный контекст (см. volatileValue ниже).
      toggleRowSelect,
      setSelectedRows, setIsAllSelectedMode, setExcludedRows, setActiveRow, setActiveCell,
    ]
  );

  // Высокочастотное состояние — отдельный контекст. Меняется на каждую навигацию/
  // выделение, но на него подписаны единицы (TableHeader), а не N строк.
  const volatileValue = useMemo<TableVolatileState>(
    () => ({ selectedRows, isAllSelectedMode, excludedRows, activeRow, activeCell }),
    [selectedRows, isAllSelectedMode, excludedRows, activeRow, activeCell],
  );

  const handleCreate = useCallback(() => {
    if (inlineEditing && onInlineAdd) {
      onInlineAdd();
    } else if (openModelForm) {
      openModelForm({ onSave: refetch, onClose: () => { } });
    }
  }, [inlineEditing, onInlineAdd, openModelForm, refetch]);  // onRefresh — обновляет данные.
  // isAllSelectedMode, selectedRows и excludedRows НЕ сбрасываем:
  // строки с теми же ID после перезагрузки сохранят своё состояние выделения.
  const handleRefresh = useCallback(() => refetch(), [refetch]);

  /*
   * Отметки строк, которых больше нет (удалены здесь, ушли после обновления или фильтра), снимаются: иначе
   * «выбрано N» считает призраков, а групповое действие уходит по чужим строкам с теми же id (services.pruneSelection).
   */
  useEffect(() => {
    const ids = rows.map((r) => Number(r.id));
    const nextSelected = pruneSelection(selectedRows, ids);
    if (nextSelected) setSelectedRows(nextSelected);
    const nextExcluded = pruneSelection(excludedRows, ids);
    if (nextExcluded) setExcludedRows(nextExcluded);
    // Намеренно только по смене строк: набор отметок правит сам пользователь.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const handleDeleteClick = useCallback(async () => {
    // Собираем реальный набор id выбранных строк
    let effectiveIds: Set<number>;
    if (isAllSelectedMode) {
      // Все строки выбраны, кроме excludedRows
      effectiveIds = new Set<number>(
        rows.map(r => r.id).filter(id => !excludedRows.has(id)),
      );
    } else {
      // ТОЛЬКО ОТМЕЧЕННОЕ ЧЕКБОКСОМ. Активная строка — это «где я сейчас», а не «что я выбрал»: она переезжает
      // от стрелок и от клика по любой ячейке, и удалять по ней значило удалять то, чего человек не выбирал.
      effectiveIds = selectedRows;
    }

    if (effectiveIds.size === 0) return;
    if (!onDelete) { alert('Удалить выбранные'); return; }

    // Узнаём, какие строки РЕАЛЬНО удалены. Если onDelete вернул deletedIds —
    // используем их (неудалённые, напр. документ-основание → 409, останутся
    // активными/выделенными); иначе (старый контракт) считаем удалёнными все.
    const result = (await onDelete(effectiveIds, rows)) as { deletedIds?: Set<number> } | undefined;
    const deletedIds = result?.deletedIds instanceof Set ? result.deletedIds : effectiveIds;
    // Ничего не удалено (отмена/полный отказ) — состояние таблицы НЕ трогаем.
    if (deletedIds.size === 0) return;

    // activeRow сдвигаем ТОЛЬКО если активная строка действительно удалена:
    // на ближайшую НЕудалённую ниже, иначе выше, иначе null.
    let nextActiveRow: number | null = activeRow;
    if (activeRow !== null && deletedIds.has(activeRow)) {
      nextActiveRow = null;
      const idx = rows.findIndex(r => r.id === activeRow);
      if (idx !== -1) {
        for (let i = idx + 1; i < rows.length; i++) {
          if (!deletedIds.has(rows[i].id)) { nextActiveRow = rows[i].id; break; }
        }
        if (nextActiveRow === null) {
          for (let i = idx - 1; i >= 0; i--) {
            if (!deletedIds.has(rows[i].id)) { nextActiveRow = rows[i].id; break; }
          }
        }
      }
    }

    // Снимаем выделение только с УДАЛЁННЫХ строк (неудалённые остаются выбранными).
    setSelectedRows(prev => { const n = new Set(prev); for (const id of deletedIds) n.delete(id); return n; });
    setIsAllSelectedMode(false);
    setExcludedRows(new Set());
    setActiveRow(nextActiveRow);
  }, [onDelete, selectedRows, rows, isAllSelectedMode, excludedRows, activeRow, setSelectedRows, setIsAllSelectedMode, setExcludedRows, setActiveRow]);

  // ── Клавиатурная навигация по таблице (Insert / Delete / Home / End /
  // PgUp / PgDn / ArrowUp / ArrowDown) ───────────────────────────────────
  // Обрабатывает события на контейнере скролла (tabIndex={0}). Срабатывает
  // только когда фокус на самом контейнере или на не-input элементе внутри
  // (чтобы не мешать вводу). Для select-режима (onSelectItem) стрелки/Enter
  // продолжают работать через отдельный window-listener выше.
  const handleScrollKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    // Не вмешиваемся, если фокус внутри редактируемого поля
    const isEditable = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target?.isContentEditable === true);
    // Insert и Delete подчиняются ТЕМ ЖЕ запретам, что и кнопки. Раньше они шли мимо:
    // в списке, где создание и удаление скрыты как неприменимые (базы 1С заводит
    // кластер, а не панель), нажатие Delete на строке всё равно удаляло запись —
    // разрушающее действие без единой кнопки, которая бы о нём говорила.
    const canCreate = variant !== 'select' && !isReadonly && !hideAddDelete && !hideAdd;
    const canRemove = variant !== 'select' && !isReadonly && !hideAddDelete && !!onDelete;
    // Insert: создание новой строки/записи. Работает даже из input,
    // т.к. Insert обычно не используется внутри полей ввода.
    if (e.key === 'Insert') {
      if (!canCreate) return;
      e.preventDefault();
      e.stopPropagation();
      handleCreate();
      return;
    }
    if (isEditable) return;
    // Delete: удалить выбранные/активную
    if (e.key === 'Delete') {
      if (!canRemove) return;
      e.preventDefault();
      e.stopPropagation();
      void handleDeleteClick();
      return;
    }
    // ── Пробел: переключить выделение активной строки ───────────────────────
    if (e.key === ' ' && variant !== 'select' && !selectionLocked && activeCell === CHECKBOX_COL_ID && activeRow !== null) {
      e.preventDefault();
      e.stopPropagation();
      const { selected, allMode, excluded } = selectionRef.current;
      toggleRowSelect(activeRow, allMode ? excluded.has(activeRow) : !selected.has(activeRow));
      return;
    }
    // ── Enter: открыть форму активной строки ─────────────────────────────
    // Работает только в обычных списках (*List, variant === 'default').
    //  - SubTable (variant === 'embedded') обрабатывает Enter сам в capture-фазе
    //    (вход в редактирование ячейки/строки).
    //  - select-режим (onSelectItem) обрабатывает Enter через свой window-listener.
    if (
      e.key === 'Enter' &&
      variant === 'default' &&
      !onSelectItem &&
      openModelForm
    ) {
      if (activeRow === null) return;
      const row = rows.find(r => r.id === activeRow);
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      openModelForm({ data: row, onSave: refetch, onClose: () => { } });
      return;
    }
    // ── Колоночная (cell-level) навигация: ArrowLeft/ArrowRight ───────────
    // Работает во всех вариантах кроме 'select' (там горизонтальная навигация
    // не нужна — пользователь выбирает строку, не ячейку).
    const cellDir = variant !== 'select' ? getCellNavDirection(e.key) : null;
    if (cellDir) {
      // Если строк нет — просто блокируем (чтобы не ездила каретка в input,
      // но мы уже отсекли isEditable выше).
      if (rows.length === 0) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Если activeRow нет — берём первую видимую строку (как точку старта).
      const startRowId = activeRow ?? rows[0].id;
      // Вычисляем следующую колонку с учётом виртуальной колонки чекбокса.
      const visibleCols = columns.filter(c => c.visible !== false);
      let nextColId: string | null;
      if (cellDir === 'right' && activeCell === CHECKBOX_COL_ID) {
        // Вправо от чекбокса → первая колонка данных
        nextColId = visibleCols.length > 0 ? visibleCols[0].identifier : CHECKBOX_COL_ID;
      } else if (cellDir === 'left' && activeCell === CHECKBOX_COL_ID) {
        // Уже в крайней левой позиции — остаёмся
        nextColId = CHECKBOX_COL_ID;
      } else if (cellDir === 'left') {
        // Если активная — первая колонка данных, переходим к чекбоксу
        const firstVisibleId = visibleCols.length > 0 ? visibleCols[0].identifier : null;
        if (activeCell === firstVisibleId) {
          nextColId = CHECKBOX_COL_ID;
        } else {
          nextColId = computeNextActiveColId(columns, activeCell, cellDir);
        }
      } else {
        nextColId = computeNextActiveColId(columns, activeCell, cellDir);
      }
      if (nextColId === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (activeRow === null) setActiveRow(startRowId);
      setActiveCell(nextColId);
      return;
    }
    // ── Построчная навигация: ArrowUp/ArrowDown/PgUp/PgDn ──────────────
    const direction = getTableNavDirection(e.key);
    if (!direction) return;
    if (rows.length === 0) return;
    const nextId = computeNextActiveRowId(rows, activeRow, direction);
    if (nextId === null) return;
    e.preventDefault();
    e.stopPropagation();
    setActiveRow(nextId);
  }, [handleCreate, handleDeleteClick, rows, activeRow, activeCell, columns, variant, onSelectItem, openModelForm, refetch, selectionLocked, toggleRowSelect]);

  const handleConfigOpen = useCallback(() => {
    setConfigModalAction('open');
  }, []);

  const handleDateRangeToggle = useCallback(() => {
    // Кнопка "Период" в панели открывает модальное окно
    setDateRangeModalAction('open');
  }, []);

  const searchOnChangeRef = useRef(search.onChange);
  searchOnChangeRef.current = search.onChange;

  const handleSearchToggle = useCallback(() => {
    setVisibleFastSearch(v => {
      if (v) {
        // Скрываем поиск → очищаем значение
        searchOnChangeRef.current("");
      }
      return !v;
    });
  }, []);

  // Применить период из модалки → отправить фильтр dateRange
  const handleDateRangeApply = useCallback((start: string, end: string) => {
    // Отправляем как единый объект dateRange — бэкенд ожидает filter[dateRange][startDate] / filter[dateRange][endDate]
    const dateRangeValue: Record<string, string> = {};
    if (start) dateRangeValue.startDate = start;
    if (end) dateRangeValue.endDate = end;
    if (Object.keys(dateRangeValue).length > 0) {
      filtering.onFilterChange('dateRange', dateRangeValue);
    } else {
      filtering.onFilterChange('dateRange', undefined);
    }
  }, [filtering]);

  // Очистить период
  const handleDateRangeClear = useCallback(() => {
    filtering.onFilterChange('dateRange', undefined);
  }, [filtering]);

  // Открыть модалку периода (по клику на ссылку)
  const handleDateRangeBarClick = useCallback(() => {
    setDateRangeModalAction('open');
  }, []);

  return (
    <TableContextProvider value={contextValue} volatile={volatileValue}>
      {configModalAction === 'open' && (
        <TableConfigModalForm method={{ get: configModalAction, set: setConfigModalAction }} />
      )}
      {dateRangeModalAction === 'open' && (
        <FieldDateRangeModal
          method={{ get: dateRangeModalAction, set: setDateRangeModalAction }}
          startDate={currentStartDate}
          endDate={currentEndDate}
          onApply={handleDateRangeApply}
        />
      )}

      <div className={styles.TableWrapper}>
        {!hideToolbar && <TableControlPanel
          variant={variant}
          componentName={componentName}
          showDateRangeButton={showDateRangeButton}
          isLoading={isLoading}
          visibleDateRange={hasDateRange}
          visibleFastSearch={visibleFastSearch}
          onConfigOpen={handleConfigOpen}
          onDateRangeToggle={handleDateRangeToggle}
          onSearchToggle={handleSearchToggle}
          onRefresh={handleRefresh}
          onAddClick={handleCreate}
          onDeleteClick={handleDeleteClick}
          hasSelection={isAllSelectedMode || selectedRows.size > 0}
          search={search}
          extraButtons={extraButtons}
          readonly={isReadonly}
          disableAdd={disableAdd}
          hideAddDelete={hideAddDelete}
          hideAdd={hideAdd}
          hideReload={hideReload}
          reloadTitle={reloadTitle}
          reloading={reloading}
          canDelete={!!onDelete}
        />}

        {showDateRangeButton && hasDateRange && (
          <DateRangeBar
            startDate={currentStartDate}
            endDate={currentEndDate}
            onClick={handleDateRangeBarClick}
            onClear={handleDateRangeClear}
          />
        )}

        <div className={[styles.TableScrollContainer, wrapCells ? styles.WrapCells : null].filter(Boolean).join(" ")}>
          <div
            ref={scrollRef}
            className={`${styles.TableScrollWrapper} ${styles.NoOverflowAnchor}`}
            tabIndex={0}
            onKeyDown={handleScrollKeyDown}
          >
            <TableArea />
          </div>
          {(isLoading || isFetchingNextPage) && (
            <LoadingSpinner variant="overlay" />
          )}
        </div>
      </div>
    </TableContextProvider>
  );
});

Table.displayName = 'Table';

export default Table;
