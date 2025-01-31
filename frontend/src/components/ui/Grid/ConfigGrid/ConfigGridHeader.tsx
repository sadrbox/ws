import React, { useState, useEffect, ReactNode, FC } from 'react';
import { getColumnSettings, getColumnWidthById, getColumnWidthSetting } from '../services';
// import { useContextDataGrid } from '../GridContextData';
import settings from "./settings.json"
import UICheckboxAll from '../DataGrid/DataGridHeaderCheckbox';
import _ from 'lodash';

// import { TColumnsHeader } from '../services';
import UICheckbox from '../DataGrid/DataGridBodyRowCheckbox';
import { getTranslateColumn } from 'src/i18';
import { TColumn } from '../types';
import { GrView } from "react-icons/gr";


const ConfigGridHeader: FC = () => {
  const [columns, setColumns] = useState<TColumn[]>([])

  useEffect(() => {
    if (columns) {
      const sortedColumns = settings.columns.sort((a, b) => b.position - a.position);
      setColumns(sortedColumns)
    }
  }, [])


  return (
    <thead>
      <tr>
        {columns && columns.map((column, keyID: number) => {
          const styleWidth = (column.type === "string" ? { minWidth: column?.width } : { width: column?.width, minWidth: column?.width });
          const header = (column.identifier === 'visible' ? <GrView size={14} /> : column.identifier === "position" ? "№" : getTranslateColumn(column))
          const headerAlign = (column.identifier === 'visible' || column.identifier === "position" ? { dispaly: "flex", justifyItems: "center", alignItems: "center" } : {})
          return (
            <th key={keyID} style={styleWidth}>
              <div title={column?.hint} style={headerAlign}>
                <span style={{ display: "flex" }}>{header}</span>
              </div>
            </th>)
        })}
      </tr>
    </thead >
  );
};

export default ConfigGridHeader;