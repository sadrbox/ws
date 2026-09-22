/**
 * TableHeader — шапка таблицы (<thead>): чекбокс «выбрать все», заголовки колонок
 * с сортировкой и ресайзом (drag правой границы).
 *
 * Вынесено из Table/index.tsx (T4). Потребитель контекста (useTableContext +
 * useTableVolatile для чекбокса «все»); вынос безопасен после context.tsx.
 */
import { memo, useCallback, useMemo, useRef, useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import { getTranslateColumn, translate } from 'src/i18';
import { useTableContext, useTableVolatile } from './context';
import { normalizeLastColumnWidth, isNarrowedView, selectionIndicator, toggleAllSelection } from './services';
import { autoFitWidth, spreadResize, type ResizeColumn } from './columnResize';
import styles from './Table.module.scss';

export const TableHeader = memo(() => {
  const {
    variant, selectable,
    columns, rows, componentName,
    sorting: { sort, onSortChange },
    // search/filtering — чтобы «выбрать все» при сужённом списке не включало режим «все записи».
    search, filtering,
    states: { setSelectedRows, setIsAllSelectedMode, setExcludedRows },
    isLoading, canSelect, groupSelection, selectionLocked,
  } = useTableContext();
  // Значения выделения — из волатильного контекста (чекбокс «выбрать все»).
  const { selectedRows, isAllSelectedMode, excludedRows } = useTableVolatile();

  const isSelect = variant === 'select';
  const showCheckbox = !isSelect && selectable;

  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  /*
   * Индикатор — только по ВИДИМЫМ строкам (services.selectionIndicator): при поиске или отборе по периоду отметки
   * скрытых строк не зажигают над найденным ни галочку, ни «частично». Раньше режим «все» с исключением скрытой
   * строки показывал «частично», а отметки вне поиска — «частично» над списком без единой отметки.
   */
  const { all: isAllSelected, some: isIndeterminate } = useMemo(
    () => selectionIndicator(
      { selected: selectedRows, allMode: isAllSelectedMode, excluded: excludedRows },
      rows.map(r => r.id),
    ),
    [isAllSelectedMode, excludedRows, rows, selectedRows],
  );

  // В групповой таблице «отметить всё» — это «выдать/снять всё во всех вложенных
  // строках»: своих отметок у неё нет (см. groupSelection).
  //
  // ИЗ ПРОМЕЖУТОЧНОГО СОСТОЯНИЯ ДОБИРАЕМ, а не снимаем: ровно так ведёт себя чекбокс
  // самой строки-группы (см. TableBodyRow), и шапка — это та же отметка, только сразу по
  // всем группам. Разное поведение у двух одинаковых на вид чекбоксов пришлось бы
  // запоминать. Заблокированным чекбокс больше не остаётся: неотмечаемые вложенные строки
  // в счёт не идут (см. groupSelection).
  const groupToggleAll = useCallback(() => {
    groupSelection?.toggleAll(!groupSelection.all);
  }, [groupSelection]);

  /*
   * «Выбрать все» при быстром поиске или отборе значит «все ВИДИМЫЕ»: режим «все записи» здесь не включаем — после
   * снятия поиска он выбрал бы весь список, чего человек не просил (services.toggleAllSelection).
   */
  const toggleAll = useCallback(() => {
    const next = toggleAllSelection(
      { selected: selectedRows, allMode: isAllSelectedMode, excluded: excludedRows },
      rows.map(r => r.id),
      isNarrowedView(search.value, filtering.filters),
    );
    setIsAllSelectedMode(next.allMode);
    setSelectedRows(next.selected);
    setExcludedRows(next.excluded);
  }, [rows, search, filtering, selectedRows, excludedRows, isAllSelectedMode,
    setIsAllSelectedMode, setExcludedRows, setSelectedRows]);

  const isResizingRef = useRef(false);

  const handleSort = useCallback((field: string) => {
    if (isResizingRef.current) return; // Не сортировать во время ресайза
    const newDir = sort[field] === 'asc' ? 'desc' : 'asc';
    onSortChange({ [field]: newDir });
  }, [sort, onSortChange]);

  // Устанавливаем indeterminate напрямую через DOM (React не поддерживает этот атрибут)
  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = groupSelection ? groupSelection.some : isIndeterminate;
    }
  }, [isIndeterminate, groupSelection]);

  // ── Column Resize ──────────────────────────────────────────────────────
  //
  // ВПРАВО РАСТЁТ ТОЛЬКО СХВАЧЕННАЯ КОЛОНКА — та, что слева от границы. Соседей это не
  // касается: человек просит места ей, а не перекладывает его по таблице.
  //
  // СУЖЕНИЕ ИДЁТ ЦЕПОЧКОЙ ВЛЕВО. Колонка ужимается до своего минимума, а дальше границу
  // тянет за собой ПРЕДЫДУЩАЯ колонка, потом та, что перед ней, и так до первой. Прежде
  // движение упиралось в минимум: таблица из десяти колонок не помещалась в узкий пейн, а
  // подвинуть границу было некуда — оставалось прятать колонки настройкой.
  //
  // Колонка отметок в этом не участвует: её ширина постоянна, и отдавать её под данные
  // значило бы сделать чекбоксы недоступными ради лишних десяти пикселей. В расчёт
  // попадают только колонки данных (visibleColumns), а смещение колонки отметок в
  // <colgroup> учитывается отдельно (colOffset).
  const { actions } = useTableContext();
  const resizingRef = useRef<{
    colIndex: number;
    startX: number;
    /** Ширины и минимумы ВСЕХ видимых колонок на момент захвата границы. */
    start: ResizeColumn[];
    isLastCol: boolean;
    /** Элементы шапки и <colgroup> по индексам видимых колонок — кэш на время перетаскивания. */
    ths: HTMLElement[];
    colEls: HTMLElement[];
  } | null>(null);

  const handleResizeMouseDown = useCallback((e: ReactMouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    const th = (e.target as HTMLElement).closest('th') as HTMLElement | null;
    const table = th?.closest('table');
    if (!th || !table) return;

    // Кэшируем все нужные ссылки один раз — onMouseMove не делает никаких DOM-запросов.
    const colOffset = showCheckbox ? 1 : 0;
    const headCells = Array.from(table.querySelectorAll<HTMLElement>('thead th'));
    const colGroup = Array.from(table.querySelector('colgroup')?.children ?? []) as HTMLElement[];
    const ths = headCells.slice(colOffset);
    const colEls = colGroup.slice(colOffset);
    // Ширины берём ИЗМЕРЕННЫЕ, а не из настроек: последняя колонка живёт с width: auto, и
    // её настроечная ширина ничего не говорит о том, сколько места она занимает сейчас.
    const start: ResizeColumn[] = visibleColumns.map((c, i) => ({
      width: ths[i]?.getBoundingClientRect().width ?? 0,
      min: parseInt(c.minWidth ?? '50', 10),
    }));

    resizingRef.current = {
      colIndex, startX: e.clientX, start,
      isLastCol: colIndex === visibleColumns.length - 1,
      ths, colEls,
    };
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const apply = (clientX: number): number[] => {
      const r = resizingRef.current!;
      const next = spreadResize(r.start, r.colIndex, clientX - r.startX);
      for (let i = 0; i < next.length; i += 1) {
        if (next[i] === r.start[i].width) continue;
        const px = `${next[i]}px`;
        if (r.ths[i]) r.ths[i].style.width = px;
        if (r.colEls[i]) r.colEls[i].style.width = px;
      }
      return next;
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (resizingRef.current) apply(ev.clientX);
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const r = resizingRef.current;
      if (!r) return;
      const next = apply(ev.clientX);
      // Сохраняем ВСЕ колонки, которых коснулась цепочка сужения, а не одну перетаскиваемую:
      // иначе после перерисовки левые соседи прыгнут обратно к прежней ширине.
      const byId = new Map<string, string>();
      visibleColumns.forEach((c, i) => {
        if (next[i] !== r.start[i].width) byId.set(c.identifier, `${next[i]}px`);
      });
      const mapped = columns.map(c => (byId.has(c.identifier) ? { ...c, width: byId.get(c.identifier)! } : c));
      // Последняя колонка: сохраняем явную ширину, не сбрасываем в auto
      const updatedColumns = r.isLastCol ? mapped : normalizeLastColumnWidth(mapped);
      actions.setColumns(updatedColumns);
      // Служебные колонки (__*) не сохраняем в localStorage (иначе сигнатура колонок
      // не совпадёт с defaults и настройки будут сбрасываться).
      localStorage.setItem(`table_columns_${componentName}`, JSON.stringify(updatedColumns.filter(c => !c.identifier.startsWith("__"))));
      resizingRef.current = null;
      setTimeout(() => { isResizingRef.current = false; }, 0);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [visibleColumns, columns, actions, componentName, showCheckbox]);

  /*
   * АВТОПОДБОР ШИРИНЫ — ДВОЙНОЙ ЩЕЛЧОК ПО ГРАНИЦЕ. Ровно то же, что делает двойной щелчок в
   * любой другой таблице: колонка становится такой ширины, чтобы в неё помещалось самое
   * длинное значение. Подгонять это мышью — работа на несколько попыток, да ещё и вслепую:
   * самое длинное значение может быть ниже по списку и не видно на экране.
   *
   * ПОЧЕМУ НЕ `scrollWidth`. Первая попытка меряла им — и не работала вовсе. Содержимое
   * ячейки лежит во флекс-контейнере с `overflow: hidden`: его дочерний элемент СЖИМАЕТСЯ до
   * ширины ячейки, а не вылезает за неё, поэтому прокручивать нечего и `scrollWidth` всегда
   * равен текущей ширине. Колонка «подбиралась» под саму себя.
   *
   * КАК МЕРЯЕМ. Ячейкам этой колонки на миг разрешается занять столько, сколько просит
   * содержимое (`width: max-content`, без обрезки), после чего читаются их настоящие ширины,
   * и стили снимаются. Записи и чтения идут ДВУМЯ пачками, а не вперемешку: иначе каждое
   * чтение заставляло бы браузер пересчитывать раскладку заново — сорок строк, сорок
   * пересчётов.
   *
   * Строки за пределами виртуального окна в замер не попадают: их нет в DOM. Для видимого
   * списка этого достаточно, а тянуть с сервера все записи ради ширины колонки — плохой размен.
   */
  const handleAutoFit = useCallback((e: ReactMouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest('th') as HTMLElement | null;
    const table = th?.closest('table');
    if (!th || !table) return;

    const colOffset = showCheckbox ? 1 : 0;
    const cellIndex = colIndex + colOffset;
    const boxes: HTMLElement[] = [th];
    for (const tr of table.querySelectorAll<HTMLElement>('tbody tr')) {
      const td = tr.children[cellIndex];
      // Строки-распорки виртуализации (VirtualPaddingRow) пусты — мерить в них нечего.
      if (td instanceof HTMLElement && !tr.classList.contains(styles.VirtualPaddingRow)) boxes.push(td);
    }
    // Мерить нужно ВНУТРЕННИЙ узел (.TableBodyCell / .TableHeaderCell): именно он обрезает
    // содержимое, и именно он знает его настоящую ширину, когда обрезку снять.
    const inners = boxes.map((b) => (b.firstElementChild instanceof HTMLElement ? b.firstElementChild : b));
    // Отступы ячейки читаем ДО правок стилей: после них чтение стоило бы лишнего пересчёта.
    const cs = window.getComputedStyle(inners[1] ?? th);
    const padding = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0') + 2;

    /*
     * ВТОРАЯ МЕРА — ШИРИНА САМОГО ТЕКСТА, измеренная шрифтом ячейки на холсте.
     *
     * Раскладка бывает хитрее замера: поле ввода шириной в 100 %, вложенный флекс со своим
     * сжатием, содержимое в абсолютном позиционировании. Текст же меряется всегда одинаково и
     * ни от чего не зависит. Берём большее из двух — так подбор не зависит от того, чем именно
     * ячейка нарисована.
     */
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const textWidth = (el: HTMLElement) => (ctx ? ctx.measureText((el.textContent ?? '').trim()).width : 0);
    const texts = inners.map(textWidth);

    /*
     * Ячейки С ПОЛЕМ ВВОДА не сужаем ниже нынешней ширины. У поля ширина в процентах, а от
     * «по содержимому» проценты схлопываются в ноль: подбор ужал бы редактируемую колонку
     * до многоточия. Текущая ширина для них — нижняя граница, для остальных её нет, иначе
     * подбор умел бы только расширять.
     */
    const floors = inners.map((el) => (el.querySelector('input, select, textarea')
      ? el.getBoundingClientRect().width
      : 0));

    const saved = inners.map((el) => el.style.cssText);
    for (const el of inners) {
      el.style.width = 'max-content';
      el.style.maxWidth = 'none';
      el.style.minWidth = '0';
      el.style.overflow = 'visible';
      el.style.flex = '0 0 auto';
    }
    // Большее из двух мер (и нижняя граница — для ячеек с полем ввода, см. floors).
    const measured = inners.map((el, i) => Math.max(el.getBoundingClientRect().width, texts[i], floors[i]));
    inners.forEach((el, i) => { el.style.cssText = saved[i]; });

    // Видимая область списка — предел, дальше которого расти некуда: одна ячейка с длинным
    // примечанием не должна выдавливать за край всё остальное.
    const scroller = table.closest<HTMLElement>('[class*="TableScrollWrapper"]');
    const viewport = scroller?.clientWidth ?? table.clientWidth;
    const width = autoFitWidth({
      contents: measured.slice(1),
      header: measured[0],
      padding,
      min: parseInt(visibleColumns[colIndex]?.minWidth ?? '50', 10),
      max: Math.max(280, viewport),
    });

    // Показываем сразу (как при перетаскивании), а потом сохраняем — иначе колонка дёрнется
    // на перерисовке обратно к прежней ширине.
    const px = `${width}px`;
    th.style.width = px;
    const colEl = table.querySelector('colgroup')?.children[cellIndex];
    if (colEl instanceof HTMLElement) colEl.style.width = px;

    const id = visibleColumns[colIndex]?.identifier;
    if (!id) return;
    const mapped = columns.map((c) => (c.identifier === id ? { ...c, width: px } : c));
    const isLastCol = colIndex === visibleColumns.length - 1;
    const updatedColumns = isLastCol ? mapped : normalizeLastColumnWidth(mapped);
    actions.setColumns(updatedColumns);
    localStorage.setItem(
      `table_columns_${componentName}`,
      JSON.stringify(updatedColumns.filter((c) => !c.identifier.startsWith('__'))),
    );
  }, [visibleColumns, columns, actions, componentName, showCheckbox]);

  return (
    <thead>
      <tr>
        {showCheckbox && (
          <th className={styles.HeaderCheckboxCell}>
            <div className={styles.CenterContent}>
              <input
                ref={checkboxRef}
                type="checkbox"
                checked={groupSelection ? groupSelection.all : isAllSelected}
                onChange={selectionLocked ? undefined : groupSelection ? groupToggleAll : toggleAll}
                readOnly={!!selectionLocked}
                disabled={isLoading || rows.length === 0 || !canSelect || !!selectionLocked}
              />
            </div>
          </th>
        )}
        {visibleColumns.map((col, idx) => {
          const isSorting = !!(sort && sort[col.identifier]);
          const dir = isSorting ? sort[col.identifier] : null;
          const isLast = idx === visibleColumns.length - 1;
          const isSortable = col.sortable !== false;
          return (
            <th
              key={col.identifier}
              title={col.hint || (!isLoading && isSortable ? translate("columnSortHint") : undefined)}
              // Курсор — оформление, а не данные: его место в CSS. Атрибут говорит,
              // можно ли сортировать по колонке ЗДЕСЬ И СЕЙЧАС (во время загрузки нельзя).
              data-sortable={(!isLoading && isSortable) || undefined}
              /*
               * СОРТИРОВКА — ДВОЙНЫМ ЩЕЛЧКОМ, а не одиночным.
               *
               * Одиночный щелчок по шапке слишком дёшев: попав по заголовку мимо строки или
               * задев его при выделении, человек перестраивал весь список и терял место, на
               * котором работал. Перестроить тысячу строк — заметное действие, и жест под него
               * нужен намеренный. Двойной щелчок по самой границе колонки занят подбором
               * ширины (см. handleAutoFit) — он гасит всплытие и сюда не доходит.
               */
              onDoubleClick={(!isLoading && isSortable) ? () => handleSort(col.identifier) : undefined}
            >
              <div className={styles.TableHeaderCell}>
                <span>{getTranslateColumn(col)}</span>
                {isSorting && (
                  <svg className={`${styles.SortArrow} ${dir === 'desc' ? styles.desc : ''}`}
                    width="24px" height="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <g><path fill="none" d="M0 0h24v24H0z" /><path d="M12 14l-4-4h8z" /></g>
                  </svg>
                )}
              </div>
              {!isLast && (
                <div
                  className={styles.ResizeHandle}
                  title={translate("columnAutoFitHint")}
                  onMouseDown={(e) => handleResizeMouseDown(e, idx)}
                  onDoubleClick={(e) => handleAutoFit(e, idx)}
                  // Щелчок по границе — про ширину, а не про сортировку: без этого двойной
                  // щелчок заодно дважды переключал бы порядок сортировки колонки.
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );
});
TableHeader.displayName = 'TableHeader';
