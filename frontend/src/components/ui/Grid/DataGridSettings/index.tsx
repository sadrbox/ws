import { useState, useEffect, FC } from 'react';
import { TColumn } from '../types';
import DataGridSettingsHeader from './DataGridSettingsHeader';
import DataGridSettingsBody from './DataGridSettingsBody';
import { useDataGridContext } from '../DataGrid/DataGridContextProvider';
import styles from "../styles.module.scss";
import { SlRefresh } from "react-icons/sl";
import { IoAddCircleOutline, IoRemoveCircleOutline } from "react-icons/io5";
import { FaAngleUp, FaAngleDown } from "react-icons/fa";
import { PiDotsThreeVerticalDuotone } from "react-icons/pi";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableItem } from "./SortableItem";
import { getTranslateColumn } from 'src/i18';


type TProps = {
  props: {
    name: string;
    columns: TColumn[];
  };
};

const DataGridSettings: FC<TProps> = ({ props: { name, columns } }) => {
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [gridColumns, setGridColumns] = useState<TColumn[]>(columns);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    // localStorage.setItem(context?.name, JSON.stringify(gridColumns));
  }, [gridColumns]);

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
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  return (
    <>
      <div className={styles.GridPanel}>
        <div className={styles.colGroup} style={{ justifyContent: 'left', gap: '6px' }}>
          <button className={styles.Button}>
            <FaAngleUp size={17} strokeWidth={5} />
          </button>
          <button className={styles.Button}>
            <FaAngleDown size={17} strokeWidth={4} />
          </button>
        </div>
        <div className={styles.colGroup} style={{ justifyContent: 'right', gap: '6px' }}>
          <button onClick={() => console.log('refreshSetting')} className={styles.Button}>
            <SlRefresh
              className={loading ? styles.animationLoop : ""}
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
            <div className={styles.colGroup}>
              <div className={styles.HeaderName}>Отображение</div>
            </div>

            <div className={styles.colGroup}>
              <div className={styles.ScrollWrapper} style={{ height: '450px', width: '300px' }}>
                <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} onDragStart={onDragStart}>
                  <SortableContext items={gridColumns.map(col => col.identifier)} strategy={verticalListSortingStrategy}>
                    <ul className={styles.CheckboxList}>
                      {[...gridColumns].map((column) => (
                        <SortableItem key={column.identifier} column={column} isDragging={column.identifier === draggingId} />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DataGridSettings;
