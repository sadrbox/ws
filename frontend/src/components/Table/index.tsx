// Table.tsx

import { useState, FC, useEffect, useCallback, useMemo, createContext, SetStateAction, Dispatch, useContext, PropsWithChildren, memo } from 'react';
import styles from './Table.module.scss'; // Убедитесь, что путь к стилям правильный
// Импортируйте ваши типы, включая TypeModelProps и TypeTableContextProps
// Убедитесь, что путь к файлу с типами правильный
import { TColumn, TDataItem, TypeFormAction, TypeModalFormProps, TypeModelProps, TypeTableContextProps } from './types';
import { getTranslateColumn } from 'src/i18'; // Убедитесь, что путь правильный
import { getFormatColumnValue, getTextAlignByColumnType } from './services'; // Убедитесь, что путь правильный
// Убедитесь, что пути к компонентам форм и утилитам правильные
import { Divider, FieldDateRange, FieldFastSearch } from '../Field'; // Проверьте экспорт FieldDateRange и FieldFastSearch
import Modal from '../Modal'; // Проверьте путь к компоненту Modal
// import { FieldSelect } from '../Field/index'; // Закомментировано, если не используется
// import filterImage from '../../assets/filter_16.png'; // Закомментировано, если не используется
import settingsForm_16 from '../../assets/form-setting_16.png'; // Убедитесь, что путь правильный
import reloadImage_16 from '../../assets/reload_16.png'; // Убедитесь, что путь правильный
import calendar_16 from '../../assets/calendar_16.png'; // Закомментировано, если не используется
import searchField_16 from '../../assets/search-field_16.png'; // Закомментировано, если не используется
import { CSS } from "@dnd-kit/utilities";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PiDotsThreeVerticalDuotone } from 'react-icons/pi'; // Проверьте установку react-icons
// import { useAppContext } from 'src/components/app/AppContextProvider'; // Закомментировано, если не используется
import React from 'react';
// import useUID from 'src/hooks/useUID'; // Закомментировано, если не используется
import { Group } from 'src/components/UI'; // Убедитесь, что путь правильный
import { Button, ButtonImage } from '../Button';
// import { columns } from 'src/models/Products/config';

// Импортируйте компоненты модальных форм, если они определены в отдельных файлах
// import TableFilterModalForm from './TableFilterModalForm'; // Пример
// import TableConfigModalForm from './TableConfigModalForm'; // Убедитесь, что путь правильный
// import { getTranslation } from '../../i18/index';
// import { useAppContextProps } from 'src/app/AppContextProvider';
// import ContractForm from 'src/models/contracts/form';
import { ref } from 'process';

// --------------------- Context Instance -----------------------------------------------
// Создаем контекст со значением по умолчанию undefined.
// Хук useTableContextProps будет проверять наличие значения.
const TableContextInstance = createContext<TypeTableContextProps | undefined>(undefined);

// Хук для удобного доступа к контексту таблицы.
// Выбрасывает ошибку, если используется вне TableContextProvider.
export const useTableContextProps = () => {
  const context = useContext(TableContextInstance);
  if (context === undefined) { // Более явная проверка на undefined
    throw new Error("useTableContextProps must be used within TableContextProvider");
  }
  // Возвращаем объект контекста. Нет необходимости в spread, если объект уже содержит все нужные поля.
  return context;
};


// --------------------- Context Provider ----------------------------------------------
// Provider управляет состоянием контекста.
// Он принимает начальное значение `init` и управляет внутренним состоянием `contextState`.
const TableContextProvider: React.FC<PropsWithChildren<{ init: TypeTableContextProps }>> = ({
  children,
  init, // init содержит начальные значения и функции для контекста
}) => {
  // Состояние контекста инициализируется из init.
  // contextState будет обновляться через setContextState ИЛИ через useEffect,
  // если prop init от родителя изменился.
  const [contextState, setContextState] = useState<TypeTableContextProps>(init);

  // Синхронизируем внутреннее состояние контекста с пропсом init.
  // Если родительский компонент (Table) передает новое значение `init`
  // (например, когда меняются основные пропсы, влияющие на таблицу),
  // это обновит внутреннее состояние контекста.
  // Родитель Table использует useMemo для создания `init` (contextProps),
  // что гарантирует, что `init` меняется только тогда, когда действительно меняются его зависимости.
  useEffect(() => {
    // Сравниваем объекты по ссылке. Если `init` - новый объект (из useMemo родителя),
    // обновляем внутреннее состояние контекста.
    if (init !== contextState) {
      setContextState(init);
    }
  }, [init, contextState]); // Зависимость от init и contextState для правильной синхронизации

  // Значение, которое будет передано потребителям контекста.
  // Мемоизируем его, чтобы предотвратить лишние ре-рендеры потребителей,
  // если contextState не изменился.
  const contextValue = useMemo(() => contextState, [contextState]);

  return (
    <TableContextInstance.Provider value={contextValue}>
      {children}
    </TableContextInstance.Provider>
  );
};


