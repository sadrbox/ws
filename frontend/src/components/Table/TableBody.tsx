/**
 * TableBody + TableBodyRow — тело таблицы с САМОПИСНОЙ виртуализацией (окно строк
 * по ROW_HEIGHT/OVERSCAN, top/bottom-padding), инфинит-скроллом (докрутка страниц)
 * и inline-редактированием ячеек. TableBodyRow обёрнут в memo с производными
 * булевыми пропсами (isActive/isSelected/activeCellId) — P1: перерисовываются
 * только затронутые строки, а не все видимые.
 *
 * Вынесено из Table/index.tsx (T4) БЕЗ изменения логики — модульные memo-компоненты
 * self-contained (контекст + локальный стейт + константы), поэтому перенос чистый.
 */
import {
  memo, Fragment,
  useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect,
  type FC,
} from 'react';
import { GLOBAL_ADAPTIVE_LIMIT_REF } from 'src/hooks/useInfiniteModelList';
import { CellFieldStateScope } from 'src/hooks/useDirtyHighlight';
import { Field } from 'src/components/Field';
import type { TColumn, TDataItem } from './types';
import { useTableContext, useTableVolatile } from './context';
import { getFormatColumnValue } from './services';
import { CHECKBOX_COL_ID } from './tableKeyboardNav';
import { ROW_HEIGHT, OVERSCAN } from './constants';
import styles from './Table.module.scss';

