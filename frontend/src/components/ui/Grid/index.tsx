import { useState, FC, useEffect, useMemo } from 'react';
import { EActiveGrid, TDataGridContext, TModelProps } from './types';
import DataGrid from './DataGrid/index';
import styles from './styles.module.scss';
import DataGridContextProvider from './DataGrid/DataGridContextProvider';
import { SlSettings } from "react-icons/sl";
import { TbFilter } from "react-icons/tb";
import ConfigGrid from './ConfigGrid';

type TProps = {
  props: TModelProps;
};

const Grid: FC<TProps> = ({ props: { name, rows, columns, actions: { loadDataGrid }, states } }) => {
  const [activeGrid, setActiveGrid] = useState<EActiveGrid>(EActiveGrid.DATA);

  // Состояния для выбранных строк и активной строки
  const [checkedRows, setCheckedRows] = useState<number[]>([]);
  const [isAllChecked, setIsAllChecked] = useState<boolean>(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);

  // // Локальное состояние сортировки строк
  // const [orderRows, setOrderRows] = useState<TOrder>({
  //   columnID: order.columnID || 'id',
  //   direction: order.direction || 'asc',
  // });

  // Мемоизация отсортированных строк
  // const orderedRows = useMemo(() => orderGridRows(rows, order) || [], [rows, order]);

  // Мемоизация контекста для провайдера
  const initialContext = useMemo<TDataGridContext>(() => {
    return {
      name,
      rows,
      columns,
      actions: {
        loadDataGrid,
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
    } as TDataGridContext;
  }, [checkedRows, isAllChecked, activeRow]);

  // Обновление состояния выбранных строк при изменении `isAllChecked`
  useEffect(() => {
    if (isAllChecked) {
      setCheckedRows(rows.map((row) => row.id as number));
    } else {
      setCheckedRows([]);
    }
  }, [isAllChecked, rows]);

  // Вычисление, все ли строки выбраны
  const allChecked = useMemo(() => {
    const allIDs = rows?.map((row) => row.id as number) || [];
    return checkedRows.length === allIDs.length && allIDs.length > 0;
  }, [checkedRows, rows]);

  // Обновление `isAllChecked` без вызова бесконечного рендера
  useEffect(() => {
    setIsAllChecked(allChecked);
  }, [allChecked]);

  // Переключение между режимами
  const toggleActiveGrid = () => {
    setActiveGrid((prev) => (prev === EActiveGrid.DATA ? EActiveGrid.CONFIG : EActiveGrid.DATA));
  };

  const onClickButtonDataGridFilter = (e: React.UIEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // Логика фильтрации
  };

  return (
    <DataGridContextProvider initialContext={initialContext}>
      <div className={styles.GridWrapper}>
        <div className={styles.GridPanel}>
          <div className={styles.colGroup} style={{ justifyContent: 'right', gap: '6px' }}>
            <button onClick={toggleActiveGrid} className={styles.Button}>
              <SlSettings size={17} strokeWidth={5} />
            </button>
            <button onClick={onClickButtonDataGridFilter} className={styles.Button}>
              <TbFilter size={17} strokeWidth={1} />
            </button>
          </div>
        </div>
        <hr />
        {activeGrid === EActiveGrid.DATA && <DataGrid />}
        {activeGrid === EActiveGrid.CONFIG && <ConfigGrid />}
      </div>
    </DataGridContextProvider>
  );
};

export default Grid;
