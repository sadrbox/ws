/**
 * TableConfigColumns / TableConfigColumnsItem — список колонок в модалке настройки
 * таблицы: видимость (чекбокс) + порядок (drag&drop).
 *
 * Вынесено из Table/index.tsx (T4 — разгрузка 2000-строчного файла). Компоненты
 * ЧИСТО props-driven (не читают useTableContext), поэтому вынос безопасен и без
 * циклических импортов. Обёртка-модалка (TableConfigModalForm), которая берёт
 * колонки из контекста, осталась в index.tsx и рендерит TableConfigColumns.
 */
import {
  FC, memo, useCallback, useMemo, useState,
  type Dispatch, type SetStateAction, type ChangeEvent,
} from 'react';
import { DndContext, closestCenter, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PiDotsThreeVerticalDuotone } from 'react-icons/pi';
import { getTranslateColumn, translate } from 'src/i18';
import type { TColumn } from './types';
import styles from './Table.module.scss';

type TypeTableConfigColumnsProps = {
  columns: TColumn[];
  setColumns: Dispatch<SetStateAction<TColumn[]>>;
};

export const TableConfigColumns: FC<TypeTableConfigColumnsProps> = ({ columns, setColumns }) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const updateColumnVisibility = useCallback((identifier: string, visible: boolean) => {
    setColumns(prev => prev.map(col =>
      col.identifier === identifier ? { ...col, visible } : col
    ));
  }, [setColumns]);

  const onDragStart = useCallback((event: DragStartEvent) => setDraggingId(String(event.active.id)), []);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setDraggingId(null);
    if (active.id !== over?.id) {
      setColumns(prev => {
        const oldIndex = prev.findIndex(col => col.identifier === active.id);
        const newIndex = prev.findIndex(col => col.identifier === over?.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, [setColumns]);

  const dndItems = useMemo(() => columns.map(col => col.identifier), [columns]);

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} onDragStart={onDragStart}>
      <SortableContext items={dndItems} strategy={verticalListSortingStrategy}>
        <ul className={styles.CheckboxList}>
          {columns.filter(col => col.inlist !== false).map(column => (
            <TableConfigColumnsItem
              key={column.identifier}
              column={column}
              isDragging={column.identifier === draggingId}
              toggleVisibility={updateColumnVisibility}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
};

type TypeTableConfigColumnsItemProps = {
  column: TColumn;
  isDragging: boolean;
  toggleVisibility: (identifier: string, visible: boolean) => void;
};

const TableConfigColumnsItem: FC<TypeTableConfigColumnsItemProps> = memo(({ column, isDragging, toggleVisibility }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: column.identifier });

  const handleVisibilityChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    toggleVisibility(column.identifier, e.target.checked);
  }, [column.identifier, toggleVisibility]);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${styles.ListItem} ${isDragging ? styles.dragging : ''}`}
    >
      <div {...listeners} {...attributes} className={styles.DragAndDrop} title={translate("move")}>
        <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
      </div>
      <div className={styles.CheckboxWrapper}>
        <input
          type="checkbox"
          id={`column-visibility-${column.identifier}`}
          checked={column.visible}
          onChange={handleVisibilityChange}
        />
        <label htmlFor={`column-visibility-${column.identifier}`}>{getTranslateColumn(column)}</label>
      </div>
    </li>
  );
});
TableConfigColumnsItem.displayName = "TableConfigColumnsItem";
