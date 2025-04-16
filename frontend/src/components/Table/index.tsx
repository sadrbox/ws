import { useState, FC, useEffect, useCallback, useMemo, createContext, SetStateAction, Dispatch, useContext, PropsWithChildren, memo, useDeferredValue } from 'react';
import styles from './Table.module.scss';
import { SlSettings } from "react-icons/sl";
import { TbFilter } from "react-icons/tb";
import { TColumn, TDataItem, TypeModelProps, TypeTableContextProps } from './types';
import { SlRefresh } from "react-icons/sl";
import { getTranslateColumn } from 'src/i18';
import { getFormatColumnValue, getTextAlignByColumnType } from './services';
import { Divider, FieldGroup, PeriodField, SearchField } from '../Field';
import Modal from '../Modal';
import { FieldString, FieldSelect } from '../Field/index';
import filterImage from '../../assets/filter_16.png';
import settingsForm from '../../assets/settingsForm_16.png';
import reloadImage from '../../assets/reload_16.png';
import { CSS } from "@dnd-kit/utilities";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PiDotsThreeVerticalDuotone } from 'react-icons/pi';
// import { useAppContext } from 'src/components/app/AppContextProvider';




// --------------------- Root component - Table -----------------------------------------
type TypeTableProps = {
  props: TypeModelProps;
};
const Table: FC<TypeTableProps> = ({ props }) => {
  const { name, rows, columns, pagination: { currentPage, setCurrentPage, totalPages }, actions: { loadDataGrid }, states } = props;
  const [checkedRows, setCheckedRows] = useState<number[]>([]);
  const [isAllChecked, setIsAllChecked] = useState<boolean>(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [filterModalFormIsOpen, setFilterModalFormIsOpen] = useState<boolean>(false);
  const [configModalFormIsOpen, setConfigModalFormIsOpen] = useState<boolean>(false);

  // const [currentPage, setCurrentPage] = useState<number>(1);
  // const [totalPages, setTotalPages] = useState<number>(1);

  // Используем useDeferredValue для отсрочки обновлений inputValue
  const deferredValueCurrentPage = useDeferredValue(currentPage);

  useEffect(() => {
    setCheckedRows(isAllChecked ? rows.map(row => row.id as number) : []);
  }, [isAllChecked, rows]);

  const allChecked = useMemo(() => {
    const allIDs = rows.map(row => row.id as number);
    return checkedRows.length === allIDs.length && allIDs.length > 0;
  }, [checkedRows, rows]);

  useEffect(() => setIsAllChecked(allChecked), [allChecked]);
  useEffect(() => {

    if (loadDataGrid && !configModalFormIsOpen) loadDataGrid(currentPage)

  }, [configModalFormIsOpen])

  const refreshDataTable = () => loadDataGrid && loadDataGrid(currentPage);

  const handlerChangeCurrentPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPage = Math.max(1, Math.min(Number(e.target.value), totalPages)); // Ограничиваем от 1 до totalPages
    setCurrentPage(newPage);
  };
  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages))); // Переход к странице с ограничениями
  };

  const contextProps = useMemo<TypeTableContextProps>(() => ({
    name,
    rows,
    columns,
    pagination: {
      currentPage,
      totalPages,
    },
    states: {
      ...states,
      checkedRows,
      setCheckedRows,
      isAllChecked,
      setIsAllChecked,
      activeRow,
      setActiveRow,

    },
  }), [name, rows, columns, states, checkedRows, isAllChecked, activeRow]);


  return (
    <TableContextProvider init={contextProps}>
      {filterModalFormIsOpen && <TableFilterModalForm isOpen={filterModalFormIsOpen} onClose={() => setFilterModalFormIsOpen(false)} />}
      {configModalFormIsOpen && <TableConfigModalForm isOpen={configModalFormIsOpen} onClose={() => setConfigModalFormIsOpen(false)} />}
      <div className={styles.TableWrapper}>
        <div className={styles.TablePanel}>
          <div className={[styles.colGroup, styles.gap6].join(" ")}>
            <button className={styles.Button}>
              <span>Добавить</span>
            </button>
            <button className={styles.Button}>
              <span>Удалить</span>
            </button>
          </div>
          <div className={[styles.colGroup, styles.gap6].join(" ")}>
            <div className={[styles.colGroup, styles.gap6].join(" ")} style={totalPages <= 1 ? { display: "none" } : {}}>
              <Divider />

              {/* <button
              className={styles.Button}
              onClick={() => setCurrentPage((prevPage) => Math.max(prevPage - 1, 1))}
              disabled={currentPage === 1}>
              <svg style={{ transform: "rotate(90deg)" }} width="18" height="18" viewBox="8 4 8 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 8V10M12 14L9 11M12 14L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button> */}
              <div className={styles.colGroup} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 0px" }}>Страница:</div>
              <div className={styles.PaginationPages}>
                <input
                  type="number"
                  value={deferredValueCurrentPage}
                  onChange={handlerChangeCurrentPage}
                  onBlur={() => goToPage(deferredValueCurrentPage)}
                  min={1}
                  max={totalPages}

                />
              </div>
              {/* <span>{totalPages}</span> */}
              {/* <button
              style={{ marginLeft: "6px" }}
              className={styles.Button}
              onClick={() => setCurrentPage((prevPage) => Math.min(prevPage + 1, totalPages))} disabled={currentPage === totalPages}>
              <svg style={{ transform: "rotate(-90deg)" }} width="18" height="18" viewBox="8 4 8 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 8V10M12 14L9 11M12 14L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button> */}
            </div>
            <Divider />
            <button onClick={refreshDataTable} className={styles.ButtonImage} title='Обновить'>
              <img src={reloadImage} alt="ten" height={16} width={16} className={(states?.isLoading === true) ? styles.animationLoop : ""} />
              {/* <SlRefresh
                className={(states?.isLoading === true) ? styles.animationLoop : ""}
                size={14}
                strokeWidth={30}
              /> */}
              {/* <span>Обновить</span> */}
            </button>
            <button onClick={() => setConfigModalFormIsOpen(true)} className={styles.ButtonImage} title="Настройки">
              <img src={settingsForm} alt="ten" height={16} width={16} />
              {/* <SlSettings size={16} strokeWidth={5} /> */}
            </button>
            <button onClick={() => setFilterModalFormIsOpen(true)} className={styles.ButtonImage} title="Фильтр">
              {/* <TbFilter size={17} strokeWidth={2} /> */}
              <img src={filterImage} alt="ten" height={16} width={16} />
            </button>
            <Divider />
            <SearchField />

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

const TableArea = () => {
  const { states: { isLoading } } = useTableContextProps();

  return (
    <table>
      <TableHeader />
      <TableBody />
      {/* <DataTableTabFooter /> */}
    </table>
  );
};

// --------------------- Sub component - TableHeader -----------------------------------------
const TableHeader = memo(() => {
  const tableContext = useTableContextProps();

  const {
    columns,
    states: { setOrder, order }
  } = tableContext;

  const { columnID, direction } = order;

  const handleSorting = useCallback(
    (columnID: string) => {
      if (!setOrder) return; // Проверяем, что setOrder определен
      setOrder((prev) => ({
        columnID,
        direction: prev.columnID === columnID && prev.direction === "asc" ? "desc" : "asc",
      }));
    },
    [setOrder]
  );

  return (
    <thead>
      <tr>
        {columns
          .map((column: TColumn, keyID: number) => {
            const styleWidth = {
              width: column.width,
              ...(column.type !== "string" && { minWidth: column.width }),
            };

            if (column.type === "boolean") {
              return (
                <th key={keyID} style={styleWidth}>
                  <div style={{ justifyItems: "center" }}></div>
                </th>
              );
            }

            const isActive = columnID === column.identifier;
            const iconStyle = {
              justifySelf: "end",
              marginLeft: "10px",
              color: isActive ? "#666" : "transparent",
              transform: direction === "asc" ? "none" : "scale(1,-1)",
            };

            return (
              <th
                key={keyID}
                style={{ ...styleWidth }} // Добавил указатель
                onClick={() => handleSorting(column.identifier)}
              >
                <div className={styles.TableHeaderColumn}>
                  <span>{getTranslateColumn(column)}</span>
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
  const { columns, rows, states: { isLoading } } = useTableContextProps();
  return (
    <tbody className={isLoading ? styles.blur5 : ""}>
      {rows.map((row: TDataItem, key: number) =>
        <TableBodyRow key={key} countID={key + 1} rowID={row.id} columns={columns} row={row} />
      )}
      <tr style={{ height: "100%" }}><td colSpan={columns.length}></td></tr>
    </tbody>
  )
})

// --------------------- Sub component - TableBodyRow -----------------------------------------
type TypeTableBodyRowProps = {
  countID: number;
  rowID: number;
  columns: TColumn[];
  row: TDataItem;
  // loading: boolean;
  // states: {
  //   activeRow: number | null, setActiveRow: Dispatch<SetStateAction<number | null>>
  // }
}

const TableBodyRow: FC<TypeTableBodyRowProps> = memo(({ countID, rowID, columns, row }) => {
  const tableContext = useTableContextProps();
  const { states: { activeRow, setActiveRow, isLoading } } = tableContext;

  const handlerSetActiveRow = useCallback((rowID: number) => {
    if (setActiveRow && !isLoading) {
      setActiveRow(rowID);
    }
  }, [setActiveRow, isLoading]);

  const isActiveRow = (rowID: number) => activeRow === rowID;

  return (
    <tr
      data-count-id={countID}
      data-row-id={rowID}
      onClick={() => handlerSetActiveRow(rowID)}
    >
      {columns.map((column: TColumn, columnIndex: number) => {
        const value = getFormatColumnValue(row, column);
        const cellClass = isActiveRow(rowID) ? styles.TabFieldActive : styles.TableBodyColumn;

        const content = (
          <div style={getTextAlignByColumnType(column)} className={cellClass}>
            <span>{value}</span>
          </div>
        );

        switch (column.type) {
          case "boolean":
            return (
              <td key={columnIndex} style={{ width: column.width, maxWidth: column.width }}>
                <div className={cellClass}></div>
              </td>
            );

          case "string":
          case "number":
          case "object":
          case "date":
            return (
              <td key={columnIndex} onClick={() => handlerSetActiveRow(rowID)}>
                {content}
              </td>
            );

          default:
            return (
              <td key={columnIndex} onClick={() => handlerSetActiveRow(rowID)}>
                {content}
              </td>
            );
        }
      })}
    </tr>
  );
})

// --------------------- Context Provider - TableContextProvider ------------------------------
type TypeTableContextInstance = {
  tableContextProps: TypeTableContextProps;
  setTableContextProps: Dispatch<SetStateAction<TypeTableContextProps>>;
};

const TableContextInstance = createContext<TypeTableContextInstance | undefined>(undefined);
const TableContextProvider: React.FC<PropsWithChildren<{ init: TypeTableContextProps }>> = ({
  children,
  init,
}) => {
  const [tableContextProps, setTableContextProps] = useState<TypeTableContextProps>(init);

  useEffect(() => {
    if (init !== tableContextProps) {
      setTableContextProps(init);
    }
  }, [init]);

  return (
    <TableContextInstance.Provider value={{ tableContextProps, setTableContextProps }}>
      {children}
    </TableContextInstance.Provider>
  );
};

// --------------------- Hook - useTableContextProps -----------------------------------------
export const useTableContextProps = () => {
  const context = useContext(TableContextInstance);
  if (!context) {
    throw new Error("useDataTableContext must be used within DataTableContextProvider");
  }
  return { ...context.tableContextProps };
};

type TypeModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const TableFilterModalForm: FC<TypeModalProps> = ({ isOpen, onClose }) => {

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Настройки фильтра" onSubmit={(values) => console.log('Фильтры:', values)}>
      <div className={styles.rowGroup}>
        <FieldString label="Название" name="name" />
        <FieldString label="Название" name="name" />
        <FieldSelect label="Тип" name="type" options={[{ value: 'string', label: 'Строка' }, { value: 'number', label: 'Число' }, { value: 'date', label: 'Дата' }]} />
        <FieldString label="Название" name="name" />
        <FieldString label="Название" name="name" />
      </div>

    </Modal>
  );
};

const TableConfigModalForm: FC<TypeModalProps> = ({ isOpen, onClose }) => {

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Настройки таблицы" onSubmit={(values) => console.log('Фильтры:', values)}>
      <TableConfigColumns />
    </Modal>
  );
};


const TableConfigColumns = () => {
  const context = useTableContextProps();
  const { columns, name } = context;
  const [gridColumns, setGridColumns] = useState<TColumn[]>(columns);
  const [draggingId, setDraggingId] = useState<string | null>(null);


  useEffect(() => {
    // console.log(gridColumns)
    localStorage.setItem(name, JSON.stringify(gridColumns));
  }, [gridColumns]);

  const updateColumnVisibility = (identifier: string, visible: boolean) => {
    setGridColumns(prev =>
      prev.map(col => col.identifier === identifier ? { ...col, visible } : col)
    );
  };

  const onDragStart = (event: any) => {
    setDraggingId(event.active.id); // Запоминаем ID перетаскиваемого элемента
  };

  const onDragEnd = (event: any) => {
    const { active, over } = event;
    setDraggingId(null);
    if (active.id !== over?.id) {
      setGridColumns((prev) => {
        const oldIndex = prev.findIndex((col) => col.identifier === active.id);
        const newIndex = prev.findIndex((col) => col.identifier === over?.id);
        // console.log({ oldIndex, newIndex })
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };




  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} onDragStart={onDragStart}>
      <SortableContext items={gridColumns.map(col => col.identifier)} strategy={verticalListSortingStrategy}>
        <ul className={styles.CheckboxList}>
          {[...gridColumns].map((column) => (
            <TableConfigColumns.Item
              key={column.identifier}
              column={column}
              isDragging={column.identifier === draggingId}
              toggleVisibility={updateColumnVisibility} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
};

type TypeTableConfigColumnsItem = {
  column: TColumn,
  isDragging: boolean;
  toggleVisibility: (identifier: string, visible: boolean) => void;
};

const TableConfigColumnsItem: FC<TypeTableConfigColumnsItem> = ({ column, isDragging, toggleVisibility }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: column.identifier });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };


  return (
    <li ref={setNodeRef} style={style} className={`${styles.ListItem} ${isDragging ? styles.dragging : ''}`}>
      <div {...listeners} className={styles.DragAndDrop}>
        <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
      </div>
      <input
        {...attributes}
        type="checkbox"
        id={`${column.identifier}`}
        checked={column.visible}
        onChange={(e) => toggleVisibility(column.identifier, e.target.checked)} />
      <label htmlFor={`${column.identifier}`}>{getTranslateColumn(column)}</label>
    </li>
  );
};
TableConfigColumns.Item = TableConfigColumnsItem;
