import { useState, useEffect, FC } from 'react';
import { TColumn } from '../types';
import ConfigGridHeader from './ConfigGridHeader';
import ConfigGridBody from './ConfigGridBody';
// import ContextWrapper, { TContextGridSetting } from './ConfigGridContext';
import { useDataGridContext } from '../DataGrid/DataGridContextProvider';
import styles from "../styles.module.scss"
import { SlRefresh } from "react-icons/sl";
import { IoAddCircleOutline, IoRemoveCircleOutline } from "react-icons/io5";
// import { BlobOptions } from 'buffer';
import { FaAngleUp } from "react-icons/fa";
import { FaAngleDown } from "react-icons/fa";

type TProps = {
  props: {
    name: string;
    columns: TColumn[];
  };

};

const ConfigGrid: FC = () => {
  const { context } = useDataGridContext();
  // const { name, columns } = context;
  // const columns = context?.columns;
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [columns, setColumns] = useState<TColumn[]>(context?.columns);
  const [loading, setLoading] = useState<boolean>(false)
  // Загрузка колонок из localStorage
  // const getModelColumns = (defaultColumns: TColumn[], modelName: string): TColumn[] => {
  //   const storedColumns = localStorage.getItem(modelName);
  //   return storedColumns
  //     ? JSON.parse(storedColumns).sort((a: TColumn, b: TColumn) => a.position - b.position)
  //     : defaultColumns.sort((a, b) => a.position - b.position);
  // };

  // useEffect(() => {
  //   const loadedColumns = getModelColumns(columns, name);
  //   setGridColumns(loadedColumns);
  // }, [columns, name]);

  // Сохранение колонок в localStorage при изменении
  useEffect(() => {
    localStorage.setItem(context?.name, JSON.stringify(columns));
  }, [columns]);

  // Перемещение строки вверх или вниз
  const updatePosition = (direction: 'up' | 'down') => {
    if (activeRow === null) return;

    const index = activeRow - 1;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= columns.length) return;

    const newColumns = [...columns];
    [newColumns[index], newColumns[targetIndex]] = [newColumns[targetIndex], newColumns[index]];

    setColumns(
      newColumns.map((col, i) => ({
        ...col,
        position: i + 1,
      }))
    );
    setActiveRow(targetIndex + 1);
  };

  return (
    <>
      <div className={styles.GridPanel}>
        <div className={styles.colGroup} style={{ justifyContent: 'left', gap: '6px' }}>
          <button onClick={() => updatePosition('up')} className={styles.Button}>
            <FaAngleUp size={17} strokeWidth={5} />
          </button>
          <button onClick={() => updatePosition('down')} className={styles.Button}>
            <FaAngleDown size={17} strokeWidth={4} />
          </button>
        </div>
        <div className={styles.colGroup} style={{ justifyContent: 'right', gap: '6px' }}>
          <button onClick={() => console.log('refreshSetting')} className={styles.Button}>
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
          <ConfigGridHeader />
          <ConfigGridBody loading={lodaing} />
        </table>
      </div>
    </>
  );
};

export default ConfigGrid;