// --------------------- Root component - Table -----------------------------------------
type TypeTableProps = {
  props: Omit<TypeModelProps, 'states'>; // Компонент Table принимает один пропс 'props' типа TypeModelProps
};

const Table: FC<TypeTableProps> = ({ props }) => {
  // Деструктурируем основные части пропсов
  const { isLoading, query, actions } = props;
  // Деструктурируем queryParams и функцию его обновления
  const { queryParams, setQueryParams } = query;
  // Деструктурируем состояния загрузки
  // const { isLoading } = states; // Предполагаем, что isLoading приходит в states

  // --- Состояния, управляемые внутри компонента Table ---
  // Состояние активной строки (по ID)
  const [activeRow, setActiveRow] = useState<number | null>(null);
  // Состояние выделенных строк. Используем Set для эффективности операций add/delete/has.
  // Инициализируем из queryParams?.selectedIds, преобразуя массив в Set.
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set(queryParams?.selectedIds ?? []));
  // Состояние действия для модального окна конфигурации
  const [configModalFormAction, setConfigModalFormAction] = useState<TypeFormAction>('');
  const [visibleFieldSearchByPeriod, setVisibleFieldSearchByPeriod] = useState<boolean>(false);
  const [visibleFastSearchField, setVisibleFastSearchField] = useState<boolean>(false);

  // Отложенное значение страницы для плавного ввода в поле пагинации
  // const deferredValueCurrentPage = useDeferredValue(queryParams?.page);

  // --- Эффекты ---

  // Эффект для синхронизации состояния selectedRows (Set) с queryParams.selectedIds (Array).
  // Вызывается при изменении selectedRows или queryParams?.selectedIds.
  useEffect(() => {
    // Получаем текущий массив selectedIds из queryParams и преобразуем его в Set для сравнения.
    const currentSelectedIdsArray = queryParams?.selectedIds ?? [];
    const currentSelectedIdsSet = new Set(currentSelectedIdsArray);

    // Сравниваем Set selectedRows с Set, созданным из массива в queryParams.
    // Проверяем размер и наличие каждого элемента из selectedRows в Set из queryParams.
    const areSetsEqual = selectedRows.size === currentSelectedIdsSet.size &&
      [...selectedRows].every(id => currentSelectedIdsSet.has(id));

    // Если Set selectedRows отличается от массива в queryParams, обновляем queryParams.
    if (!areSetsEqual) {
      // Преобразуем Set в Array для обновления queryParams, так как, вероятно,
      // TypeTableParams ожидает массив чисел.
      // Убираем 'as any', предполагая, что TypeTableParams допускает selectedIds: number[] | undefined.
      // Если TypeTableParams строго типизирован иначе, возможно, понадобится уточнить тип.
      setQueryParams({ selectedIds: selectedRows });
    }

  }, [selectedRows, queryParams?.selectedIds, setQueryParams]); // Зависимости: состояние selectedRows, текущее значение selectedIds в queryParams, и функция setQueryParams.

  // Эффект для сброса activeRow при закрытии модалки или при смене запроса.
  useEffect(() => {
    // Сбрасываем активную строку, если модалка закрывается ('apply', 'cancel', '').
    // Проверка 'open' означает, что мы сбрасываем activeRow при ЛЮБОМ статусе, кроме 'open'.
    if (configModalFormAction !== 'open') {
      setActiveRow(null);
    }
    // Раскомментируйте следующую строку, если нужно сбрасывать активную строку
    // при ЛЮБОМ изменении queryParams (например, при переходе на другую страницу).
    // else if (queryParams !== props.query.queryParams) { // Сравниваем объекты queryParams
    //   setActiveRow(null);
    // }
  }, [configModalFormAction, queryParams]); // Зависимости: действие модалки и параметры запроса.

  // Эффект при применении настроек модалки: сбросить страницу на первую.
  useEffect(() => {
    if (configModalFormAction === 'apply') {
      // Устанавливаем страницу 1 через setQueryParams.
      // Важно: setQueryParams должен уметь мержить частичные обновления объекта queryParams.
      setQueryParams({ page: 1 });
      setConfigModalFormAction(''); // Сбрасываем действие модалки после применения.
    }
  }, [configModalFormAction, setQueryParams]); // Зависимости: действие модалки и функция обновления queryParams.


  // Обработчик для кнопки "Обновить"
  const refreshDataTable = useCallback(() => {
    // Если есть функция refetch в actions (например, от useQuery/useSWR), используем ее.
    if (actions?.refetch) {
      actions.refetch();
    } else {
      // Иначе, можно вызвать setQueryParams с пустым объектом.
      // Если setQueryParams правильно настроен, он вызовет обновление данных,
      // так как ссылка на queryParams изменится.
      // Убедитесь, что ваша логика получения данных реагирует на изменения queryParams.
      setQueryParams({});
    }
  }, [actions?.refetch, setQueryParams]); // Зависимости: функция refetch и функция setQueryParams.

  // // Обработчик изменения значения в поле номера страницы
  // const handlerChangeCurrentPage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  //   // Получаем новое значение, преобразуем в число.
  //   const rawValue = Number(e.target.value);
  //   // Проверяем, что это валидное число и находится в пределах [1, totalPages].
  //   const newPage = Math.max(1, Math.min(isNaN(rawValue) ? 1 : rawValue, totalPages));
  //   // Устанавливаем новую страницу через setQueryParams.
  //   setQueryParams({ page: newPage });
  // }, [setQueryParams, totalPages]); // Зависимости: функция setQueryParams и общее количество страниц.

  const handleButtonCreateElement = () => {
    return actions?.openForm ? actions.openForm({ onSave: actions?.refetch, onClose: () => alert("onClose") }) : null; // Replace null with a default number like 0
  };

  // --- Значение контекста ---
  // Мемоизируем объект, передаваемый в контекст, чтобы он не менялся при каждом ре-рендере Table,
  // если только не изменились его зависимости (props, selectedRows, activeRow).
  const contextProps = useMemo<TypeTableContextProps>(() => ({
    ...props, // Копируем все пропсы, переданные в Table
    // Переопределяем или добавляем состояния, управляемые в этом компоненте Table
    states: {
      // ...props.states, // Копируем состояния из родителя (isLoading, isFetching)
      selectedRows, // Передаем состояние selectedRows (Set)
      setSelectedRows, // Передаем функцию обновления selectedRows (Set)
      activeRow, // Передаем состояние activeRow
      setActiveRow // Передаем функцию обновления activeRow
    },
    // Остальные поля (model, rows, columns, totalPages, query, actions) уже скопированы из props
  }), [props, selectedRows, activeRow]); // Зависимости: исходные пропсы и состояния, управляемые в Table.

  // console.log(props?.rows)

  // --- Рендер корневого компонента Table ---

  return (
    // Оборачиваем все содержимое таблицы в Context Provider.
    // Передаем сформированное и мемоизированное значение контекста.
    <TableContextProvider init={contextProps}>

      {/* {filterModalFormAction === 'open' && <TableFilterModalForm method={{ get: filterModalFormAction, set: setFilterModalFormAction }} />} */}
      {/* Рендерим модальное окно конфигурации, если configModalFormAction === 'open' */}
      {configModalFormAction === 'open' && <TableConfigModalForm method={{ get: configModalFormAction, set: setConfigModalFormAction }} />}

      <div className={styles.TableWrapper}>
        <div className={styles.TablePanel}>
          <div className={styles.TablePanelLeft}>
            <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: 'flex-start' }}>
              {/* Примеры кнопок */}

              <Divider />
              <Button onClick={() => handleButtonCreateElement()}>
                <span>Добавить</span>
              </Button>
              <Button onClick={() => alert('Delete clicked!')}>
                <span>Удалить</span>
              </Button>
              <Divider /> {/* Используйте ваш компонент разделителя */}
              {/* Кнопка обновления с индикацией загрузки */}
              <ButtonImage onClick={refreshDataTable} title='Обновить'>
                {/* Применяем анимацию, если isLoading или isFetching (если isFetching есть в states) */}
                <img src={reloadImage_16} alt="Reload" height={16} width={16} className={isLoading ? styles.animationLoop : ""} />
              </ButtonImage>
              {/* Кнопка открытия модалки настроек */}
              <ButtonImage onClick={() => setConfigModalFormAction('open')} title="Настройки">
                <img src={settingsForm_16} alt="Settings" height={16} width={16} />
              </ButtonImage>
              <Divider />
              <ButtonImage onClick={() => setVisibleFieldSearchByPeriod(!visibleFieldSearchByPeriod)} active={visibleFieldSearchByPeriod} title="Календарь">
                <img src={calendar_16} alt="Calendar" height={16} width={16} />
              </ButtonImage>
              <ButtonImage onClick={() => setVisibleFastSearchField(!visibleFastSearchField)} active={visibleFastSearchField} title="Поиск">
                <img src={searchField_16} alt="Search" height={16} width={16} />
              </ButtonImage>
              <Divider />
            </div>

          </div>
          {(visibleFastSearchField || visibleFieldSearchByPeriod) &&
            <div className={styles.TablePanelRight}>
              {visibleFieldSearchByPeriod &&
                <FieldDateRange />
              }
              {visibleFastSearchField &&
                <FieldFastSearch />
              }
            </div>
          }

        </div>

        {/* Обертка для области таблицы, управляющая прокруткой */}
        <div className={styles.TableScrollWrapper}>
          {/* Компонент TableArea, содержащий саму таблицу (thead и tbody) */}
          <TableArea />
        </div>
      </div>
    </TableContextProvider >
  );
};



