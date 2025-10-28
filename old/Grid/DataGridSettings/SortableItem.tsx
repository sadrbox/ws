import { FC, useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PiDotsThreeVerticalDuotone } from "react-icons/pi";
import styles from "../styles.module.scss";
import { TColumn } from "../types";
import { getTranslateColumn } from "src/i18";

type TProps = {
  column: TColumn,
  isDragging: boolean;
  toggleVisibility: (identifier: string, visible: boolean) => void;
};

export const SortableItem: FC<TProps> = ({ column, isDragging, toggleVisibility }) => {
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