export const TableBody = memo(() => {
  const {
    variant, selectable,
    rows, deferredRowsForRender, columns, isLoading, total,
    isFetchingNextPage, hasNextPage,
    actions, scrollRef, search,
  } = useTableContext();
  // Волатильное состояние читаем ЗДЕСЬ (TableBody перерисуется на навигацию/выделение
  // — это один компонент), а в строки отдаём готовые булевы пропсами. Тогда memo на
  // TableBodyRow сравнивает примитивы и перерисовывает только затронутые строки.
  const { activeRow, activeCell, selectedRows, isAllSelectedMode, excludedRows } = useTableVolatile();
  const extraCol = variant !== 'select' && selectable ? 1 : 0; // +1 колонка под чекбокс

  // scrollRenderTick используется ТОЛЬКО как триггер ре-рендера при скролле.
  // Реальное значение scrollTop читается синхронно из scrollTopRef.
  const [, forceScrollRender] = useState(0);
  // Ref для синхронного чтения scrollTop при расчёте padding (без задержки state)
  const scrollTopRef = useRef<number>(0);
  const [containerHeight, setContainerHeight] = useState(scrollRef.current?.clientHeight ?? 0);

  // Таймер для дебаунса скролла
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Курсор последнего отправленного запроса (rows.length на момент запроса).
  // -1 означает "ещё ничего не запрашивали" — позволяет запустить первый батч.
  const lastRequestedCursorRef = useRef<number>(-1);

  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  const normalizedSearch = search.value.trim();

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    scrollTopRef.current = 0;
    if (el.scrollTop !== 0) el.scrollTop = 0;
  }, [normalizedSearch, scrollRef]);

  // ── Подписка на скролл и resize ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      // Обновляем scrollTop синхронно в ref и асинхронно тригерим ре-рендер
      scrollTopRef.current = el.scrollTop;
      forceScrollRender(v => v + 1);

      // Сбрасываем таймер — запрос выполняется только после остановки скролла
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        tryFetch(el);
      }, 200);
    };

    const ro = new ResizeObserver(() => {
      setContainerHeight(el.clientHeight);
    });

    setContainerHeight(el.clientHeight);
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // tryFetch намеренно не в deps — используем ref-версию ниже
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef]);

  // Держим актуальные значения в ref, чтобы tryFetch внутри setTimeout не устарел
  const fetchStateRef = useRef({ hasNextPage, isFetchingNextPage, rows, total, actions });
  useEffect(() => {
    fetchStateRef.current = { hasNextPage, isFetchingNextPage, rows, total, actions };
  });

  const tryFetch = useCallback((el: HTMLDivElement) => {
    const { hasNextPage, isFetchingNextPage, rows, total, actions } = fetchStateRef.current;

    if (!hasNextPage || isFetchingNextPage) return;
    if (rows.length >= total) return;
    if (!actions.fetchNextPage) return;

    const BATCH_SIZE = 500;
    const TRIGGER_OFFSET = 50; // триггер на 50-й строке каждой новой порции
    const JUMP_BUFFER = 500;

    const viewTopRow = Math.floor(el.scrollTop / ROW_HEIGHT);
    const viewBottomRow = Math.ceil((el.scrollTop + el.clientHeight) / ROW_HEIGHT);

    // ── Случай 1: Прыжок — видимая область ушла ЗА загруженные строки ────
    if (viewTopRow >= rows.length) {
      // Защита от повторного запроса для того же курсора
      if (rows.length === lastRequestedCursorRef.current) return;
      lastRequestedCursorRef.current = rows.length;

      // Грузим до нижней границы видимой области + буфер
      const limit = Math.max(BATCH_SIZE, viewBottomRow - rows.length + JUMP_BUFFER);
      GLOBAL_ADAPTIVE_LIMIT_REF.current = limit;
      if (actions.setAdaptiveLimit) actions.setAdaptiveLimit(limit);
      actions.fetchNextPage();
      return;
    }

    // ── Случай 2: Обычный скролл или прыжок внутри загруженных данных ────
    // triggerRow = начало последней порции + TRIGGER_OFFSET (50 строк)
    // rows=500  → lastBatchStart=0   → triggerRow=50
    // rows=1000 → lastBatchStart=500 → triggerRow=550
    // rows=1500 → lastBatchStart=1000 → triggerRow=1050
    const lastBatchStartRow = Math.max(0, rows.length - BATCH_SIZE);
    const triggerRow = lastBatchStartRow + TRIGGER_OFFSET;

    if (viewBottomRow < triggerRow) return;

    // Защита от повторного запроса для того же курсора
    if (rows.length === lastRequestedCursorRef.current) return;
    lastRequestedCursorRef.current = rows.length;

    GLOBAL_ADAPTIVE_LIMIT_REF.current = BATCH_SIZE;
    if (actions.setAdaptiveLimit) actions.setAdaptiveLimit(BATCH_SIZE);
    actions.fetchNextPage();
  }, []);

  // При сбросе rows до 0 (сортировка/refresh) — сбрасываем курсор,
  // чтобы первый батч новой загрузки не был заблокирован старым значением.
  const prevRowsLengthRef = useRef<number>(0);
  useEffect(() => {
    if (rows.length === 0 && prevRowsLengthRef.current > 0) {
      lastRequestedCursorRef.current = -1;
    }
    prevRowsLengthRef.current = rows.length;
  }, [rows.length]);

  // После загрузки новой порции данных — проверяем, нужно ли грузить следующую.
  // Это нужно когда пользователь не скроллит: данные пришли, viewport уже в зоне триггера.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || rows.length === 0) return;
    tryFetch(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // ── Сохранение выделения при сбросе строк ──
  // При сортировке/refresh rows сбрасываются до 0, затем загружаются заново.
  // selectedRows и excludedRows НЕ очищаем — строки с теми же ID сохранят
  // своё состояние. isAllSelectedMode тоже сохраняется.
  const lastRowCountRef = useRef<number>(0);
  useEffect(() => {
    lastRowCountRef.current = deferredRowsForRender.length;
  }, [deferredRowsForRender.length]);

  // ── Фиксируем scrollTop при добавлении строк ──
  // useLayoutEffect срабатывает синхронно ПЕРЕД отрисовкой браузера.
  // Если DOM изменился (добавились строки) и scrollTop сдвинулся — восстанавливаем его.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Восстанавливаем позицию скролла из ref — она не должна меняться при добавлении строк
    if (el.scrollTop !== scrollTopRef.current) {
      el.scrollTop = scrollTopRef.current;
    }
  }, [deferredRowsForRender.length, scrollRef]);

  // ── Расчёт виртуализации ──
  const loadedCount = deferredRowsForRender.length;
  const effectiveContainerHeight = containerHeight > 0 ? containerHeight : 600;
  const virtualRowsCount = normalizedSearch ? loadedCount : total;

  // Используем ref для расчёта padding — он всегда актуален, без задержки state.
  // Это предотвращает скачок полосы прокрутки при добавлении новых строк.
  const currentScrollTop = scrollTopRef.current;

  // Первая и последняя строка в пикельных координатах (с учётом overscan)
  const firstVisibleIndex = Math.max(0, Math.floor(currentScrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastVisibleIndex = Math.ceil((currentScrollTop + effectiveContainerHeight) / ROW_HEIGHT) + OVERSCAN;

  // startIndexVirtual и endIndexVirtual — индексы ВНУТРИ загруженного массива
  const startIndexVirtual = Math.min(firstVisibleIndex, loadedCount);
  const endIndexVirtual = Math.min(loadedCount, lastVisibleIndex);
  const renderedRowsCount = endIndexVirtual - startIndexVirtual;

  // topPadding = высота строк до первой отрендеренной
  const topPaddingAll = startIndexVirtual * ROW_HEIGHT;

  // bottomPadding вычисляется так, чтобы СУММА всегда равнялась total * ROW_HEIGHT.
  // Это гарантирует стабильную высоту таблицы и неподвижный ползунок скролла.
  const totalTableHeight = virtualRowsCount * ROW_HEIGHT;
  const bottomPaddingAll = Math.max(0, totalTableHeight - topPaddingAll - renderedRowsCount * ROW_HEIGHT);

  const visibleRows = useMemo(
    () => deferredRowsForRender.slice(startIndexVirtual, endIndexVirtual),
    [deferredRowsForRender, startIndexVirtual, endIndexVirtual]
  );

  // ── Рендер ──
  if (!isLoading && rows.length === 0) {
    return (
      <tbody>
        {/* <tr>
          <td colSpan={visibleColumns.length + extraCol} />
        </tr> */}
        <tr className={styles.TableFillerRow} aria-hidden="true">
          <td colSpan={visibleColumns.length + extraCol} />
        </tr>
      </tbody>
    );
  }

  return (
    <tbody>
      {topPaddingAll > 0 && (
        <tr className={styles.VirtualPaddingRow} style={{ height: `${topPaddingAll}px` }} aria-hidden="true" role="presentation">
          <td colSpan={visibleColumns.length + extraCol} />
        </tr>
      )}

      {visibleRows.map((row) => {
        const isActive = activeRow === row.id;
        const isSelected = isAllSelectedMode ? !excludedRows.has(row.id) : selectedRows.has(row.id);
        return (
          <TableBodyRow
            key={row.id}
            row={row}
            columns={visibleColumns}
            isActive={isActive}
            isSelected={isSelected}
            // Активную ячейку передаём ТОЛЬКО активной строке — тогда переезд
            // активной ячейки внутри другой строки не трогает остальные.
            activeCellId={isActive ? activeCell : null}
            isAllSelectedMode={isAllSelectedMode}
          />
        );
      })}

      {bottomPaddingAll > 0 && (
        <tr className={styles.VirtualPaddingRow} style={{ height: `${bottomPaddingAll}px` }} aria-hidden="true" role="presentation">
          <td colSpan={visibleColumns.length + extraCol} >

          </td>
        </tr>
      )}

      {/* Filler row: поглощает остаток высоты, чтобы tfoot прижимался
          к низу TableScrollWrapper, при этом обычные строки tbody
          сохраняют свою фиксированную высоту. */}
      <tr className={styles.TableFillerRow} aria-hidden="true">
        <td colSpan={visibleColumns.length + extraCol} />
      </tr>
    </tbody>
  );
});

