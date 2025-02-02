import { FC, useEffect, useState } from 'react'
import styles from "../styles.module.scss";
// import { useContextTodo } from 'src/objects/Todos/Context';
// import { TColumn, TDataItem } from 'src/objects/Todos';
// import { ITodo } from 'src/objects/Todos/types';
// import DataGridBodyRow from './DataGridBodyRow';
// import { useContextDataGrid } from './GridContextData';
import { TColumn, TDataItem } from '../types';
// import { TDataItem } from './services';
// import { columns } from '../../../objects/Products/config';
import DataGridBodyRow from './DataGridBodyRow';
import { useDataGridContext } from './DataGridContextProvider';

type TProps = {
  loading: boolean;
}

const DataGridTabBody: FC<TProps> = ({ loading }) => {

  const { context } = useDataGridContext();
  const [columns, setColumns] = useState<TColumn[]>([])

  useEffect(() => {
    const visibleColumns = context?.columns.filter(column => column.visible);
    if (visibleColumns?.length)
      setColumns(visibleColumns)
    // context.states.setIsLoading(false)
  }, [])

  return (
    <tbody className={(loading === true) ? styles.blur5 : ""}>
      {context?.rows && context?.rows.map((row: TDataItem, key: number) =>
        <DataGridBodyRow key={key} countID={++key} rowID={row.id} columns={context?.columns} row={row} loading={loading} />
      )}
      <tr style={{ height: "100%" }}><td colSpan={columns.length}></td></tr>
    </tbody>
  )
}

export default DataGridTabBody;