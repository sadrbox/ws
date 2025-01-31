import { FC, useEffect, useState } from 'react';
import { useDataGridContext } from './DataGridContextProvider';
import { IoAddCircleOutline, IoRemoveCircleOutline } from "react-icons/io5";
import { SlRefresh } from "react-icons/sl";
import styles from '../styles.module.scss';
import DataGridHeader from './DataGridHeader';
import DataGridBody from './DataGridBody';


const DataGrid: FC = () => {
  const { context } = useDataGridContext();
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    if (context?.states?.setIsLoading) {
      setLoading(context?.states?.isLoading)
    }
  }, [context?.rows]);

  const refreshDataGrid = () => {
    if (!context?.actions?.loadDataGrid || !context?.states?.setIsLoading) return;
    setLoading(true)
    context?.actions.loadDataGrid()
  }

  return (
    <>
      <div className={styles.GridPanel}>
        <div className={styles.colGroup} style={{ justifyContent: 'left', gap: '6px' }}>
          <button className={styles.Button}>
            <IoAddCircleOutline size={17} strokeWidth={5} />
            <span>Добавить</span>
          </button>
          <button className={styles.Button}>
            <IoRemoveCircleOutline size={17} strokeWidth={5} />
            <span>Удалить</span>
          </button>
        </div>
        <div className={styles.colGroup} style={{ justifyContent: 'right', gap: '6px' }}>
          <button onClick={refreshDataGrid} className={styles.Button}>
            <SlRefresh
              className={(loading === true) ? styles.animationLoop : ""}
              size={17}
              strokeWidth={5}
            />
            <span>Обновить</span>
          </button>
        </div>
      </div>
      <hr />
      <div className={styles.GridSrollWrapper}>
        <table>
          <DataGridHeader />
          <DataGridBody loading={loading} />
        </table>
      </div>
    </>
  );
};

export default DataGrid;