// ────────────────────────────────────────────────
// TableBodyRow
// ────────────────────────────────────────────────

interface TableBodyRowProps {
  row: TDataItem;
  columns: TColumn[];
  /** Активна ли строка. Приходит пропсом от TableBody — строка НЕ подписана на
   *  волатильный контекст, поэтому memo перерисовывает только затронутые строки. */
  isActive: boolean;
  /** Выбрана ли строка (чекбокс). */
  isSelected: boolean;
  /** Активная ячейка — только если активна ЭТА строка, иначе null. */
  activeCellId: string | null;
  /** Режим «выбрать все» — нужен в обработчике чекбокса. Меняется редко. */
  isAllSelectedMode: boolean;
}


const TableBodyRow: FC<TableBodyRowProps> = memo(({ row, columns, isActive, isSelected, activeCellId, isAllSelectedMode }) => {
  const {
    variant, selectable,
    onSelectItem,
    rows,
    renderCellRef,
    inlineEditingRef,
    getCellMetaRef,
    expandedRowIds,
    renderExpandedRow,
    canDelete,
    // Только сеттеры — значения выделения/навигации приходят пропсами.
    states: {
      setActiveRow,
      setActiveCell,
      setSelectedRows,
      setIsAllSelectedMode,
      setExcludedRows,
    },
    actions: { openModelForm, refetch },
    isLoading,
    scrollRef,
  } = useTableContext();

  const showCheckbox = variant !== 'select' && selectable;
  // isActive/isSelected/activeCellId — пропсы (см. TableBodyRowProps).
  const isCheckboxCellActive = showCheckbox && isActive && activeCellId === CHECKBOX_COL_ID;

  const toggleSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const id = row.id;
    if (isAllSelectedMode) {
      // В режиме "все" управляем исключениями
      setExcludedRows(prev => {
        const next = new Set(prev);
        if (!e.target.checked) {
          next.add(id);     // Снимаем → добавляем в исключения
        } else {
          next.delete(id);  // Ставим → убираем из исключений
        }
        // Если исключены ВСЕ загруженные строки — выключаем режим "все"
        if (next.size >= rows.length) {
          setIsAllSelectedMode(false);
          setExcludedRows(new Set());
          setSelectedRows(new Set());
          return new Set(); // не используется, но нужен для типа
        }
        return next;
      });
    } else {
      // Обычный режим — управляем selectedRows
      setSelectedRows(prev => {
        const next = new Set(prev);
        if (e.target.checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
        // Если выбраны ВСЕ загруженные строки — переключаемся в режим "все"
        const allLoadedIds = rows.map(r => r.id);
        if (allLoadedIds.every(rid => next.has(rid))) {
          setIsAllSelectedMode(true);
          setExcludedRows(new Set());
          setSelectedRows(new Set());
          return new Set(); // не используется, но нужен для типа
        }
        return next;
      });
    }
  }, [row.id, rows, isAllSelectedMode, setIsAllSelectedMode, setSelectedRows, setExcludedRows]);

  // Флаг: mousedown произошёл на уже сфокусированном поле — клик должен быть стандартным
  const clickedFocusedInputRef = useRef(false);

  const handleRowClick = useCallback((e: React.MouseEvent) => {
    setActiveRow?.(row.id);
    // Если клик пришёлся на конкретную ячейку — синхронизируем activeCell с ней.
    const targetEl = e.target as HTMLElement | null;
    const td = targetEl?.closest('td[data-col-id]') as HTMLElement | null;
    const colId = td?.getAttribute('data-col-id') ?? null;
    if (colId) setActiveCell?.(colId);
    if (clickedFocusedInputRef.current) {
      // Клик по уже сфокусированному полю — не сбрасываем фокус, даём стандартное поведение
      clickedFocusedInputRef.current = false;
      return;
    }
    // Для всех остальных кликов — снимаем фокус с любого активного поля ввода
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') && (active as HTMLInputElement).type !== 'checkbox') {
      active.blur();
    }
    // Гарантируем, что фокус остаётся на scroll-контейнере таблицы, чтобы
    // клавиатурная навигация (Up/Down/Left/Right/Home/End/PgUp/PgDn) работала
    // независимо от того, что в строке могут быть редактируемые поля (input),
    // у которых mousedown с preventDefault может «съесть» автофокус контейнера.
    // Без этого в SubTable (inline-editing) после клика по строке стрелки не
    // работают, потому что фокус остаётся на body.
    const scroller = scrollRef.current;
    if (scroller && !scroller.contains(document.activeElement)) {
      // preventScroll — чтобы не дёргать видимую область при программном фокусе
      try { scroller.focus({ preventScroll: true }); } catch { scroller.focus(); }
    }
  }, [setActiveRow, setActiveCell, row.id, scrollRef, variant]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!inlineEditingRef?.current) {
      clickedFocusedInputRef.current = false;
      return;
    }
    const target = e.target as HTMLElement;
    const isEditableInput =
      (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT';
    if (!isEditableInput) {
      clickedFocusedInputRef.current = false;
      return;
    }
    // Разрешаем стандартное поведение только если клик по тому же полю,
    // которое уже в фокусе (перемещение курсора, выделение текста внутри поля).
    // Для любого другого поля — блокируем авто-фокус; фокус только по двойному клику.
    if (target === document.activeElement) {
      clickedFocusedInputRef.current = true;
    } else {
      clickedFocusedInputRef.current = false;
      e.preventDefault();
    }
  }, [inlineEditingRef]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (inlineEditingRef?.current) {
      // В inline-режиме: двойной клик по полю ввода — фокусируем его
      const target = e.target as HTMLElement;
      const isEditableField =
        (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT';
      if (isEditableField) {
        (target as HTMLInputElement).focus();
        // select() для SELECT-элемента не определён — вызываем только для текстовых полей
        if (target.tagName !== 'SELECT') {
          try { (target as HTMLInputElement).select(); } catch { /* ignore */ }
        }
      } else {
        // Двойной клик по нередактируемой ячейке — пульс-индикация
        const td = target.closest('td');
        if (td) {
          td.removeAttribute('data-pulse');
          void (td as HTMLElement).offsetWidth;
          td.setAttribute('data-pulse', 'true');
          window.setTimeout(() => td.removeAttribute('data-pulse'), 300);
        }
      }
      return;
    }
    if (onSelectItem) {
      onSelectItem(row);
    } else if (openModelForm) {
      openModelForm({ data: row, onSave: refetch, onClose: () => { } });
    }
  }, [inlineEditingRef, onSelectItem, openModelForm, row, refetch]);

  const rowUuid = row.uuid || String(row.id);
  const isExpanded = expandedRowIds?.has(rowUuid) ?? false;
  const visibleColCount = columns.filter(c => c.visible).length + (showCheckbox ? 1 : 0);

  // Класс выравнивания ячейки по типу колонки — вычисляется один раз на колонку
  const cellAlignClass = (col: TColumn) => {
    switch (col.type) {
      case 'number': return styles.JustifyRight;
      case 'switcher': return styles.JustifyCenter;
      default: return styles.JustifyLeft;
    }
  };

  const trClassName = [
    isActive && styles.activeRow,
    isLoading && styles.RowLoading,
  ].filter(Boolean).join(' ');

  return (
    <Fragment>
      <tr
        onClick={handleRowClick}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        className={trClassName}
        data-active={isActive || undefined}
        // data-row-id / data-selected — атрибуты для внешних обработчиков
        // (напр. SubTable.handleContainerKeyDown), чтобы по клавишам можно
        // было определить выбранные/активные строки без доступа к React-state.
        data-row-id={row.id}
        data-selected={isSelected || undefined}
        // Жирное выделение основной записи (см. tr[data-primary="true"] в Table.module.scss)
        // применяется ТОЛЬКО во вложенных таблицах (SubTable, variant="embedded"),
        // которые используются внутри форм организации/контрагента и форм основных записей.
        // В общих списках (variant="default") и в селекторах (variant="select") выделять не нужно.
        data-primary={row.isPrimary && variant === 'embedded' ? "true" : undefined}
      >
        {showCheckbox && (
          <td
            className={styles.CellCenter}
            data-col-id={CHECKBOX_COL_ID}
            onClick={e => {
              e.stopPropagation();
              setActiveRow?.(row.id);
              setActiveCell?.(CHECKBOX_COL_ID);
            }}
          >
            <div
              className={[styles.TableBodyCell, styles.CellJustifyCenter, isCheckboxCellActive ? styles.activeCell : undefined].filter(Boolean).join(' ')}
            >
              <input type="checkbox" checked={isSelected} onChange={toggleSelect} disabled={isLoading || !canDelete} />
            </div>
          </td>
        )}
        {columns.map(col => {
          // Кастомный рендер ячейки (переводы, спецзначения) — работает в любом режиме
          const currentRenderCell = renderCellRef?.current;
          const isCellActive = isActive && activeCellId === col.identifier;

          const cellMeta = getCellMetaRef?.current?.(row, col) ?? null;

          const cellClassName = [
            styles.TableBodyCell,
            cellAlignClass(col),
            isCellActive ? styles.activeCell : null,
          ].filter(Boolean).join(' ');

          const cellTitle = cellMeta?.errorMessage;

          const tdProps = {
            'data-col-id': col.identifier,
            tabIndex: isCellActive ? -1 : undefined,
          } as const;

          const cellFieldState = cellMeta ? { required: cellMeta.required, error: cellMeta.error, errorMessage: cellMeta.errorMessage } : undefined;

          if (currentRenderCell) {
            const customCell = currentRenderCell(row, col);
            if (customCell !== undefined) {
              return (
                <td key={col.identifier} {...tdProps}>
                  <div className={cellClassName} {...(cellTitle ? { title: cellTitle } : {})}>
                    <CellFieldStateScope value={cellFieldState ?? {}}>
                      {customCell}
                    </CellFieldStateScope>
                    {cellMeta?.errorTooltip}
                  </div>
                </td>
              );
            }
          }
          // Fallback: plain read-only span. CellRequired applied here since no Field handles it.
          const fallbackClassName = [
            cellClassName,
            cellMeta?.required ? styles.CellRequired : null,
          ].filter(Boolean).join(' ');
          const value = getFormatColumnValue(row, col);
          return (
            <td key={col.identifier} {...tdProps}>
              <div className={fallbackClassName} {...(cellTitle ? { title: cellTitle } : {})}>
                <span>{value}</span>
                {cellMeta?.errorTooltip}
              </div>
            </td>
          );
        })}
      </tr>
      {
        isExpanded && renderExpandedRow && (
          <tr>
            <td
              colSpan={visibleColCount}
              className={styles.ExpandedRowCell}
            >
              {renderExpandedRow(row)}
            </td>
          </tr>
        )
      }
    </Fragment >
  );
});
