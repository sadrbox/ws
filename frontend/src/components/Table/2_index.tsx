// Table.tsx

import { useState, FC, useEffect, useCallback, useMemo, createContext, SetStateAction, Dispatch, useContext, PropsWithChildren, memo, useDeferredValue } from 'react';
import styles from './Table.module.scss';
// Импортируйте ваши типы, включая TypeModelProps и TypeTableContextProps
import { TColumn, TDataItem, TypeFormAction, TypeFormMethod, TypeModelProps, TypeTableContextProps, TypeTableParams } from './types'; // Убедитесь, что импорт правильный
import { getTranslateColumn } from 'src/i18'; // Убедитесь, что путь правильный
import { getFormatColumnValue, getTextAlignByColumnType } from './services'; // Убедитесь, что путь правильный
// Убедитесь, что пути к компонентам форм и утилитам правильные
import { Divider, FieldDateRange, FieldFastSearch } from '../Field';
import Modal from '../Modal';
// import { FieldSelect } from '../Field/index';
// import filterImage from '../../assets/filter_16.png';
import settingsForm from '../../assets/settingsForm_16.png'; // Убедитесь, что путь правильный
import reloadImage from '../../assets/reload_16.png'; // Убедитесь, что путь правильный
import { CSS } from "@dnd-kit/utilities";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PiDotsThreeVerticalDuotone } from 'react-icons/pi';
// import { useAppContext } from 'src/components/app/AppContextProvider';
import React from 'react';
// import useUID from 'src/hooks/useUID';
import { Group } from 'src/app/DesignSystem'; // Убедитесь, что путь правильный


// --------------------- Context Instance -----------------------------------------------
// Создаем контекст с undefined по умолчанию
const TableContextInstance = createContext<TypeTableContextProps | undefined>(undefined);

// Хук для удобного доступа к контексту
export const useTableContextProps = () => {
  const context = useContext(TableContextInstance);
  if (!context) {
    throw new Error("useTableContextProps must be used within TableContextProvider");
  }
  // Возвращаем контекст напрямую, без spread, если не требуется shallow copy
  // spread тоже допустим, но может скрыть ошибки мутации
  return context;
};


// --------------------- Context Provider ----------------------------------------------
// Provider управляет состоянием контекста внутри себя
const TableContextProvider: React.FC<PropsWithChildren<{ init: TypeTableContextProps }>> = ({
  children,
  init, // init теперь содержит ВСЕ пропсы и начальные состояния для контекста
}) => {
  // Состояние контекста инициализируется из init
  const [contextState, setContextState] = useState<TypeTableContextProps>(init);

  // Синхронизируем состояние контекста с пропсом init, если он изменился
  // useMemo в родительском компоненте Table гарантирует, что init меняется только при изменении его зависимостей
  useEffect(() => {
    // Сравниваем объекты по ссылке. Если родитель Table правильно использует useMemo,
    // эта проверка сработает, когда зависимости useMemo действительно изменятся.
    if (init !== contextState) {
      setContextState(init);
    }
  }, [init]); // Зависимость от init

  // Значение, которое будет передано в контекст
  const contextValue = useMemo(() => contextState, [contextState]);

  return (
    <TableContextInstance.Provider value={contextValue}>
      {children}
    </TableContextInstance.Provider>
  );
};


// --------------------- Root component - Table -----------------------------------------
type TypeTableProps = {
  props: TypeModelProps; // Компонент Table принимает один пропс 'props' типа TypeModelProps
};

