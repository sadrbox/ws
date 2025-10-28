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
  const { checkedRows, setCheckedRows, setActiveRow } = context?.states;



  function isCheckedRow(rowID: number) {
    if (checkedRows)
      return checkedRows.includes(rowID) || false;
  }

  function onChange(rowID: number) {
    if (setCheckedRows)
      setCheckedRows((prev) => {
        if (prev.includes(rowID)) {
          return [...prev].filter(id => id !== rowID);
        } else {
          return [...prev, rowID];
        }
      });
  }

  function onFocus(rowID: number) {
    if (setActiveRow)
      return setActiveRow(rowID)
  }


  return (
    <label className={styles.LabelForCheckbox} htmlFor={`selectOption_${rowID}`}>
      <input type="checkbox" tabIndex={countID} id={`selectOption_${rowID}`} checked={isCheckedRow(rowID)} onFocus={() => onFocus(rowID)} onChange={() => onChange(rowID)} />
    </label>
  );
};

export default DataGridTabBodyRowCheckbox;