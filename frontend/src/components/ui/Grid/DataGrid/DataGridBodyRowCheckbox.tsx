import React, { FC, Dispatch, ForwardedRef, forwardRef, ForwardRefExoticComponent, MutableRefObject, ReactNode, RefAttributes, SetStateAction, useEffect, useImperativeHandle } from 'react';
import { useDataGridContext } from './DataGridContextProvider';
import styles from "../styles.module.scss"


type TProps = {
  countID: number;
  rowID: number;
  // states: {
  //   activeRow: number | null, setActiveRow: Dispatch<SetStateAction<number | null>>
  // }
}

const DataGridTabBodyRowCheckbox: FC<TProps> = ({ countID, rowID }) => {
  const { context } = useDataGridContext();


  function isCheckedRow(rowID: number) {
    return context?.states?.checkedRows.includes(rowID) || false;
  }

  function onToggle(rowID: number) {
    context?.states?.setCheckedRows((prev) => {
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
    <label className={styles.LabelForCheckbox} htmlFor={`selectOption_${rowID}`}>
      <input type="checkbox" tabIndex={countID} id={`selectOption_${rowID}`} checked={isCheckedRow(rowID)} onFocus={() => onFocus(rowID)} onChange={() => onToggle(rowID)} />
    </label>
  );
};

export default DataGridTabBodyRowCheckbox;