import React, { useState, useEffect, ReactNode, FC, useLayoutEffect } from 'react';
// import { TColumn, TColumnsHeader, TDataItem } from '../services';
// import columns from "../columns.json"
// import settings from "./settings.json"
// import GridBodyRowColumnsSetting from './GridBodyRowSetting';
// import { useContextDataGrid } from '../DataGridContext';
import { TColumn } from '../types';
import ConfigGridBodyRow from './ConfigGridBodyRow';
import { useContextGridSetting } from './ConfigGridContext';
import { useDataGridContext } from '../DataGrid/DataGridContextProvider';
// import DataGridContext from '../DataGrid/DataGridContext';
// import GridSettingContext from './GridSettingContext';




const ConfigGridBody: FC = () => {

  const { context } = useDataGridContext();
  const [columns, setColumns] = useState<TColumn[]>([])

  useEffect(() => {
    const visibleColumns = context?.columns.filter(column => column.visible);
    if (visibleColumns?.length)
      setColumns(visibleColumns)
  }, [])

  return (
    <tbody>
      {columns && columns.map((column, key: number) =>
        <ConfigGridBodyRow key={key} column={column} rowID={column.position} />)}
      <tr style={{ height: "100%" }}><td colSpan={3}></td></tr>
    </tbody>
  );
};

export default ConfigGridBody;