const Table: FC<TypeTableProps> = ({ props }) => {
  const { model, rows, columns, totalPages, query, actions, states } = props;
  const { queryParams, setQueryParams } = query;
  const { isLoading } = states; // Предполагаем, что isLoading и isFetching приходят в states

  // Состояния, управляемые в компоненте Table и передаваемые ниже через контекст
  const [activeRow, setActiveRow] = useState<number | null>(null);
  // Используем Set для selectedRows для лучшей производительности при проверке .has()
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set(queryParams?.selectedIds ?? [])); // Инициализируем из queryParams, если есть
  const [configModalFormAction, setConfigModalFormAction] = useState<TypeFormAction>('');

  // Отложенное значение страницы для плавного ввода
  const deferredValueCurrentPage = useDeferredValue(queryParams?.page);

  // Обновляем selectedIds в queryParams при изменении selectedRows
  // Это нужно, чтобы selectedIds отправлялись на бэкенд
  useEffect(() => {
    // Сравниваем Set по содержимому, если нужно избежать лишних запросов
    const currentSelectedIdsInQuery = new Set(queryParams?.selectedIds ?? []);
    if (selectedRows.size !== currentSelectedIdsInQuery.size || ![...selectedRows].every(id => currentSelectedIdsInQuery.has(id))) {
      setQueryParams({ selectedIds: Array.from(selectedRows) as any }); // Преобразуем Set в Array для отправки
      // Используем 'any', если TypeTableParams ожидает number[], а не Set<number>
    }

  }, [selectedRows, queryParams?.selectedIds, setQueryParams]); // Зависимости: state selectedRows, значение selectedIds в queryParams, и setQueryParams

  // Сброс activeRow при закрытии модалки (например, после применения или отмены) или при смене запроса
  useEffect(() => {
    if (configModalFormAction !== 'open') { // Сброс, когда модалка закрывается
      setActiveRow(null);
    }
    // Также сброс при смене параметров запроса, если это логично
    // Если смена запроса означает, что активная строка могла исчезнуть
    // setActiveRow(null); // Раскомментировать, если нужно сбрасывать при любой смене query

  }, [configModalFormAction, queryParams]); // Зависимости: действие модалки и параметры запроса

  // Эффект при применении настроек модалки: сбросить страницу на первую
  useEffect(() => {
    if (configModalFormAction === 'apply') {
      setQueryParams({ page: 1 });
      setConfigModalFormAction(''); // Сброс действия модалки
    }
  }, [configModalFormAction, setQueryParams]); // Зависимости: действие модалки и функция обновления queryParams

  const refreshDataTable = useCallback(() => {
    // Принудительное обновление данных на текущей странице
    // Можно просто вызвать refetch из useQuery, если он доступен через actions
    if (actions?.refetch) {
      actions.refetch();
    } else {
      // Или сбросить queryParams, чтобы useQuery обновился
      setQueryParams({}); // Отправка пустого объекта также вызовет обновление useQuery, т.к. queryParams изменится по ссылке
    }
  }, [actions?.refetch, setQueryParams]);


  const handlerChangeCurrentPage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newPage = Math.max(1, Math.min(Number(e.target.value), totalPages));
    setQueryParams({ page: newPage });
  }, [setQueryParams, totalPages]); // Зависимости: setQueryParams и totalPages


  // Значение для контекста таблицы
  const contextProps = useMemo<TypeTableContextProps>(() => ({
    ...props, // Копируем все пропсы из родителя
    // Переопределяем или добавляем состояния, управляемые здесь
    states: {
      ...props.states, // Копируем состояния из родителя (isLoading, isFetching)
      selectedRows, // Передаем состояние selectedRows
      setSelectedRows, // Передаем функцию обновления selectedRows
      activeRow, // Передаем состояние activeRow
      setActiveRow // Передаем функцию обновления activeRow
    },
    // Остальные поля (model, rows, columns, totalPages, query, actions) уже скопированы из props
  }), [props, selectedRows, activeRow]); // Зависимости: props и состояния, управляемые в этом компоненте


  return (
    // Передаем сформированное значение контекста в провайдер
    <TableContextProvider init={contextProps}>
      {/* {filterModalFormAction === 'open' && <TableFilterModalForm method={{ get: filterModalFormAction, set: setFilterModalFormAction }} />} */}
      {configModalFormAction === 'open' && <TableConfigModalForm method={{ get: configModalFormAction, set: setConfigModalFormAction }} />}
      <div className={styles.TableWrapper}>
        <div className={styles.TablePanel}>
          <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ flex: '1 1 100%', justifyContent: 'flex-start' }}>
            <button className={styles.Button}>
              <span>Добавить</span>
            </button>
            <button className={styles.Button}>
              <span>Удалить</span>
            </button>
            <Divider />
            <button onClick={refreshDataTable} className={styles.ButtonImage} title='Обновить'>
              {/* Используем isLoading ИЛИ isFetching для индикации загрузки */}
              <img src={reloadImage} alt="Reload" height={16} width={16} className={isLoading ? styles.animationLoop : ""} />
            </button>
            <button onClick={() => setConfigModalFormAction('open')} className={styles.ButtonImage} title="Настройки">
              <img src={settingsForm} alt="Settings" height={16} width={16} />
            </button>
            <Divider />
            {/* Предполагается, что FieldFastSearch и FieldDateRange используют контекст или передаваемые им пропсы для обновления queryParams */}
            <FieldFastSearch />
            <Divider />
            <div className={styles.colGroup} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 0px" }}>Период:</div>
            <FieldDateRange />

          </div>
          <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ flex: '1', justifyContent: 'flex-end' }}>
            <div className={[styles.colGroup, styles.gap6].join(" ")} >
              <Divider />
              <div className={styles.colGroup} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 0px" }}>Страница:</div>
              <div className={styles.PaginationPages}>
                <input type="number"
                  value={deferredValueCurrentPage ?? ''} // Добавляем ?? '' для корректного отображения 0 или null
                  onChange={handlerChangeCurrentPage}
                  min={1}
                  max={totalPages}
                  disabled={isLoading} // Отключаем ввод во время загрузки
                />
              </div>
              {/* Отображаем общее количество страниц */}
              <div className={styles.colGroup} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 0px" }}>из {totalPages}</div>
            </div>
          </div>
        </div>
        <div className={styles.TableScrollWrapper}>
          <TableArea />
        </div>
      </div>
    </TableContextProvider >
  );
};

