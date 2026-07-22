/**
 * useSubTableKeyboardNav — клавиатурная навигация/действия табличной части (вынесено
 * из SubTable/index.tsx — T4). Enter (открыть форму / добавить строку), Delete
 * (удалить строку с подтверждением), стрелки (перемещение активной строки/ячейки),
 * Tab между инпутами inline-редактирования. Перенос БАЙТ-В-БАЙТ — логика не изменена;
 * компонент лишь передаёт входы (значения + refs + колбэки).
 */
import { useCallback, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import {
  CHECKBOX_COL_ID,
  computeNextActiveColId,
  computeNextActiveRowId,
  getCellNavDirection,
  getTableNavDirection,
} from "src/components/Table/tableKeyboardNav";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TOpenModelFormProps, TableApi } from "src/components/Table";

interface UseSubTableKeyboardNavOptions {
  readonly: boolean;
  inlineEditing: boolean;
  columns: TColumn[];
  /** Проп onInlineAdd (используется лишь как признак доступности добавления). */
  onInlineAdd?: unknown;
  defaultNewRow?: unknown;
  handleInlineAdd: () => Promise<void> | void;
  handleDelete: (selectedRowIds: Set<number>, tableRows: TDataItem[]) => Promise<void> | void;
  confirm: (message: string) => Promise<boolean> | boolean;
  openModelForm: (formProps: TOpenModelFormProps) => void;
  displayRowsRef: RefObject<TDataItem[]>;
  containerRef: RefObject<HTMLDivElement | null>;
  tableApiRef: RefObject<TableApi | null>;
}

