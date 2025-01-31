import React, { useEffect, useState } from 'react'
import { TDataItem } from 'src/components/ui/Grid/types';
// import { IResponseData, ITodo } from './types';
// import DataGrid from 'src/components/ui/DataGrid';
// import { TDataGrid } from 'src/components/ui/DataGrid/DataGridContext';
// import { TDataItem } from 'src/components/ui/DataGrid/services';
// import { TFieldType } from 'src/components/ui/DataGrid/types';
// import co

// import { ContextInstance } from './Context';
// import { useContextInstance } from 'src/components/ui/DataGrid/ContextProvider';
// import { TContextData } from 'src/objects/Todos/Context';
// import { translateWord } from 'src/i18';
// import ContextWrapper, { TDataGrid } from 'src/components/ui/DataGrid/DataGridContext';


// export type TDataItem = { [key: string]: string }
// export type TColumn = {
//   id: string;
//   type: TFieldType;
//   name?: string;
//   width?: string;
//   hint?: string;
// }


// ///////////////////////////////////////////////////////////////////////////

// ///////////////////////////////////////////////////////////////////////////

// const createDataGridColumns = <T extends TDataItem>(DataItem1: T): TColumn[] => {
//   const columns: TColumn[] = [{
//     id: 'selectOption',
//     type: 'boolean'
//   }];
//   const fields = Object.keys(DataItem1);

//   for (const id of fields) {
//     const fieldName = translateWord(id)
//     const col = {
//       id,
//       type: typeof DataItem1[id],
//       name: fieldName.charAt(0).toUpperCase() + fieldName.slice(1), // Делаем name с заглавной буквы
//       width: '',
//       hint: '' // Пример статического описания для hint
//     };
//     columns.push(col);
//   }

//   return columns;
// };
///////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////

type TResponseData = { todos: TDataItem[] } & {
  [key: string]: string | number | boolean
};



const Todos = () => {

  const [responseData, setResponseData] = useState<TResponseData | undefined>(undefined);
  const [dataGridRows, setDataGridRows] = useState<TDataItem[] | undefined>(undefined);

  useEffect(() => {
    loadDataGrid();
  }, [])

  useEffect(() => {
    if (responseData?.todos) {
      const dataRows = responseData.todos;

      // const DataItem1 = responseData?.todos[0];
      // const columns = createDataGridColumns(DataItem1);
      setDataGridRows(dataRows)
    } else {
      setDataGridRows([])
    }
  }, [responseData])

  const loadDataGrid = async () => {
    setDataGridRows(undefined)
    return await fetch('https://dummyjson.com/todos?limit=1')
      .then(response => response.json())
      .then(data => setResponseData(data))
  }

  return (
    <>
      {/* {dataGridRows ? (<DataGrid dataGridRows={dataGridRows} actions={{ loadDataGrid }} />) : (<h1>Loading...</h1>)} */}
    </>
  )
}


export default Todos