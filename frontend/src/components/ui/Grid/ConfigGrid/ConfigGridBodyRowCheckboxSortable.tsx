import React, { FC, Dispatch, ForwardedRef, forwardRef, ForwardRefExoticComponent, MutableRefObject, ReactNode, RefAttributes, SetStateAction, useEffect, useImperativeHandle } from 'react';
import styles from "../styles.module.scss";
import { useContextGridSetting } from './ConfigGridContext';
import { TColumn, TGridStates } from '../types';


type TProps = {
  rowID: number;
}

const ConfigGridBodyRowCheckboxSortable: FC<TProps> = ({ rowID }) => {
  const context = useContextGridSetting();

  function isCheckedRow(rowID: number) {
    // return context?.states?.sortableRows.includes(rowID) || false;
    return false;
  }

  function onToggle(rowID: number) {
    context?.states?.setSortableRows((prev) => {
      if (prev.includes(rowID)) {
        return prev.filter(id => id !== rowID);
      } else {
        return [...prev, rowID];
      }
    });
  }

  function onFocus(rowID: number) {
    if (context?.states?.setActiveRow)
      return context?.states?.setActiveRow(rowID)
  }
  return (
    <label className={styles.LabelForCheckbox} htmlFor={`sortable_${rowID}`}>
      <input type="checkbox" onFocus={() => onFocus(rowID)} id={`sortable_${rowID}`} checked={isCheckedRow(rowID)} onChange={() => onToggle(rowID)} />
    </label>
  );
};

export default ConfigGridBodyRowCheckboxSortable;