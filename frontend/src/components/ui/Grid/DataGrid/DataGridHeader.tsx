import { FC, useCallback } from "react";
import { FaSortAmountDownAlt } from "react-icons/fa";
import { useDataGridContext } from "./DataGridContextProvider";
import { TColumn } from "../types";
import { getTranslateColumn } from "src/i18";
import DataGridTabHeaderCheckbox from "./DataGridHeaderCheckbox";

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

            if (column.identifier === "switcher") {
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
              justifySelf: "end",
              marginLeft: "10px",
              color: isActive ? "#444" : "transparent",
              transform: direction === "asc" ? "none" : "scale(1,-1)",
            };

            return (
              <th key={keyID} style={styleWidth} onClick={() => handleSorting(column.identifier)}>
                <div>
                  <span>{getTranslateColumn(column)}</span>
                  <FaSortAmountDownAlt size={17} style={iconStyle} />
                </div>
              </th>
            );
          })}
      </tr>
    </thead>
  );
};

export default DataGridTabHeader;
