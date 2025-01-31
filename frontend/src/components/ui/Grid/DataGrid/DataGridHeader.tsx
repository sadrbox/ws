import React, { FC, useCallback } from 'react';
import { FaSortAmountDownAlt } from "react-icons/fa";
import { useDataGridContext } from './DataGridContextProvider';
import { TColumn } from '../types';
import { getTranslateColumn } from 'src/i18';
import DataGridTabHeaderCheckbox from './DataGridHeaderCheckbox';

const DataGridTabHeader: FC = () => {
  const context = useDataGridContext().context;;

  const handleSorting = useCallback((columnID: string) => {
    if (context?.states?.setOrder) {
      context.states.setOrder((prev) => ({
        columnID,
        direction: prev.columnID === columnID && prev.direction === 'asc' ? 'desc' : 'asc',
      }));
    }
  }, [context?.states?.setOrder]);

  const { columnID, direction } = context?.states?.order || {};

  return (
    <thead>
      <tr>
        {context?.columns
          ?.filter((column) => column.visible)
          .map((column: TColumn, keyID: number) => {
            const styleWidth = column.type === 'string'
              ? { width: column?.width }
              : { width: column?.width, minWidth: column?.width };

            if (column.identifier === 'switcher') {
              return (
                <th key={keyID} style={styleWidth}>
                  <div style={{ justifyItems: 'center' }}>
                    <DataGridTabHeaderCheckbox />
                  </div>
                </th>
              );
            }

            return (
              <th key={keyID} style={styleWidth} onClick={() => handleSorting(column.identifier)}>
                <div>
                  <span>{getTranslateColumn(column)}</span>
                  {columnID === column.identifier && direction === 'asc' ? <FaSortAmountDownAlt size={17} style={{ justifySelf: 'end', marginLeft: '10px', color: (columnID === column.identifier ? '#444' : 'transparent') }} /> : <FaSortAmountDownAlt size={17} style={{ transform: 'scale(1,-1)', justifySelf: 'end', marginLeft: '10px', color: (columnID === column.identifier ? '#444' : 'transparent') }} />}
                </div>
              </th>
            );
          })}
      </tr>
    </thead>
  );
};

export default React.memo(DataGridTabHeader);







