import { FC, useCallback } from "react";
import { useDataGridContext } from "./DataGridContextProvider";
import { TColumn } from "../types";
import { getTranslateColumn } from "src/i18";
import DataGridTabHeaderCheckbox from "./DataGridHeaderCheckbox";
import styles from "../styles.module.scss";
// import Grid from '../index';



const DataGridTabHeader: FC = () => {
  const {
    context: {
      columns,
      states: { setOrder, order },
    },
  } = useDataGridContext();

  const { columnID, direction } = order;

  const handleSorting = useCallback(
    (columnID: string) => {
      setOrder((prev) => ({
        columnID,
        direction: prev.columnID === columnID && prev.direction === "asc" ? "desc" : "asc",
      }));
    },
    [setOrder]
  );

  return (
    <thead>
      <tr>
        {columns
          .filter((column) => column.visible)
          .map((column: TColumn, keyID: number) => {
            const styleWidth = {
              width: column.width,
              ...(column.type !== "string" && { minWidth: column.width }),
            };

            if (column.type === "boolean") {
              return (
                <th key={keyID} style={styleWidth}>
                  <div style={{ justifyItems: "center" }}>
                    <DataGridTabHeaderCheckbox />
                  </div>
                </th>
              );
            }

            const isActive = columnID === column.identifier;
            const iconStyle = {
              // border: '1px solid red',
              justifySelf: "end",
              marginLeft: "10px",
              color: isActive ? "#666" : "transparent",
              transform: direction === "asc" ? "none" : "scale(1,-1)",
            };

            return (
              <th key={keyID} style={styleWidth} onClick={() => handleSorting(column.identifier)}>
                <div className={styles.GridHeaderColumn}>
                  <span>{getTranslateColumn(column)}</span>
                  <svg style={iconStyle} width="18" height="18" viewBox="8 4 8 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path style={{}} d="M12 8V10M12 14L9 11M12 14L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </th>
            );
          })}
      </tr>
    </thead>
  );
};

export default DataGridTabHeader;
