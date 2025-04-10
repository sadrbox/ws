import React, { FC, Dispatch, ForwardedRef, forwardRef, ForwardRefExoticComponent, MutableRefObject, ReactNode, RefAttributes, SetStateAction, useEffect, useImperativeHandle } from 'react';
import styles from "../styles.module.scss";
// import { useContextGridSetting } from './DataGridSettingsContextProvider';
import { TColumn } from '../types';
import { useDataGridSettingsContext } from './DataGridSettingsContextProvider';
// import { TColumn, TGridStates } from '../types';
// import { TColumn } from '../../../../objects/Todos/index';


type TProps = {
  columnKEY: keyof TColumn;
  // checked: boolean;
  rowID: number;
}

const DataGridSettingsBodyRowCheckboxVisible: FC<TProps> = ({ columnKEY, rowID }) => {
  const { context } = useDataGridSettingsContext();

  function isCheckedRow(columnKEY: keyof TColumn): boolean {
    if (context?.columns) {
      // return context?.states?.gridColumns.filter(column => column.identifier === columnKEY) || false;
      const column = context?.columns.filter(column => column.identifier === columnKEY);
      if (column[0]) {
        return column[0].visible;
      }
    }
    return false;
  }

  function onToggle(columnKEY: keyof TColumn) {
    if (context?.states?.setGridColumns) {
      context?.states?.setGridColumns((prev) => {
        const changedSettings = prev.map(column => {
          if (column.identifier === columnKEY) {
            column.visible = !column.visible;
          }
          return column;
        })
        return changedSettings;
      })
    }
  }

  function onFocus(rowID: number) {
    if (context?.states?.setActiveRow)
      return context?.states?.setActiveRow(rowID)
  }
  return (
    <label className={styles.LabelForCheckbox} htmlFor={`visible_${rowID}`}>
      <input type="checkbox" onFocus={() => onFocus(rowID)} id={`visible_${rowID}`} checked={isCheckedRow(columnKEY)} onChange={() => onToggle(columnKEY)} />
    </label>
  );
};

export default DataGridSettingsBodyRowCheckboxVisible;