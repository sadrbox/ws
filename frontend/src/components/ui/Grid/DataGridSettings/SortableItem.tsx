import { FC } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PiDotsThreeVerticalDuotone } from "react-icons/pi";
import styles from "../styles.module.scss";
import { TColumn } from "../types";
import { getTranslateColumn } from "src/i18";

type TProps = {
  column: TColumn,
  isDragging: boolean;
};

export const SortableItem: FC<TProps> = ({ column, isDragging }) => {
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
      <input {...attributes} type="checkbox" id={`${column.identifier}`} />
      <label htmlFor={`${column.identifier}`}>{getTranslateColumn(column)}</label>
    </li>
  );
};