export default Table;

// --------------------- Sub component - TableArea -----------------------------------------

const TableArea = memo(() => { // Добавил memo
  // const { states: { isLoading, isFetching } } = useTableContextProps(); // Если нужно использовать состояние загрузки здесь
  return (
    <table>
      {/* Важно: thead должен быть ПЕРЕД tbody для корректной работы table-layout: fixed */}
      <TableHeader />
      <TableBody />
      {/* <DataTableTabFooter /> */}
    </table>
  );
});

// --------------------- Sub component - TableHeader ---------------------------------------
const TableHeader = memo(() => {
  // Получаем все необходимые данные из контекста
  const {
    columns,
    rows, // Нужны rows для определения состояния "выбрать все"
    query: { queryParams, setQueryParams },
    states: { selectedRows, setSelectedRows, isLoading } // Получаем состояние выделения и загрузки из контекста
  } = useTableContextProps();

  // Текущая колонка для сортировки и направление из queryParams
  const currentSortColumnID = queryParams?.sort?.columnID;
  const currentSortDirection = queryParams?.sort?.direction;

  // Определяем, выделены ли все строки на текущей странице
  // Используем useMemo для оптимизации, т.к. rows или selectedRows могут быть большими
  const isAllRowsSelected = useMemo(() => {
    // Если нет строк или строк для выделения, считаем, что "все" не выделены
    if (!rows || rows.length === 0) {
      return false;
    }
    // Проверяем, что каждый ID строки из текущих rows присутствует в Set selectedRows
    return rows.every(row => selectedRows.has(row.id as number));

  }, [rows, selectedRows]); // Зависимости: массив строк и Set выделенных строк

  // Обработчик для чекбокса "выбрать все"
  const handleSelectAllRows = useCallback(() => {
    if (isAllRowsSelected) {
      // Если сейчас выделены все, то снимаем выделение со всех строк на текущей странице
      setSelectedRows(prevSelectedRows => {
        const newSelectedRows = new Set(prevSelectedRows);
        rows.forEach(row => newSelectedRows.delete(row.id as number));
        return newSelectedRows;
      });
    } else {
      // Если выделены не все, то выделяем все строки на текущей странице
      setSelectedRows(prevSelectedRows => {
        const newSelectedRows = new Set(prevSelectedRows);
        rows.forEach(row => newSelectedRows.add(row.id as number));
        return newSelectedRows;
      });
    }
  }, [isAllRowsSelected, rows, setSelectedRows]); // Зависимости: состояние "выбрать все", текущие строки и функция обновления selectedRows


  // Обработчик клика по заголовку для сортировки
  const handleSorting =
    (columnID: string) => {
      console.log(columnID)
      setQueryParams({
        sort: {
          columnID,
          // Если кликнули по текущей сортируемой колонке И направление было 'asc',
          // меняем на 'desc', иначе меняем на 'asc' (или устанавливаем 'asc', если это новая колонка)
          direction: columnID === currentSortColumnID && currentSortDirection === "asc" ? "desc" : "asc",
        }
      });
    }
  // Зависимости: функция обновления queryParams и текущие значения сортировки из queryParams


  // Получаем только видимые колонки
  const visibleColumns = useMemo(() => columns.filter(column => column.visible), [columns]);

  return (
    <thead>
      <tr>
        {/* Колонка с чекбоксом (фиксированная ширина) */}
        {/* width, minWidth, maxWidth, white-space: nowrap заданы в styles.TableArea th:first-child или инлайн */}
        <th style={{ width: '25px', maxWidth: '25px', minWidth: '25px', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="checkbox"
              style={{ height: '21px', width: '17px' }}
              onChange={handleSelectAllRows} // Используем централизованный обработчик
              checked={isAllRowsSelected} // Состояние чекбокса зависит от isAllRowsSelected
              disabled={isLoading || !rows || rows.length === 0} // Отключаем, если нет строк или идет загрузка
            />
          </div>
        </th>
        {/* Рендерим видимые колонки */}
        {visibleColumns.map((column: TColumn) => { // Убрал keyID, лучше использовать identifier, но в <th> key может быть и другим
          const styleWidth = {
            // width и maxWidth лучше задавать через CSS классы или в TableBodyRow td
            // Инлайн стили здесь могут переопределяться стилями ячеек
            // width: column.width, // Ширина колонки задается в <td> первой строки или через CSS
            // ...(column.type !== "string" && { minWidth: column.width }), // minWidth для нестроковых типов
          };

          // Специальный рендеринг для boolean колонок (без сортировки)
          if (column.type === "boolean") {
            return (
              <th key={column.identifier} style={styleWidth}> {/* Используем identifier как key */}
                <div style={{ justifyItems: "center" }}></div>
              </th>
            );
          }

          // Рендеринг сортируемых колонок
          const isActive = currentSortColumnID === column.identifier;
          const iconStyle = {
            justifySelf: "end",
            marginLeft: "10px",
            color: isActive ? "#666" : "transparent", // Цвет иконки активной сортировки
            transform: currentSortDirection === "asc" ? "none" : "scale(1,-1)", // Поворот иконки
            transition: 'transform 0.2s ease-in-out', // Плавный поворот
            display: 'flex', // Чтобы иконка была flex-элементом для justifySelf
            alignItems: 'center', // Центрировать иконку по вертикали
          };

          return (
            <th
              key={column.identifier} // Используем identifier как key
              style={{ ...styleWidth, cursor: 'pointer' }} // Добавляем указатель мыши
              onClick={() => handleSorting(column.identifier)} // Обработчик сортировки
            >
              <div className={styles.TableHeaderColumn}>
                <span>{getTranslateColumn(column)}</span>
                {/* SVG иконка сортировки */}
                <svg style={iconStyle} width="18" height="18" viewBox="8 4 8 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 8V10M12 14L9 11M12 14L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </th>
          );
        })}
      </tr>
    </thead>
  );
})

// --------------------- Sub component - TableBody -------------------------------------------
const TableBody = memo(() => {
  // Получаем нужные данные из контекста
  const { columns, rows, states: { isLoading } } = useTableContextProps();

  // Получаем только видимые колонки
  const visibleColumns = useMemo(() => columns.filter(col => col.visible), [columns]);

  // Определяем общее количество колонок для colSpan (видимые + чекбокс)
  const totalVisibleColumns = visibleColumns.length + 1; // +1 для колонки чекбокса

  return (
    <tbody className={(isLoading) ? styles.blur5 : ""}> {/* Применяем размытие при загрузке */}
      {rows.map((row: TDataItem, key: number) =>
        // rowID должен быть уникальным идентификатором строки (например, id из базы)
        // key может быть индексом массива, но row.id лучше для react list keys
        <TableBodyRow
          key={row.id} // Используем row.id как key
          countID={key + 1} // countID - это просто номер строки по порядку на странице
          rowID={row.id as number} // Передаем id строки
          columns={visibleColumns} // Передаем только видимые колонки
          row={row} // Передаем данные строки
        // loading={isLoading || isFetching} // Состояние загрузки доступно в контексте, можно не передавать
        />
      )}
      {/* Пустая строка для растягивания, если нужно. Убедитесь, что CSS для .TableScrollWrapper и table/tbody настроен правильно */}
      {/* Colspan должно быть равно общему количеству отображаемых колонок, включая колонку чекбокса */}
      <tr style={{ height: "100%" }}><td colSpan={totalVisibleColumns}></td></tr>
    </tbody>
  )
})

// --------------------- Sub component - TableBodyRow -----------------------------------------
type TypeTableBodyRowProps = {
  countID: number; // Номер строки на странице
  rowID: number; // Уникальный ID строки из данных
  columns: TColumn[]; // Видимые колонки для этой строки
  row: TDataItem; // Данные текущей строки
}

const TableBodyRow: FC<TypeTableBodyRowProps> = memo(({ countID, rowID, columns, row }) => {
  // Получаем необходимые данные из контекста
  const {
    states: { activeRow, setActiveRow, selectedRows, setSelectedRows, isLoading, isFetching }, // Состояние выделения и активности из контекста
    query: { queryParams } // Если нужно access queryParams
  } = useTableContextProps();

  // Определяем, является ли текущая строка активной
  const isActiveRow = activeRow === rowID;
  // Определяем, выделена ли текущая строка (проверяем наличие rowID в Set из контекста)
  const isRowSelected = selectedRows.has(rowID);

  // Класс для ячеек: активная или обычная
  const cellClass = isActiveRow ? styles.TabFieldActive : ''; // Применяем стиль только для активной строки

  // Обработчик клика по чекбоксу в строке
  const handleChangeSelectedRows = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation(); // Останавливаем всплытие, чтобы не сработал onClick на td/tr
    const checked = event.target.checked;
    setSelectedRows(prevSelectedRows => {
      const newSelectedRows = new Set(prevSelectedRows);
      if (checked) {
        newSelectedRows.add(rowID); // Добавляем ID строки в Set
      } else {
        newSelectedRows.delete(rowID); // Удаляем ID строки из Set
      }
      return newSelectedRows; // Возвращаем новый Set
    });
  }, [rowID, setSelectedRows]); // Зависимости: id текущей строки и функция обновления Set

  // Обработчик клика по строке для установки ее активной
  const handleSetActiveRow = useCallback(() => {
    // Устанавливаем активную строку, только если нет загрузки
    if (setActiveRow && !(isLoading || isFetching)) {
      setActiveRow(rowID);
    }
  }, [rowID, setActiveRow, isLoading, isFetching]); // Зависимости: id строки, функция setActiveRow, состояние загрузки

  return (
    <tr
      data-count-id={countID}
      data-row-id={rowID}
      className={isActiveRow ? styles.ActiveRow : ''} // Добавляем класс для активной строки ко всей строке
      onClick={handleSetActiveRow} // Обработчик клика по строке
      // Добавляем класс размытия, если идет загрузка
      style={{ ...(isLoading || isFetching ? { opacity: 0.7, pointerEvents: 'none' } : {}) }}
    >
      {/* Ячейка с чекбоксом (фиксированная ширина) */}
      {/* width, minWidth, maxWidth, white-space: nowrap заданы в styles.TableBodyRow td:first-child или инлайн */}
      <td style={{ width: '25px', maxWidth: '25px', minWidth: '25px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <input
            type="checkbox"
            style={{ height: "21px", width: "17px" }}
            checked={isRowSelected} // Состояние чекбокса зависит от isRowSelected
            onChange={handleChangeSelectedRows} // Используем централизованный обработчик для этой строки
            disabled={isLoading || isFetching} // Отключаем во время загрузки
          />
        </div>
      </td>
      {/* Ячейки с данными */}
      {columns.map((column, columnIndex) => {
        const value = getFormatColumnValue(row, column); // Форматированное значение ячейки

        // Стили выравнивания текста
        const textAlignStyle = getTextAlignByColumnType(column);

        const content = (
          // Применяем cellClass (для активной строки) и стиль выравнивания
          <div style={textAlignStyle} className={`${styles.TableBodyColumn} ${cellClass}`}>
            <span>{value}</span>
          </div>
        );

        return (
          <td
            key={column.identifier} // Используем identifier колонки как key
            style={{
              // Ширина ячейки (колонки). Должна совпадать с шириной th в thead.
              // Лучше задавать ширину в CSS классах или в TableBodyRow td,
              // но инлайн тоже работает, если согласуется с th в thead.
              width: column.width,
              maxWidth: column.width,
              // Можно добавить правила overflow/text-overflow, если контент может быть шире
              // overflow: 'hidden',
              // textOverflow: 'ellipsis',
              // whiteSpace: 'nowrap', // Если не нужен перенос текста в ячейке
            }}
          // Убрал onClick с td, т.к. клик по tr обрабатывается
          >
            {/* Рендерим содержимое ячейки. Для boolean может быть специальный рендеринг. */}
            {column.type === "boolean" ? <div className={`${styles.TableBodyColumn} ${cellClass}`} /> : content}
          </td>
        );
      })}
    </tr>
  );
});


// --------------------- Modal Components (без значительных изменений, если только исправить импорты/типы) -----------------------------------------

// Обновите импорты, если нужно
// import { useTableContextProps } from './TableContext'; // или откуда они импортируются

type TypeModalProps = {
  method: TypeFormMethod;
};

const TableConfigModalForm: FC<TypeModalProps> = ({ method }) => {
  // actions.setColumns теперь используется
  const { columns, model, actions } = useTableContextProps();
  // Проверка на наличие setColumns перед использованием
  const setColumnsAction = actions?.setColumns;

  const [columnsConfig, setColumnsConfig] = useState<TColumn[]>(columns);

  const onApply = () => {
    localStorage.setItem(model, JSON.stringify(columnsConfig));
    // Вызываем setColumnsAction только если он существует
    if (setColumnsAction) {
      setColumnsAction(columnsConfig);
    }
  }

  return (
    <Modal title="Настройки таблицы" method={method} onApply={onApply} style={{ width: '400px' }}>
      <Group align='row' type="easy">
        <TableConfigColumns columns={columnsConfig} setColumns={setColumnsConfig} />
      </Group>
    </Modal>
  );
};

type TypeTableConfigColumnsProps = {
  columns: TColumn[];
  setColumns: Dispatch<SetStateAction<TColumn[]>>;
};
const TableConfigColumns: FC<TypeTableConfigColumnsProps> = ({ columns, setColumns }) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const updateColumnVisibility = useCallback((identifier: string, visible: boolean) => {
    setColumns(prev =>
      prev.map(col => col.identifier === identifier ? { ...col, visible } : col)
    );
  }, [setColumns]); // Зависимость от setColumns

  const onDragStart = useCallback((event: any) => {
    setDraggingId(String(event.active.id)); // Убеждаемся, что ID строка
  }, []); // Нет зависимостей

  const onDragEnd = useCallback((event: any) => {
    const { active, over } = event;
    setDraggingId(null);
    if (active.id !== over?.id) {
      setColumns((prev) => {
        const oldIndex = prev.findIndex((col) => col.identifier === active.id);
        const newIndex = prev.findIndex((col) => col.identifier === over?.id);
        // console.log({ oldIndex, newIndex })
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, [setColumns]); // Зависимость от setColumns

  // Используем identifier как id для dnd-kit item
  const dndItems = useMemo(() => columns.map(col => col.identifier), [columns]);


  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} onDragStart={onDragStart}>
      <SortableContext items={dndItems} strategy={verticalListSortingStrategy}>
        <ul className={styles.CheckboxList}>
          {/* Итерируемся по колоннам для рендеринга сортируемых элементов */}
          {columns.map((column) => (
            <TableConfigColumnsItem
              key={column.identifier} // key для React list
              column={column}
              isDragging={column.identifier === draggingId}
              toggleVisibility={updateColumnVisibility}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
};

type TypeTableConfigColumnsItemProps = { // Переименовал тип для ясности
  column: TColumn,
  isDragging: boolean;
  toggleVisibility: (identifier: string, visible: boolean) => void;
};
const TableConfigColumnsItem: FC<TypeTableConfigColumnsItemProps> = memo(({ column, isDragging, toggleVisibility }) => { // Добавил memo
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: column.identifier });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Обработчик изменения чекбокса видимости
  const handleCheckboxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    toggleVisibility(column.identifier, e.target.checked);
  }, [column.identifier, toggleVisibility]); // Зависимости: identifier колонки и функция из пропсов


  return (
    // Привязываем setNodeRef для DND и применяем стили DND
    <li ref={setNodeRef} style={style} className={`${styles.ListItem} ${isDragging ? styles.dragging : ''}`}>
      {/* Элемент для захвата (draggable handle) */}
      <div {...listeners} className={styles.DragAndDrop}>
        <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
      </div>
      {/* Чекбокс видимости */}
      <input
        // ...attributes добавляет атрибуты для доступности и роли DND
        {...attributes}
        type="checkbox"
        id={`column-visibility-${column.identifier}`} // Уникальный ID для чекбокса
        checked={column.visible}
        onChange={handleCheckboxChange} // Используем useCallback handler
      />
      {/* Метка для чекбокса */}
      <label htmlFor={`column-visibility-${column.identifier}`}>{getTranslateColumn(column)}</label>
    </li>
  );
});

// --------------------- END Modal Components ---------------------------------------------


// ВАЖНО: Убедитесь, что у вас есть соответствующие стили в Table.module.scss:
/*
.TableWrapper {
    // Контейнер для таблицы, возможно с max-height и overflow-y: auto;
}

.TablePanel {
    // Стили для панели управления (фильтры, кнопки и т.д.)
    display: flex; // или grid
    // ... другие стили
}

.TableScrollWrapper {
    // Контейнер, который делает таблицу прокручиваемой
    // height: calc(100% - [высота панели]); // Пример расчета высоты
    overflow-y: auto; // Вертикальная прокрутка
    // Если нужно, чтобы заголовки были прилеплены (sticky), это усложнит CSS
    // и может потребовать отдельного div для thead и tbody
}

table {
    border-collapse: collapse;
    height: 100%; // Высота таблицы 100% от TableScrollWrapper
    width: 100%; // Ширина таблицы 100% от TableScrollWrapper
    table-layout: fixed; // Важно для фиксированной ширины колонок
}

thead {
    // Стили для заголовка таблицы
    // Если thead должен быть прилеплен, ему нужен position: sticky; top: 0;
    // и фон (background)
    background-color: white; // Или ваш фон
    position: sticky;
    top: 0;
    z-index: 1; // Чтобы был поверх содержимого tbody
}

tbody {
     // Стили для тела таблицы
     // height: 100%; // Это может быть не нужно или работать не так как ожидается
}


// Стили для ячеек заголовка (th)
.my-table th {
    padding: 8px; // Пример
    text-align: left; // Пример
    border: 1px solid #ccc; // Пример
    // Общие стили для всех заголовков
}


// Стили для фиксированной колонки чекбокса
.my-table th:first-child,
.my-table td:first-child {
    width: 25px;
    min-width: 25px;
    max-width: 25px;
    white-space: nowrap; // Предотвращает перенос содержимого
    // sticky position для первой колонки, если нужно
    // position: sticky;
    // left: 0;
    // background-color: white; // Фон для sticky колонки
    // z-index: 2; // Выше, чем thead sticky
}

// Стили для ячеек данных (td)
.my-table td {
    padding: 8px; // Пример
    border: 1px solid #ccc; // Пример
    word-break: break-word; // Разрешить разрыв слов
    // Управление шириной остальных колонок осуществляется через th или td в первой строке
    // или они делят оставшееся пространство при table-layout: fixed
    // Если колонки имеют заданную ширину (например, в px или %), она применяется
    // Если ширина не задана, они делят оставшееся пространство поровну
}

.my-table td div {
    // Стили для div внутри td, если он используется для выравнивания или контента
    overflow: hidden; // Часто полезно при fixed table-layout
    text-overflow: ellipsis; // Добавляет ... если контент обрезан
}

.TableHeaderColumn {
     display: flex;
     align-items: center;
     justify-content: space-between; // Растягивает пространство между текстом и иконкой
}

.blur5 {
    filter: blur(5px);
    pointer-events: none; // Делает элементы некликабельными
}

.ActiveRow {
    background-color: #f0f0f0; // Или другой стиль для активной строки
}

*/