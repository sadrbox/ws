import { useState, FC, useEffect, useCallback, useMemo, createContext, SetStateAction, Dispatch, useContext, PropsWithChildren, memo, useDeferredValue } from 'react';
import styles from './Table.module.scss';
import { TColumn, TDataItem, TypeDateRange, TypeFormAction, TypeFormMethod, TypeModelProps, TypeTableContextProps } from './types';
import { getTranslateColumn } from 'src/i18';
import { getFormatColumnValue, getTextAlignByColumnType } from './services';
import { Divider, FieldAutocomplete, FieldDateRange, FieldFastSearch } from '../Field';
import Modal from '../Modal';
import { FieldSelect } from '../Field/index';
import filterImage from '../../assets/filter_16.png';
import settingsForm from '../../assets/settingsForm_16.png';
import reloadImage from '../../assets/reload_16.png';
import { CSS } from "@dnd-kit/utilities";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PiDotsThreeVerticalDuotone } from 'react-icons/pi';
// import { useAppContext } from 'src/components/app/AppContextProvider';
import React from 'react';
import useUID from 'src/hooks/useUID';
import { Group, HorizontalLine, OverForm } from 'src/app/DesignSystem';


// --------------------- Root component - Table -----------------------------------------
type TypeTableProps = {
  props: TypeModelProps;
};
const Table: FC<TypeTableProps> = ({ props }) => {
  const { name, rows, columns, pagination: { currentPage, setCurrentPage, totalPages }, query, actions: { loadDataGrid }, states } = props;
  // const [checkedRows, setCheckedRows] = useState<number[]>([]);
  // const [isAllChecked, setIsAllChecked] = useState<boolean>(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  // const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [configModalFormAction, setConfigModalFormAction] = useState<TypeFormAction>('');
  // const [dateRange, setDateRange] = useState<TypeDateRange>({ startDate: null, endDate: null });
  const deferredValueCurrentPage = useDeferredValue(currentPage);


  useEffect(() => {
    setActiveRow(null)
  }, [configModalFormAction === 'apply', query?.dateRangeQuery, currentPage, query?.fastSearchQuery])

  // useEffect(() => { setCheckedRows(isAllChecked ? rows.map(row => row.id as number) : []); }, [isAllChecked, rows]);
  // const allChecked = useMemo(() => {
  //   const allIDs = rows.map(row => row.id as number);
  //   return checkedRows.length === allIDs.length && allIDs.length > 0;
  // }, [checkedRows, rows]);

  // useEffect(() => setIsAllChecked(allChecked), [allChecked]);

  useEffect(() => {
    if (configModalFormAction === 'apply') {
      loadDataGrid(1)
      setConfigModalFormAction('')
    }
  }, [configModalFormAction])

  // useEffect(() => { }, [selectedRows])
  // useEffect(() => states?.setDateRangeQuery(dateRange), [dateRange])
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
      setCurrentPage,
      totalPages,
    },
    query,
    actions: { loadDataGrid },
    states: {
      ...states,
      // isSelectedRows,
      // setIsSelectedRows,
      // selectedRows,
      // setSelectedRows,
      activeRow,
      setActiveRow
      // setSelectedRowsQuery,
      // filterSearch, setFilterSearch

    },
  }), [name, rows, columns, states, activeRow]);
  return (<TableContextProvider init={contextProps}>
    {/* {filterModalFormAction === 'open' && <TableFilterModalForm method={{ get: filterModalFormAction, set: setFilterModalFormAction }} />} */}
    {configModalFormAction === 'open' && <TableConfigModalForm method={{ get: configModalFormAction, set: setConfigModalFormAction }} />} <div className={styles.TableWrapper}>
      <div className={styles.TablePanel}>
        <div className={[styles.colGroup, styles.gap6].join(" ")}>
          <button className={styles.Button}>
            <span>Добавить</span>
          </button>
          <button className={styles.Button}>
            <span>Удалить</span>
          </button>
          <Divider />
          <button onClick={refreshDataTable} className={styles.ButtonImage} title='Обновить'>
            <img src={reloadImage} alt="ten" height={16} width={16} className={(states?.isLoading === true) ? styles.animationLoop : ""} />
          </button>
          <button onClick={() => setConfigModalFormAction('open')} className={styles.ButtonImage} title="Настройки">
            <img src={settingsForm} alt="ten" height={16} width={16} />
            {/* <SlSettings size={16} strokeWidth={5} /> */}
          </button>

        </div>
        <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ flex: '1', justifyContent: 'flex-end' }}>
          <div className={[styles.colGroup, styles.gap6].join(" ")} style={totalPages <= 1 ? { display: "none" } : {}}>
            <Divider />


            <div className={styles.colGroup} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 0px" }}>Страница:</div>
            <div className={styles.PaginationPages}>
              <input type="number"
                value={deferredValueCurrentPage}
                onChange={handlerChangeCurrentPage}
                onBlur={() => goToPage(deferredValueCurrentPage)}
                min={1}
                max={totalPages}

              />
            </div>

          </div>
          <Divider />
          <div className={styles.colGroup} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 0px" }}>Период:</div>
          <FieldDateRange />
          <Divider />
          <FieldFastSearch />

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
  // const { states: { isLoading } } = useTableContextProps();

  return (
    <table>
      <TableHeader />
      <TableBody />
      {/* <DataTableTabFooter /> */}
    </table>
  );
};

