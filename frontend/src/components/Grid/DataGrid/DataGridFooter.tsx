import { FC, useCallback, useRef, useState } from "react";
import { useDataGridContext } from "./DataGridContextProvider";
import { TColumn } from "../types";
import { getTranslateColumn } from "src/i18";
import DataGridTabFooterCheckbox from "./DataGridHeaderCheckbox";
import styles from "../styles.module.scss";
import useUID from "src/hooks/useUID";
import DataGridSearchField from "./DataGridSearchField";
// import Grid from '../index';



const DataGridTabFooter: FC = () => {

  const formUid = useUID();
  const [searchFields, setSearchFields] = useState<string[]>([]);
  const searchField = useRef<HTMLInputElement>(null);


  const {
    context: {
      columns,
    },
  } = useDataGridContext();


  const handleShowSearchField = (columnIdentifier: string) => {
    setSearchFields(prev => prev.includes(columnIdentifier) ? prev.filter(item => item !== columnIdentifier) : [...prev, columnIdentifier])
    searchField.current?.focus();
    console.log(searchField)
  }

  return (
    <tfoot>
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
                <td key={keyID} style={styleWidth}>
                  <div style={{ justifyItems: "center" }}>
                    <DataGridTabFooterCheckbox />
                  </div>
                </td>
              );
            }



            const searchFieldName = `${formUid}_${column.identifier}`;
            return (
              <td key={keyID} style={styleWidth} onClick={() => handleShowSearchField(column.identifier)}>
                <div className={styles.GridFooterColumn}>

                </div>
              </td>
            );
          })}
      </tr>
    </tfoot>
  );
};

export default DataGridTabFooter;