// --------------------- Sub component - TableArea -----------------------------------------

// Компонент-обертка для самой HTML-таблицы. Мемоизирован для оптимизации.
const TableArea = memo(() => {
  // Получаем состояние загрузки из контекста, если нужно влиять на рендер TableArea
  // const { states: { isLoading } } = useTableContextProps();
  const { columns } = useTableContextProps();
  const visibleColumns = useMemo(() => columns.filter(col => col.visible), [columns]);
  return (
    <table>
      <colgroup>
        <col style={{ width: '30px', maxWidth: '30px' }} />
        {visibleColumns.map((column: TColumn, idx: number) => {
          const columnWidth = (visibleColumns.length - 1) === idx ? "auto" : column.width;
          return (
            <col key={column.identifier} style={{ width: columnWidth, minWidth: column.width }} />
          );
        })}
      </colgroup>
      <TableHeader />
      <TableBody />
    </table>
  );
});

// --------------------- Sub component - TableHeader ---------------------------------------
// Компонент заголовка таблицы. Мемоизирован.
const TableHeader = memo(() => {
  // Получаем все необходимые данные из контекста
  const {
    columns, // Все колонки
    rows, // Текущие строки (для логики "выбрать все")
    isLoading,
    query: { queryParams, setQueryParams }, // Параметры запроса и функция их обновления
    states: { selectedRows, setSelectedRows, } // Состояние выделения и загрузки
  } = useTableContextProps();

  // Текущая колонка для сортировки и направление из queryParams
  const currentSortColumnID = queryParams?.sort?.columnID;
  const currentSortDirection = queryParams?.sort?.direction;

  // Определяем, выделены ли все строки на текущей странице.
  // Используем useMemo, так как rows или selectedRows могут быть большими.
  const isAllRowsSelected = useMemo(() => {
    // Если нет строк или строк для выделения, считаем, что "все" не выделены.
    if (!rows || rows.length === 0) {
      return false;
    }
    // Проверяем, что каждый ID строки из текущих rows присутствует в Set selectedRows.
    return rows.every(row => selectedRows.has(row.id as number));

  }, [rows, selectedRows]); // Зависимости: массив строк на текущей странице и Set выделенных строк.

  // Обработчик для чекбокса "выбрать все".
  const handleSelectAllRows = useCallback(() => {
    // Важно: обновляем состояние selectedRows на основе ПРЕДЫДУЩЕГО состояния (prevSelectedRows).
    setSelectedRows(prevSelectedRows => {
      const newSelectedRows = new Set(prevSelectedRows); // Создаем КОПИЮ текущего Set.

      if (isAllRowsSelected) {
        // Если сейчас выделены все, то снимаем выделение со всех строк на текущей странице.
        rows.forEach(row => newSelectedRows.delete(row.id as number));
      } else {
        // Если выделены не все, то добавляем в выделение все строки на текущей странице.
        rows.forEach(row => newSelectedRows.add(row.id as number));
      }
      return newSelectedRows; // Возвращаем НОВЫЙ Set для обновления состояния.
    });
  }, [isAllRowsSelected, rows, setSelectedRows]); // Зависимости: состояние "выбрать все", текущие строки и функция обновления selectedRows.

  // Обработчик клика по заголовку для сортировки. Мемоизирован.
  const handleSorting = useCallback(
    (columnID: string) => {
      // Обновляем параметры запроса, включая сортировку.
      setQueryParams({
        sort: {
          columnID,
          // Если кликнули по текущей сортируемой колонке И направление было 'asc',
          // меняем на 'desc', иначе меняем на 'asc' (или устанавливаем 'asc', если это новая колонка).
          direction: columnID === currentSortColumnID && currentSortDirection === "asc" ? "desc" : "asc",
        }
      });
    },
    [currentSortColumnID, currentSortDirection] // Зависимости: функция обновления queryParams и текущие значения сортировки.
  );

  // Получаем только видимые колонки для рендеринга. Мемоизируем.
  const visibleColumns = useMemo(() => columns.filter(column => column.visible), [columns]);

  return (
    <thead>
      <tr style={{ containerType: "size" }}>
        {/* Колонка с чекбоксом (фиксированная ширина) */}
        {/* Ширина должна быть задана в CSS стилях для thead th:first-child или tbody td:first-child */}
        <th style={{ whiteSpace: 'nowrap' }}>
          <div className={styles.TableHeaderCell} style={{ placeContent: 'center' }}>
            <input
              type="checkbox"
              style={{ height: '16px', width: '16px' }}
              onChange={handleSelectAllRows} // Используем мемоизированный обработчик
              checked={isAllRowsSelected} // Состояние чекбокса зависит от isAllRowsSelected
              disabled={isLoading || !rows || rows.length === 0} // Отключаем, если нет строк или идет загрузка
            />
          </div>
        </th>
        {/* Рендерим видимые колонки заголовка */}
        {visibleColumns.map((column: TColumn) => {
          // const autoWidth = (visibleColumns.length) === (idx + 1) ? "auto" : column.width;
          // CSS стили для ширины колонки должны быть в thead и tbody,
          // либо можно попробовать задать их здесь, но tbody.td могут переопределять
          // if ((visibleColumns.length + 1) === column.position) {
          //   console.log({ 'column.position': column.position, 'visibleColumns.length': visibleColumns.length });
          // }
          // const styleWidth = {
          //   width: column.minWidth, // Пример: задаем ширину из данных колонки
          //   minWidth: column.minWidth, // Пример: задаем минимальную ширину
          //   maxWidth: column.minWidth, // Пример: задаем максимальную ширину
          // };

          // Специальный рендеринг для boolean колонок (без сортировки в заголовке)
          if (column.type === "boolean") {
            return (
              <th key={column.identifier}> {/* Используем identifier как key */}
                {/* Оставляем пустой div или можно добавить иконку/текст, если нужно */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}></div>
              </th>
            );
          }

          // Рендеринг сортируемых колонок
          const isColumnSort = currentSortColumnID === column.identifier; // Активна ли сортировка по этой колонке
          const iconStyle = {
            justifySelf: "start", // Выравнивание иконки в конце flex-контейнера
            marginLeft: "0px", // Отступ слева от текста заголовка
            color: isColumnSort ? "#666" : "transparent", // Цвет иконки активной сортировки, прозрачный для неактивных
            transform: currentSortDirection === "asc" ? "none" : "scale(1,-1)", // Поворот иконки для 'desc'
            transition: 'transform 0.2s ease-in-out', // Плавный поворот
            display: 'flex', // Делаем div flex-элементом для justifySelf
            alignItems: 'center', // Центрируем содержимое div по вертикали
          };

          return (
            <th
              key={column.identifier} // Используем identifier как key для уникальности
              style={{ cursor: 'col-resize' }} // Добавляем указатель мыши для кликабельности
            >
              {/* Контейнер для текста заголовка и иконки сортировки */}
              <div
                className={styles.TableHeaderCell}
                onClick={() => handleSorting(column.identifier)} // Используем мемоизированный обработчик сортировки
              >
                <span>{getTranslateColumn(column)}</span> {/* Текст заголовка */}
                {
                  isColumnSort && (
                    <svg style={iconStyle} width="18" height="18" viewBox="8 4 8 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 8V10M12 14L9 11M12 14L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )
                }
              </div>
            </th>
          );
        })}


      </tr>
    </thead>
  );
})

// --------------------- Sub component - TableBody -------------------------------------------
// Компонент тела таблицы, рендерит строки. Мемоизирован.
const TableBody = memo(() => {
  // Получаем нужные данные из контекста
  const { columns, rows, isLoading } = useTableContextProps();

  // Получаем только видимые колонки для передачи в строки. Мемоизируем.
  const visibleColumns = useMemo(() => columns.filter(col => col.visible), [columns]);

  // Определяем общее количество видимых колонок + колонка чекбокса для colSpan в пустой строке.
  const totalVisibleColumns = visibleColumns.length + 1; // +1 для колонки чекбокса

  // Если данных нет и не идет загрузка, можно показать сообщение "Нет данных"
  if (!isLoading && (!rows || rows.length === 0)) {
    return (
      <tbody>
        <tr>
          {/* colspan равен общему количеству колонок, чтобы сообщение было по центру таблицы */}
          <td colSpan={totalVisibleColumns} style={{ textAlign: 'center', padding: '20px' }}></td>
        </tr>
      </tbody>
    );
  }

  // Применяем размытие и отключаем взаимодействие при загрузке через стили.
  // Класс blur5 применен к <table> в TableArea.
  // Отключение pointer-events можно сделать инлайн для строк, как сделано ниже,
  // или через CSS класс при isLoading.

  return (
    <tbody className={isLoading ? styles.blur5 : ''}>
      {/* Итерируемся по строкам данных */}
      {
        rows.map((row: TDataItem, index: number) =>
          // row.id используется как key для уникальности строк в списке.
          // Если row.id может быть undefined или null, убедитесь, что он приведен к числу или строке.
          // countID - это просто номер строки на текущей странице (для отображения).
          <TableBodyRow
            key={row.id ?? `row-${index}`} // Надежнее использовать fall-back key, если row.id может быть undefined
            countID={index + 1} // countID - это просто порядковый номер строки (начинается с 1)
            rowID={row.id as number} // Передаем id строки (предполагаем, что это число)
            columns={visibleColumns} // Передаем только видимые колонки
            row={row} // Передаем данные текущей строки
          />
        )
      }
      {/* Пустая строка для растягивания tbody, если строк меньше, чем высота TableScrollWrapper. */}
      {/* Нужна соответствующая CSS настройка height: 100% для table и tbody. */}
      {/* Colspan должно быть равно общему количеству отображаемых колонок, включая колонку чекбокса. */}
      <tr style={{ height: "100%" }}>
        <td colSpan={totalVisibleColumns}>
          {/* В этой ячейке может быть лоадер или просто пустота */}
          {isLoading && (
            // Если нужен индикатор загрузки в пустом пространстве
            <div style={{ textAlign: 'center', padding: '20px' }}></div>
          )}
        </td>
      </tr>
    </tbody >
  )
})

// --------------------- Sub component - TableBodyRow -----------------------------------------
type TypeTableBodyRowProps = {
  countID: number; // Номер строки на странице (для отображения, не key)
  rowID: number; // Уникальный ID строки из данных (используется как key в родительском компоненте, передается для логики)
  columns: TColumn[]; // Видимые колонки для этой строки
  row: TDataItem; // Данные текущей строки
}

// Компонент одной строки таблицы. Мемоизирован.
const TableBodyRow: FC<TypeTableBodyRowProps> = memo(({ countID, rowID, columns, row }) => {
  // Получаем необходимые данные и функции из контекста
  const {
    isLoading,
    states: { activeRow, setActiveRow, selectedRows, setSelectedRows }, // Состояние выделения, активности и загрузки
    actions: { openForm, refetch }, // Функции действий


    // query: { queryParams } // Если нужно access queryParams в строке
  } = useTableContextProps();

  const handleClkickRow = (uuid: string) => {

    return openForm ? openForm({ uuid, onSave: () => refetch(), onClose: () => alert("onClose") }) : null;
  }
  // const openForm = (id: string) => {
  //   addPane(<Form id={id} />)
  // }
  // Определяем, является ли текущая строка активной
  const isActiveRow = activeRow === rowID;
  // Определяем, выделена ли текущая строка (проверяем наличие rowID в Set из контекста)
  const isRowSelected = selectedRows.has(rowID);

  // Класс для ячеек в активной строке
  const cellClass = isActiveRow ? styles.TabFieldActive : ''; // Применяем стиль только для активной строки

  // Обработчик клика по чекбоксу в строке. Мемоизирован.
  const handleChangeSelectedRows = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation(); // Останавливаем всплытие события клика, чтобы не сработал onClick на tr
    const checked = event.target.checked;
    // Обновляем состояние selectedRows на основе ПРЕДЫДУЩЕГО состояния.
    setSelectedRows(prevSelectedRows => {
      const newSelectedRows = new Set(prevSelectedRows); // Создаем КОПИЮ текущего Set.
      if (checked) {
        newSelectedRows.add(rowID); // Добавляем ID строки в КОПИЮ Set.
      } else {
        newSelectedRows.delete(rowID); // Удаляем ID строки из КОПИИ Set.
      }
      return newSelectedRows; // Возвращаем НОВЫЙ Set для обновления состояния.
    });
  }, [rowID, setSelectedRows]); // Зависимости: id текущей строки и функция обновления selectedRows.

  // Обработчик клика по строке для установки ее активной. Мемоизирован.
  const handleSetActiveRow = useCallback(() => {
    // Устанавливаем активную строку, только если нет загрузки (чтобы избежать изменения activeRow во время обновления данных).
    if (setActiveRow && !isLoading) {
      setActiveRow(rowID);
    }
  }, [rowID, setActiveRow, isLoading]); // Зависимости: id строки, функция setActiveRow, состояние загрузки.

  return (
    <tr
      data-count-id={countID} // Дата-атрибут для порядкового номера
      data-row-id={rowID} // Дата-атрибут для уникального ID строки
      className={`${isActiveRow ? styles.ActiveRow : ''} ${isLoading ? styles.loadingRow : ''}`} // Добавляем классы для активной строки и состояния загрузки
      onClick={handleSetActiveRow} // Обработчик клика по всей строке
      // Инлайн стили для отключения кликов и изменения прозрачности во время загрузки
      style={{ ...(isLoading ? { opacity: 0.7, pointerEvents: 'none' } : {}) }}
    >
      {/* Ячейка с чекбоксом (фиксированная ширина) */}
      {/* Ширина должна быть задана в CSS стилях для tbody td:first-child */}
      <td>
        <div className={[styles.TableBodyCell, cellClass].join(" ")} style={{ placeContent: "center" }}>
          <input
            type="checkbox"
            style={{ height: "16px", width: "16px" }}
            checked={isRowSelected} // Состояние чекбокса зависит от isRowSelected
            onChange={handleChangeSelectedRows} // Используем мемоизированный обработчик для этой строки
            disabled={isLoading} // Отключаем чекбокс во время загрузки
          />
        </div>
      </td>
      {/* Ячейки с данными */}
      {columns.map(column => {
        // Получаем форматированное значение ячейки
        const value = getFormatColumnValue(row, column);

        // Получаем стили выравнивания текста для этой колонки
        const textAlignStyle = getTextAlignByColumnType(column);

        // Содержимое ячейки
        const content = (
          // Применяем cellClass (для активной строки) и стиль выравнивания текста
          <div style={textAlignStyle} className={[styles.TableBodyCell, cellClass].join(" ")}>
            <span>{value}</span>
          </div>
        );

        return (
          <td
            key={column.identifier} // Используем identifier колонки как key для уникальности ячейки в строке
            onDoubleClickCapture={() => handleClkickRow(row.uuid)} // Открываем форму контракта по двойному клику <ContractForm {mode="view"} id={rowID} />
            style={{
              // Ширина ячейки (колонки). Должна совпадать с шириной th в thead.
              // Лучше задавать ширину в CSS классах или в tbody td, но инлайн тоже работает.
              // width: column.width,
              // minWidth: column.minWidth,
              // Можно добавить правила overflow/text-overflow в CSS для .TableBodyCell
              // overflow: 'hidden',
              // textOverflow: 'ellipsis',
              // whiteSpace: 'nowrap', // Если не нужен перенос текста
            }}
          // Убрал onClick с td, т.к. клик по tr обрабатывается для активации строки.
          // Если нужна кликабельность отдельных ячеек, логика будет сложнее.
          >
            {/* Рендерим содержимое ячейки. Для boolean может быть специальный рендеринг. */}
            {column.type === "boolean" ? (
              // Специальное отображение для boolean, если нужно (например, иконка)
              // Сейчас рендерится пустой div с нужными классами/стилями
              <div className={[styles.TableBodyCell, cellClass].join(" ")} style={textAlignStyle} />
            ) : content}
          </td>
        );
      })}
    </tr>
  );
});


