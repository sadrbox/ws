import { FC } from 'react';
// import { TColumn, TColumnsHeader, TDataItem } from '../services';
// import columns from "../columns.json"
// import settings from "./settings.json"
// import GridBodyRowColumnsSetting from './GridBodyRowSetting';
// import { useContextDataGrid } from '../DataGridContext';
// import { TColumn } from '../types';
import DataGridSettingsBodyRow from './DataGridSettingsBodyRow';
// import { useDataGridSettingsContext } from './DataGridSettingsContext';
import { useDataGridContext } from '../DataGrid/DataGridContextProvider';
// import DataGridContext from '../DataGrid/DataGridContext';
// import GridSettingContext from './GridSettingContext';




const DataGridSettingsBody: FC = () => {

  const { context: { columns } } = useDataGridContext();

  return (
    <tbody>
      {columns && columns.map((column, key: number) =>
        <DataGridSettingsBodyRow key={key} column={column} rowID={column.position} />)}
      <tr style={{ height: "100%" }}><td colSpan={3}></td></tr>
    </tbody>
  );
};

export default DataGridSettingsBody;