import { FC, useEffect, useMemo, useState } from 'react';
import DataGridContextProvider from './DataGridContextProvider';
import { SlRefresh } from "react-icons/sl";
import styles from '../styles.module.scss';
import DataGridHeader from './DataGridHeader';
import DataGridBody from './DataGridBody';
import { TDataGridContext, TModelProps } from '../types';

type TProps = {
  props: TModelProps;
};

const DataGrid: FC<TProps> = ({ props: { name, rows, columns, actions: { loadDataGrid }, states } }) => {
  // const { context } = useDataGridContext();
  // const [loading, setLoading] = useState<boolean>(false)
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

  // useEffect(() => {
  //   if (states?.isLoading)
  //     setLoading(states?.isLoading)
  // }, [states?.isLoading])
  // Мемоизация контекста для провайдера
  const initialContext = useMemo<TDataGridContext>(() => {
    return {
      name,
      rows,
      columns,
      // actions: {
      //   loadDataGrid,
      // },
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
  }, [checkedRows, isAllChecked, activeRow, columns]);

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

  // useEffect(() => {
  //   if (states?.isLoading !== undefined) {
  //     setLoading(states?.isLoading)
  //   }
  // }, [rows]);

  const refreshDataGrid = () => {
    // if (states?.setIsLoading) return;
    // setLoading(true)
    loadDataGrid()
  }

  return (
    <DataGridContextProvider initialContext={initialContext}>
      <div className={styles.GridPanel}>
        <div className={styles.colGroup}>
          <button className={styles.Button}>
            <span>Добавить</span>
          </button>
          <button className={styles.Button}>
            <span>Удалить</span>
          </button>
        </div>
        <div className={styles.colGroup}>
          <button onClick={refreshDataGrid} className={styles.Button}>
            <SlRefresh
              className={(states?.isLoading === true) ? styles.animationLoop : ""}
              size={14}
              strokeWidth={30}
            />
            <span>Обновить</span>
          </button>
        </div>
      </div>
      <div className={styles.GridSrollWrapper}>
        <table>
          <DataGridHeader />
          <DataGridBody loading={states.isLoading} />
        </table>
      </div>
    </DataGridContextProvider>
  );
};

export default DataGrid;