export function useSubTableKeyboardNav({
  readonly, inlineEditing, columns,
  onInlineAdd: onInlineAddProp, defaultNewRow,
  handleInlineAdd, handleDelete, confirm, openModelForm,
  displayRowsRef, containerRef, tableApiRef,
}: UseSubTableKeyboardNavOptions) {
  const handleContainerKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (readonly) return;
    const target = e.target as HTMLElement | null;
    const isInputTarget = target instanceof HTMLInputElement && !target.disabled && target.type !== "checkbox";
    const isSelectTarget = target instanceof HTMLSelectElement && !target.disabled;
    const isTextAreaTarget = target instanceof HTMLTextAreaElement;
    const isLookupOpen = target?.getAttribute("aria-expanded") === "true";
    const container = containerRef.current;
    const tableApi = tableApiRef.current;
    if (!container) return;

    // ── Escape: выйти из редактирования input/textarea и вернуть фокус
    // на контейнер таблицы, чтобы клавиатурная навигация (Up/Down/Left/Right
    // /Insert/Delete/Home/End/PgUp/PgDn) продолжала работать. Без этого
    // фокус остаётся «нигде», и события клавиатуры не достигают onKeyDown.
    if (e.key === "Escape" && (isInputTarget || isTextAreaTarget || isSelectTarget)) {
      e.preventDefault();
      e.stopPropagation();
      (target as HTMLElement).blur();
      // Синхронизируем activeRow с строкой текущего input (если был).
      const tr = (target as HTMLElement).closest("tr[data-row-id]");
      const td = (target as HTMLElement).closest("td[data-col-id]");
      const rid = tr ? Number(tr.getAttribute("data-row-id")) : NaN;
      if (Number.isFinite(rid)) tableApi?.setActiveRow(rid);
      const cid = td?.getAttribute("data-col-id");
      if (cid) tableApi?.setActiveCell(cid);
      tableApi?.focusContainer();
      return;
    }

    // ── Режим «Редактирование через форму» (inlineEditing === false) ────
    // В этом режиме SubTable работает как обычный список: клавиатурное
    // редактирование ячеек отключено, но Enter на активной строке должен
    // открывать форму выбранной записи (аналог двойного клика). Остальные
    // навигационные клавиши (стрелки/Home/End/PgUp/PgDn) обрабатывает Table
    // через handleScrollKeyDown — здесь дублировать не нужно.
    if (!inlineEditing) {
      if (e.key !== "Enter") return;
      if (isInputTarget || isTextAreaTarget || isSelectTarget || isLookupOpen) return;
      const activeId = tableApi?.getActiveRow() ?? null;
      if (activeId === null) return;
      const row = displayRowsRef.current.find(r => r.id === activeId);
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      openModelForm({ data: row });
      return;
    }

    // ── Insert: добавить строку ────────────────────────────────────────
    // Если фокус в input/textarea — НЕ перехватываем (поле в фокусе должно
    // работать штатно, управление таблицей отключено). Insert работает
    // только когда фокус на контейнере таблицы.
    if (e.key === "Insert" && !isInputTarget && !isTextAreaTarget && !isSelectTarget) {
      if (!onInlineAddProp && !defaultNewRow) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        await handleInlineAdd();
        // Двойной rAF — чтобы дождаться React commit + браузерного layout.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const cont = containerRef.current;
            if (!cont) return;
            const trs = cont.querySelectorAll<HTMLTableRowElement>('tbody tr[data-row-id]');
            const lastTr = trs[trs.length - 1];
            if (!lastTr) return;
            // Синхронизируем activeRow с новой строкой, чтобы клавиатурная
            // навигация продолжила работать корректно после редактирования.
            const ridStr = lastTr.getAttribute("data-row-id");
            const rid = ridStr ? Number(ridStr) : NaN;
            if (Number.isFinite(rid)) tableApi?.setActiveRow(rid);
            const input = lastTr.querySelector<HTMLInputElement>(
              'input:not([disabled]):not([type="checkbox"]), textarea:not([disabled])'
            );
            if (input) {
              input.focus();
              try { (input).select?.(); } catch { /* ignore */ }
            }
          });
        });
      })();
      return;
    }

    // ── Delete: удалить ВЫБРАННЫЕ чекбоксом строки (с подтверждением) ──
    // Внутри input/textarea — пропускаем (стандартное удаление символа).
    if (e.key === "Delete" && !isInputTarget && !isTextAreaTarget && !isSelectTarget) {
      const rows = displayRowsRef.current;
      if (rows.length === 0) return;
      const selectedIds = new Set<number>();
      const selectedTrs = container.querySelectorAll<HTMLTableRowElement>(
        'tbody tr[data-selected="true"][data-row-id]'
      );
      selectedTrs.forEach((tr) => {
        const id = Number(tr.getAttribute("data-row-id"));
        if (Number.isFinite(id)) selectedIds.add(id);
      });
      if (selectedIds.size === 0) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const message = selectedIds.size === 1
          ? "Удалить выбранную строку?"
          : `Удалить выбранные строки (${selectedIds.size} шт.)?`;
        const ok = await confirm(message);
        if (!ok) return;
        await handleDelete(selectedIds, rows);
      })();
      return;
    }

    // ── Навигация по строкам/ячейкам (activeRow + activeCell) ──────────
    // Up/Down/PgUp/PgDn — перемещение activeRow (та же колонка).
    // Left/Right/Home/End — перемещение activeCell внутри текущей строки.
    //
    // ВАЖНО: если фокус в input/textarea — навигационные клавиши НЕ
    // перехватываются. Поле в фокусе должно использовать клавиши штатно
    // (каретка влево/вправо, выделение Home/End внутри текста, ввод символов).
    // Управление таблицей работает ТОЛЬКО когда фокус на контейнере таблицы
    // (после Escape или клика по строке). Это унифицирует поведение с Table.
    if (!isLookupOpen && !isInputTarget && !isTextAreaTarget && !isSelectTarget) {
      const rowDir = getTableNavDirection(e.key);
      const cellDir = getCellNavDirection(e.key);
      if (rowDir || cellDir) {
        const rows = displayRowsRef.current;
        e.preventDefault();
        e.stopPropagation();
        if (rows.length === 0) return;
        const startRowId: number | null = tableApi?.getActiveRow() ?? null;
        const startColId: string | null = tableApi?.getActiveCell() ?? null;
        if (cellDir) {
          // Колоночная навигация — строка остаётся, меняем activeCell.
          // Учитываем виртуальную колонку чекбокса (CHECKBOX_COL_ID).
          const visibleCols = columns.filter(c => c.visible !== false);
          let nextCol: string | null;
          if (cellDir === 'right' && startColId === CHECKBOX_COL_ID) {
            nextCol = visibleCols.length > 0 ? visibleCols[0].identifier : CHECKBOX_COL_ID;
          } else if (cellDir === 'left' && startColId === CHECKBOX_COL_ID) {
            nextCol = CHECKBOX_COL_ID;
          } else if (cellDir === 'left') {
            const firstVisibleId = visibleCols.length > 0 ? visibleCols[0].identifier : null;
            nextCol = startColId === firstVisibleId
              ? CHECKBOX_COL_ID
              : computeNextActiveColId(columns, startColId, cellDir);
          } else {
            nextCol = computeNextActiveColId(columns, startColId, cellDir);
          }
          if (startRowId !== null) tableApi?.setActiveRow(startRowId);
          if (nextCol !== null) tableApi?.setActiveCell(nextCol);
          tableApi?.focusContainer();
        } else if (rowDir) {
          // Построчная навигация — колонка сохраняется.
          const nextId = computeNextActiveRowId(rows, startRowId, rowDir);
          if (nextId !== null) {
            tableApi?.setActiveRow(nextId);
            if (startColId !== null) tableApi?.setActiveCell(startColId);
            tableApi?.focusContainer();
          }
        }
        return;
      }
    }

    // ── Enter: вход/выход из редактирования строки ─────────────────────
    if (e.key !== "Enter") return;
    if (isLookupOpen) return;
    // Когда фокус на select — не перехватываем Enter, браузер сам обрабатывает
    // открытие/закрытие dropdown. Попытка вмешаться заблокировала бы нативное поведение.
    if (isSelectTarget) return;

    // Хелпер: все редактируемые input-ы внутри tbody / строки.
    const collectInputs = (root: ParentNode): HTMLInputElement[] =>
      Array.from(
        root.querySelectorAll<HTMLInputElement>(
          'input:not([disabled]):not([type="checkbox"])'
        )
      );

    if (!isInputTarget) {
      // Фокус НЕ в input → войти в редактирование.
      // Логика:
      //  - activeCell задан → ищем редактируемый input/textarea в этой td.
      //    Если он есть — фокусируем его.
      //    Если в td нет редактируемого поля (computed/readonly колонка) —
      //    НИЧЕГО не открываем (поведение как у onClick на нередактируемую
      //    ячейку), но запускаем короткую визуальную индикацию «пульс»
      //    на td через атрибут data-pulse, чтобы пользователь понимал что
      //    Enter был обработан, но ячейка не редактируется.
      //  - activeCell НЕ задан → fallback: фокус на первое редактируемое
      //    поле активной строки (старое поведение «войти в редактирование»).
      const activeId = tableApi?.getActiveRow() ?? null;
      if (activeId === null) return;
      const tr = container.querySelector<HTMLTableRowElement>(
        `tbody tr[data-row-id="${activeId}"]`
      );
      if (!tr) return;
      const activeColId = tableApi?.getActiveCell() ?? null;
      if (activeColId) {
        const td = tr.querySelector<HTMLTableCellElement>(
          `td[data-col-id="${activeColId}"]`
        );
        if (!td) return;
        const cellInput = td.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          'input:not([disabled]):not([type="checkbox"]), textarea:not([disabled])'
        );
        const cellSelect = !cellInput
          ? td.querySelector<HTMLSelectElement>('select:not([disabled])')
          : null;
        e.preventDefault();
        e.stopPropagation();
        if (cellInput) {
          cellInput.focus();
          try { (cellInput as HTMLInputElement).select?.(); } catch { /* ignore */ }
        } else if (cellSelect) {
          cellSelect.focus();
        } else {
          // Нередактируемая ячейка — индикация «пульс» (data-pulse="true"),
          // снимаем атрибут после короткой задержки, чтобы CSS-анимация
          // могла отыграть ещё раз при следующем нажатии Enter.
          td.setAttribute("data-pulse", "true");
          window.setTimeout(() => td.removeAttribute("data-pulse"), 300);
        }
        return;
      }
      // Нет activeCell — старое поведение: первое редактируемое поле строки.
      const firstInput = collectInputs(tr)[0];
      if (!firstInput) return;
      e.preventDefault();
      e.stopPropagation();
      firstInput.focus();
      try { firstInput.select(); } catch { /* ignore */ }
      return;
    }

    // Фокус В input: Enter → следующее редактируемое поле в той же строке.
    // Если текущее поле последнее в строке → первое поле следующей строки
    // (пропуская строки без редактируемых полей). Если редактируемых полей
    // больше нет (последний input последней строки) → blur, чтобы вернуть
    // управление клавиатурой контейнеру таблицы.
    //
    // Ранее эта логика дублировалась в каждой *Table (SaleItemsTable и т.п.)
    // через `focusNextInRow` на каждом input'е. Теперь единое поведение
    // обеспечивается на уровне SubTable — все SubTable получают его автоматически.
    const currentTr = (target as HTMLElement).closest("tr");
    if (!currentTr) {
      // Фолбэк — старое поведение для нестандартных DOM (target не в tr).
      const allInputs = collectInputs(
        container.querySelector("tbody") ?? container
      );
      if (allInputs.length === 0) return;
      if (target !== allInputs[allInputs.length - 1]) return;
      e.preventDefault();
      e.stopPropagation();
      (target).blur();
      return;
    }

    const rowInputs = collectInputs(currentTr);
    const idxInRow = rowInputs.indexOf(target);
    // Есть следующее поле в этой же строке — перейти на него.
    if (idxInRow >= 0 && idxInRow < rowInputs.length - 1) {
      e.preventDefault();
      e.stopPropagation();
      const next = rowInputs[idxInRow + 1];
      next.focus();
      try { next.select(); } catch { /* ignore */ }
      return;
    }

    // Поле — последнее в строке. Ищем первое редактируемое поле следующей
    // строки (с непустым списком input'ов). Если такой строки нет — blur.
    let nextTr = currentTr.nextElementSibling as HTMLElement | null;
    while (nextTr && nextTr.tagName === "TR") {
      const nextInputs = collectInputs(nextTr);
      if (nextInputs.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        const first = nextInputs[0];
        // Синхронизируем activeRow с новой строкой, чтобы при последующем
        // Esc/нав. клавишах работа продолжилась с правильной строки.
        const ridStr = (nextTr as HTMLTableRowElement).getAttribute("data-row-id");
        const rid = ridStr ? Number(ridStr) : NaN;
        if (Number.isFinite(rid)) tableApi?.setActiveRow(rid);
        first.focus();
        try { first.select(); } catch { /* ignore */ }
        return;
      }
      nextTr = nextTr.nextElementSibling as HTMLElement | null;
    }

    // Редактируемых полей дальше нет — выходим из режима редактирования.
    e.preventDefault();
    e.stopPropagation();
    (target).blur();
  }, [readonly, inlineEditing, onInlineAddProp, defaultNewRow, handleInlineAdd, handleDelete, confirm, columns, openModelForm]);

  return handleContainerKeyDown;
}