// --------------------- Sub component - TableHeader ---------------------------------------
const TableHeader = memo(() => {
  const TABLE_CONTEXT_PROPS = useTableContextProps();

  const {
    columns,
    query: { orderQuery, setOrderQuery },
    states: { isSelectedRows, toggleSelectAllRows }
  } = TABLE_CONTEXT_PROPS;

  const { columnID, direction } = orderQuery;


  const handleSorting = useCallback(
    (columnID: string) => {
      if (!setOrderQuery) return; // Проверяем, что setOrder определен
      setOrderQuery((prev) => ({
        columnID,
        direction: prev.columnID === columnID && prev.direction === "asc" ? "desc" : "asc",
      }));
    },
    [setOrderQuery]
  );

  return (
    <thead>
      <tr>
        <th style={{ width: '25px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input type="checkbox" className={styles.TableHeaderColumn} onChange={() => toggleSelectAllRows} checked={isSelectedRows} />
          </div>
        </th>
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
  const TABLE_CONTEXT_PROPS = useTableContextProps();
  const { states: { activeRow, setActiveRow, isLoading, selectedRows, setSelectedRows } } = TABLE_CONTEXT_PROPS;

  const handleChangeSelectedRows = (rowID: number) => {
    const isSelected = selectedRows.includes(rowID);
    if (isSelected) {
      setSelectedRows(prev => prev.filter(id => id !== rowID));
    } else {
      setSelectedRows(prev => [...prev, rowID]);
    }
  };

  const handleSetActiveRow = useCallback((rowID: number) => {
    if (setActiveRow && !isLoading) {
      setActiveRow(rowID);
    }
  }, [setActiveRow, isLoading]);

  const isActiveRow = (rowID: number) => activeRow === rowID;

  // console.log(selectedRows)
  return (
    <tr
      data-count-id={countID}
      data-row-id={rowID}
      onClick={() => handleSetActiveRow(rowID)}
    >
      <td>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <input type="checkbox" className={styles.TableBodyColumn} onChange={() => handleChangeSelectedRows(rowID)} checked={selectedRows.includes(rowID)} />
        </div>
      </td>
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
              <td key={columnIndex} onClick={() => handleSetActiveRow(rowID)}>
                {content}
              </td>
            );

          default:
            return (
              <td key={columnIndex} onClick={() => handleSetActiveRow(rowID)}>
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
  method: TypeFormMethod;
};

const TableConfigModalForm: FC<TypeModalProps> = ({ method }) => {
  const { columns, name } = useTableContextProps()
  const [columnsConfig, setColumnsConfig] = useState<TColumn[]>(columns);

  const onApply = () => {
    localStorage.setItem(name, JSON.stringify(columnsConfig));
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
  // const { columns, name } = useTableContextProps();
  // const [gridColumns, setGridColumns] = useState<TColumn[]>(columns);
  const [draggingId, setDraggingId] = useState<string | null>(null);


  // useEffect(() => {
  //   // console.log(gridColumns)
  //   localStorage.setItem(name, JSON.stringify(gridColumns));
  // }, [gridColumns]);

  const updateColumnVisibility = (identifier: string, visible: boolean) => {
    setColumns(prev =>
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
      setColumns((prev) => {
        const oldIndex = prev.findIndex((col) => col.identifier === active.id);
        const newIndex = prev.findIndex((col) => col.identifier === over?.id);
        // console.log({ oldIndex, newIndex })
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };




  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} onDragStart={onDragStart}>
      <SortableContext items={columns.map(col => col.identifier)} strategy={verticalListSortingStrategy}>
        <ul className={styles.CheckboxList}>
          {[...columns].map((column) => (
            <TableConfigColumnsItem
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



