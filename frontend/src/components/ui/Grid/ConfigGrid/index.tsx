import React, { useState, useEffect, FC, Dispatch, SetStateAction } from 'react';
import { TColumn } from '../types';
import ConfigGridHeader from './ConfigGridHeader';
import ConfigGridBody from './ConfigGridBody';
import ContextWrapper, { TContextGridSetting } from './ConfigGridContext';
import { useDataGridContext } from '../DataGrid/DataGridContextProvider';
import styles from "../styles.module.scss"


type TProps = {
  props: {
    name: string;
    columns: TColumn[];
  };

};

const ConfigGrid: FC = () => {
  const context = useDataGridContext();
  const name = context?.name || 'textstring';
  const columns = context?.columns || [];
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [gridColumns, setGridColumns] = useState<TColumn[]>([]);

  // Загрузка колонок из localStorage
  const getModelColumns = (defaultColumns: TColumn[], modelName: string): TColumn[] => {
    const storedColumns = localStorage.getItem(modelName);
    return storedColumns
      ? JSON.parse(storedColumns).sort((a: TColumn, b: TColumn) => a.position - b.position)
      : defaultColumns.sort((a, b) => a.position - b.position);
  };

  useEffect(() => {
    const loadedColumns = getModelColumns(columns, name);
    setGridColumns(loadedColumns);
  }, [columns, name]);

  // Сохранение колонок в localStorage при изменении
  useEffect(() => {
    localStorage.setItem(name, JSON.stringify(gridColumns));
  }, [gridColumns, name]);

  // Перемещение строки вверх или вниз
  const updatePosition = (direction: 'up' | 'down') => {
    if (activeRow === null) return;

    const index = activeRow - 1;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= gridColumns.length) return;

    const newColumns = [...gridColumns];
    [newColumns[index], newColumns[targetIndex]] = [newColumns[targetIndex], newColumns[index]];

    setGridColumns(
      newColumns.map((col, i) => ({
        ...col,
        position: i + 1,
      }))
    );
    setActiveRow(targetIndex + 1);
  };

  return (
    <div className={styles.GridSrollWrapper}>
      <table>
        <ConfigGridHeader />
        <ConfigGridBody />
        <tfoot>
          <tr>
            <td>
              <button onClick={() => updatePosition('up')}>⬆ Move Up</button>
              <button onClick={() => updatePosition('down')}>⬇ Move Down</button>
              {/* <button onClick={loadDataGrid}>Load Data</button> */}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

  );
};

export default ConfigGrid;