// --------------------- Modal Components -----------------------------------------

// Компонент модального окна для конфигурации колонок таблицы.
// Принимает props `method` для управления видимостью модалки.
const TableConfigModalForm: FC<TypeModalFormProps> = ({ method }) => {
  // Получаем нужные данные и функции из контекста
  const { columns, componentName, actions } = useTableContextProps();
  // Получаем функцию setColumns из actions, проверяем ее наличие.
  const setColumnsAction = actions?.setColumns;

  // Внутреннее состояние модалки для управления порядком и видимостью колонок ПЕРЕД сохранением.
  const [columnsConfig, setColumnsConfig] = useState<TColumn[]>(columns);

  // Обработчик кнопки "Применить" в модалке. Мемоизирован.
  const onApply = useCallback(() => {
    // Сохраняем конфигурацию в Local Storage (ваш код)
    localStorage.setItem(componentName, JSON.stringify(columnsConfig));
    // Вызываем функцию setColumns из actions, если она существует,
    // чтобы обновить состояние колонок в родительском компоненте (Table).
    if (setColumnsAction) {
      setColumnsAction(columnsConfig);
    }
  }, [columnsConfig, componentName, setColumnsAction]); // Зависимости: текущая конфигурация колонок, model (имя таблицы), и функция setColumnsAction.


  // При монтировании модалки, синхронизируем ее внутреннее состояние с текущими колонками из контекста.
  // Это гарантирует, что при повторном открытии модалки отображаются актуальные настройки.
  useEffect(() => {
    setColumnsConfig(columns);
  }, [columns]); // Зависимость от columns из контекста.


  return (
    // Компонент Modal (убедитесь, что он правильно обрабатывает пропс method)
    <Modal title="Настройки таблицы" method={method} onApply={onApply} style={{ width: '400px' }}>
      {/* Группа или контейнер для списка колонок */}
      <Group align='row' type="easy"> {/* Используйте ваш компонент Group */}
        {/* Компонент для отображения и управления списком колонок */}
        <TableConfigColumns columns={columnsConfig} setColumns={setColumnsConfig} />
      </Group>
    </Modal>
  );
};

