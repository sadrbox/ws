import { useState, useEffect, FC } from 'react';
import { TColumn } from '../types';
import DataGridSettingsHeader from './DataGridSettingsHeader';
import DataGridSettingsBody from './DataGridSettingsBody';
// import ContextWrapper, { TDataGridSettingsContext } from './DataGridSettingsContext';
import { useDataGridContext } from '../DataGrid/DataGridContextProvider';
import styles from "../styles.module.scss"
import { SlRefresh } from "react-icons/sl";
import { IoAddCircleOutline, IoRemoveCircleOutline } from "react-icons/io5";
// import { BlobOptions } from 'buffer';
import { FaAngleUp } from "react-icons/fa";
import { FaAngleDown } from "react-icons/fa";
// import DataGridSettingsContextProvider, { DataGridSettingsContext } from './DataGridSettingsContextProvider';
// import  DataGridSettingsContextProvider  from './DataGridSettingsContextProvider';
// import { PiDotsThreeOutlineVerticalFill } from "react-icons/pi";
import { PiDotsThreeVerticalDuotone } from "react-icons/pi";
import { MdOutlineDragIndicator } from "react-icons/md";


type TProps = {
  props: {
    name: string;
    columns: TColumn[];
  };

};

const DataGridSettings: FC = () => {
  // const { context } = useDataGridContext();
  // const { name, columns } = context;
  // const columns = context?.columns;
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [columns, setColumns] = useState<TColumn[]>([]);
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
    // localStorage.setItem(context?.name, JSON.stringify(columns));
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
      <div className={styles.FormWrapper}>
        <div className={styles.colGroup}>
          <div className={styles.rowGroup}>
            <div className={styles.ScrollWrapper} style={{ marginTop: '40px' }}>
              <div className={styles.HeaderName} style={{ marginTop: '-33px' }}>Видимость</div>
              <ul className={styles.CheckboxList}>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item1" />
                  <label htmlFor="item1">Элемент 1</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item2" />
                  <label htmlFor="item2">Элемент 2</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item3" />
                  <label htmlFor="item3">Элемент 3</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item4" />
                  <label htmlFor="item4">Элемент 4</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item5" />
                  <label htmlFor="item5">Элемент 5</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item6" />
                  <label htmlFor="item6">Элемент 6</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item7" />
                  <label htmlFor="item7">Элемент 7</label>
                </li>
              </ul>
            </div>
          </div>

          <div className={styles.rowGroup}>
            <div className={styles.ScrollWrapper} style={{ marginTop: '40px' }}>
              <div className={styles.HeaderName} style={{ marginTop: '-33px' }}>Видимость</div>
              <ul className={styles.CheckboxList}>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item1" />
                  <label htmlFor="item1">Элемент 1</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item2" />
                  <label htmlFor="item2">Элемент 2</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item3" />
                  <label htmlFor="item3">Элемент 3</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item4" />
                  <label htmlFor="item4">Элемент 4</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item5" />
                  <label htmlFor="item5">Элемент 5</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item6" />
                  <label htmlFor="item6">Элемент 6</label>
                </li>
                <li>
                  <div className={styles.DragAndDrop}>
                    <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
                  </div>
                  <input type="checkbox" id="item7" />
                  <label htmlFor="item7">Элемент 7</label>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DataGridSettings;
