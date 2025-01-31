import { FC } from 'react'
import styles from "../styles.module.scss";
// import { useContextDataGrid } from './GridContextData';
import { TColumn, TDataItem } from '../types';
import DataGridTabBodyRowCheckbox from './DataGridBodyRowCheckbox';
import { getFormatColumnValue, getTextAlignByColumnType } from '../services';
import { useDataGridContext } from './DataGridContextProvider';
// import { useAppContext } from 'src/components/app/AppContext';


type TProps = {
  countID: number;
  rowID: number;
  columns: TColumn[];
  row: TDataItem;
  loading: boolean;
  // states: {
  //   activeRow: number | null, setActiveRow: Dispatch<SetStateAction<number | null>>
  // }
}

const DataGridTabBodyRow: FC<TProps> = ({ countID, rowID, columns, row, loading }) => {

  const { context } = useDataGridContext();
  // const { setContext: setAppContext } = useAppContext();

  function setActiveRow(rowID: number) {
    if (context?.states?.setActiveRow && !loading)
      context?.states?.setActiveRow(rowID)
  }

  function isActiveRow(rowID: number) {
    return (context?.states?.activeRow === rowID) || false
  }

  function onClickRow(elementID: number) {
    if (!loading) {
      setActiveRow(elementID);
    }
    return null;
  }



  return (
    <tr data-count-id={countID} data-row-id={rowID} onClick={() => onClickRow(rowID)}>
      {columns && columns.filter(column => column.visible).map((column: TColumn, columnIndex: number) => {
        const rowsKey = Object.keys(row);
        if (columns.find(el => rowsKey.includes(el.identifier)))
          if (column.type === 'string' || column.type === "number" || column.type === 'boolean' || column.type === 'date' || column.type === 'object') {
            const value = getFormatColumnValue(row, column);
            if (typeof (value) === "string")
              if (column.type === 'boolean') {
                return (
                  <td key={columnIndex}>
                    <div style={{ justifyItems: column?.alignment }} className={isActiveRow(rowID) ? styles.TabFieldActive : styles.TabField}>
                      <DataGridTabBodyRowCheckbox countID={countID} rowID={rowID} />
                    </div>
                  </td>)
              } else if (column.type === 'string' || column.type === 'number') {
                return (
                  <td key={columnIndex} onClick={() => setActiveRow(rowID)}>
                    <div style={getTextAlignByColumnType(column)} className={isActiveRow(rowID) ? styles.TabFieldActive : styles.TabField}>
                      <span>{value}</span>
                    </div>
                  </td>)
              } else if (column.type === 'object') {
                // console.log(value)
                return (
                  <td key={columnIndex} onClick={() => setActiveRow(rowID)}>
                    <div style={getTextAlignByColumnType(column)} className={isActiveRow(rowID) ? styles.TabFieldActive : styles.TabField}>
                      <span>{value}</span>
                    </div>
                  </td>)
              }
              else if (column.type === "date") {
                return (
                  <td key={columnIndex} onClick={() => setActiveRow(rowID)}>
                    <div style={getTextAlignByColumnType(column)} className={isActiveRow(rowID) ? styles.TabFieldActive : styles.TabField}>
                      <span>{value}</span>
                    </div>
                  </td>)
              }
              else {
                return (
                  <td key={columnIndex} onClick={() => setActiveRow(rowID)}>
                    <div style={getTextAlignByColumnType(column)} className={isActiveRow(rowID) ? styles.TabFieldActive : styles.TabField}>
                      <span>{value}</span>
                    </div>
                  </td>)
              }
          }
      }
      )}
    </tr >
  )
}

export default DataGridTabBodyRow;