// Типы пропсов для компонента TableConfigColumns
type TypeTableConfigColumnsProps = {
  columns: TColumn[]; // Текущая конфигурация колонок (внутреннее состояние модалки)
  setColumns: Dispatch<SetStateAction<TColumn[]>>; // Функция для обновления этой конфигурации
};
// Компонент для отображения списка колонок и их перетаскивания/видимости.
const TableConfigColumns: FC<TypeTableConfigColumnsProps> = ({ columns, setColumns }) => {
  // Состояние для отслеживания ID перетаскиваемого элемента (для стилей)
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Обработчик изменения видимости колонки. Мемоизирован.
  const updateColumnVisibility = useCallback((identifier: string, visible: boolean) => {
    // Обновляем массив колонок, меняя свойство visible для колонки с заданным identifier.
    // Используем функциональное обновление setColumns для доступа к предыдущему состоянию.
    setColumns(prev =>
      prev.map(col => col.identifier === identifier ? { ...col, visible } : col)
    );
  }, [setColumns]); // Зависимость от setColumns (функция обновления состояния).
  // Обработчик изменения фильтрации колонки. Мемоизирован.
  // const updateColumnFilter = useCallback((identifier: string, filter: boolean) => {
  //   // Обновляем массив колонок, меняя свойство filter для колонки с заданным identifier.
  //   setColumns(prev =>
  //     prev.map(col => col.identifier === identifier ? { ...col, filter } : col)
  //   );
  // }, [setColumns]); // Зависимость от setColumns (функция обновления состояния).

  // Обработчик начала перетаскивания. Мемоизирован.
  const onDragStart = useCallback((event: any) => { // event: Active object из dnd-kit
    setDraggingId(String(event.active.id)); // Устанавливаем ID перетаскиваемого элемента (преобразуем в строку)
  }, []); // Нет зависимостей, так как не использует внешние переменные.

  // Обработчик окончания перетаскивания. Мемоизирован.
  const onDragEnd = useCallback((event: any) => { // event: DragEndEvent object из dnd-kit
    const { active, over } = event; // active - перетаскиваемый элемент, over - элемент под ним

    setDraggingId(null); // Сбрасываем состояние перетаскивания

    // Если элемент был перетащен на другое место (over существует и id отличается)
    if (active.id !== over?.id) {
      setColumns((prev) => {
        // Находим индексы перетаскиваемого и целевого элементов
        const oldIndex = prev.findIndex((col) => col.identifier === active.id);
        const newIndex = prev.findIndex((col) => col.identifier === over?.id);
        // Используем утилиту arrayMove из dnd-kit/sortable для перестановки элементов в массиве
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, [setColumns]); // Зависимость от setColumns (функция обновления состояния).

  // Создаем массив ID колонок для SortableContext. Мемоизируем.
  // Dnd-kit использует эти ID для отслеживания элементов.
  const dndItems = useMemo(() => columns.map(col => col.identifier), [columns]);


  return (
    <>
      <div className={styles.TableConfigListHeader}>
        <div className={styles.TableConfigListHeaderTitle}>Видимость</div>
        {/* <div className={styles.TableConfigListHeaderTitle}>Фильтр</div> */}
      </div>
      {/* Обертка DndContext для включения функциональности перетаскивания */}
      <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} onDragStart={onDragStart}>
        {/* SortableContext для указания элементов, которые можно сортировать */}
        {/* items - массив ID элементов, strategy - стратегия сортировки */}
        <SortableContext items={dndItems} strategy={verticalListSortingStrategy}>
          {/* Список элементов (колонки) */}
          <ul className={styles.CheckboxList}>
            {/* Итерируемся по колонкам для рендеринга сортируемых элементов */}
            {columns.filter(column => column.inlist).map((column) => (
              <TableConfigColumnsItem
                key={column.identifier} // key для React list рендеринга
                column={column} // Данные колонки
                isDragging={column.identifier === draggingId} // Передается для применения стилей перетаскивания
                toggleVisibility={updateColumnVisibility} // Передается обработчик изменения видимости
              // toggleFilter={updateColumnFilter}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </>
  );
};

// Типы пропсов для компонента TableConfigColumnsItem
type TypeTableConfigColumnsItemProps = {
  column: TColumn; // Данные текущей колонки
  isDragging: boolean; // Флаг: перетаскивается ли эта колонка сейчас
  toggleVisibility: (identifier: string, visible: boolean) => void; // Функция для изменения видимости
  // toggleFilter: (identifier: string, filter: boolean) => void;
};
// Компонент одного элемента списка колонки в модалке. Мемоизирован.
const TableConfigColumnsItem: FC<TypeTableConfigColumnsItemProps> = memo(({ column, isDragging, toggleVisibility }) => {
  // Хук useSortable из dnd-kit предоставляет свойства и рефы для сортируемого элемента.
  // id должен совпадать с элементом в массиве items в SortableContext.
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: column.identifier });

  // Применяем стили для перетаскивания (положение и анимация)
  const style = {
    transform: CSS.Transform.toString(transform), // Преобразуем объект transform в строку CSS
    transition, // Применяем transition
  };

  // Обработчик изменения чекбокса видимости. Мемоизирован.
  const handleVisibilityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Вызываем функцию из пропсов для обновления видимости колонки.
    toggleVisibility(column.identifier, e.target.checked);
  }, [column.identifier, toggleVisibility]); // Зависимости: identifier колонки и функция toggleVisibility из пропсов.

  // Обработчик изменения чекбокса фильтрации. Мемоизирован.
  // const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  //   // Вызываем функцию из пропсов для обновления фильтрации колонки.
  //   toggleFilter(column.identifier, e.target.checked);
  // }, [column.identifier, toggleFilter]); // Зависимости: identifier колонки и функция toggleFilter из пропсов.

  return (
    // Привязываем setNodeRef к корневому элементу списка (<li>)
    // Применяем стили перетаскивания
    // Добавляем класс 'dragging', если элемент перетаскивается
    <li ref={setNodeRef} style={style} className={`${styles.ListItem} ${isDragging ? styles.dragging : ''}`}>
      {/* Элемент для захвата мышью (draggable handle).
          listener из useSortable привязывается сюда.
          attributes также привязываются сюда для доступности. */}
      <div {...listeners} {...attributes} className={styles.DragAndDrop} title="Переместить">
        {/* Иконка для перетаскивания */}
        <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
      </div>
      {/* Чекбокс видимости колонки */}
      <div className={styles.CheckboxWrapper}>
        <input
          type="checkbox"
          id={`column-visibility-${column.identifier}`} // Уникальный ID для чекбокса
          checked={column.visible} // Состояние чекбокса
          onChange={handleVisibilityChange} // Обработчик изменения
        />
        {/* Метка для чекбокса (для доступности и возможности клика по тексту) */}
        <label htmlFor={`column-visibility-${column.identifier}`}>{getTranslateColumn(column)}</label>
      </div>
      {/* <div className={styles.CheckboxWrapper} style={{ width: "fit-content", marginRight: "6px" }}>
        <input
          type="checkbox"
          id={`column-visibility1-${column.identifier}`} // Уникальный ID для чекбокса
          checked={column.filter} // Состояние чекбокса
        // onChange={handleFilterChange} // Обработчик изменения
        />
      </div> */}
    </li>
  );
});

// --------------------- END Modal Components ---------------------------------------------

export default Table; 