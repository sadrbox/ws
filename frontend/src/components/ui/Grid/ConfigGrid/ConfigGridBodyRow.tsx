import React, { useState, useEffect, ReactNode, FC, Dispatch, SetStateAction } from 'react';
// import { TColumn, TColumnsHeader } from '../services';
import styles from "../styles.module.scss";
// import UICheckbox from '../DataGridTabBodyRowCheckbox';
// import { useContextDataGrid } from '../GridContextData';
import settings from "./settings.json"
// import { columns } from "./settings.json"
import { TColumn } from '../types';
import { getColumnSettingValue, getColumnWidthById, getFormatColumnValue, getTextAlignByColumnType } from '../services';
import { getTranslateColumn, getTranslation } from 'src/i18';
import { useContextGridSetting } from './ConfigGridContext';
import GridSettingTabBodyRowCheckboxVisible from './ConfigGridBodyRowCheckboxVisible';
import GridSettingTabBodyRowCheckboxSortable from './ConfigGridBodyRowCheckboxSortable';

type TProps = {
  column: TColumn;
  rowID: number;
}

const ConfigGridBodyRow: FC<TProps> = ({ column, rowID }) => {
  const [rowSettingColumns, setRowSettingColumns] = useState<TColumn[]>([])

  const { context } = useContextGridSetting();

  function setActiveRow(rowID: number) {
    if (context?.states?.setActiveRow)
      context?.states?.setActiveRow(rowID)
  }

  function isActiveRow(rowID: number): boolean {
    return (context?.states?.activeRow === rowID) || false;
  }

  useEffect(() => {
    if (rowSettingColumns) {
      const sortedColumns = settings.columns.sort((a, b) => a.position - b.position);
      setRowSettingColumns(sortedColumns)
    }
  }, [])

  return (
    <tr data-row-id={rowID}>
      {rowSettingColumns && rowSettingColumns.map((rowSettingColumn, keyID) => {
        const value = getColumnSettingValue(column, rowSettingColumn);
        const keyForPosition = Object.keys(rowSettingColumn);
        // console.log(rowSettingColumn)
        if (keyForPosition[keyID] === "position") {
          return (
            <td key={keyID} onClick={() => setActiveRow(rowID)}>
              <div style={getTextAlignByColumnType(rowSettingColumn)} className={isActiveRow(rowID) ? styles.TabFieldActive : styles.TabField}>
                <span>{rowID}</span>
              </div>
            </td>)
        } else if (rowSettingColumn.type === 'boolean' && rowSettingColumn.identifier === 'visible') {
          return (
            <td key={keyID}>
              <div style={{ justifyItems: rowSettingColumn.alignment }} className={isActiveRow(rowID) ? styles.TabFieldActive : styles.TabField}>
                <GridSettingTabBodyRowCheckboxVisible rowID={rowID} columnKEY={column?.identifier as keyof TColumn} />
              </div>
            </td>)
        } else if (rowSettingColumn.identifier === 'column' || rowSettingColumn.identifier === 'alignment') {
          // const colValue: string = (column.type === 'string') ? (row[column.identifier as keyof TColumn]?.toString() ?? "") : "";
          return (
            <td key={keyID} onClick={() => setActiveRow(rowID)}>
              <div style={getTextAlignByColumnType(rowSettingColumn)} className={isActiveRow(rowID) ? styles.TabFieldActive : styles.TabField}>
                <span>{getTranslation(value)}</span>
              </div>
            </td>)
        } else if (rowSettingColumn.type === 'string') {
          return (
            <td key={keyID} onClick={() => setActiveRow(rowID)}>
              <div style={getTextAlignByColumnType(rowSettingColumn)} className={isActiveRow(rowID) ? styles.TabFieldActive : styles.TabField}>
                <span>{getTranslation(value)}</span>
              </div>
            </td>)
        }
      })}
    </tr >
  )
};

export default ConfigGridBodyRow;