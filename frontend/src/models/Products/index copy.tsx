import React, { useEffect, useState, FC, useMemo, useCallback, useContext, createContext, Dispatch, SetStateAction } from "react";
import DataGrid from "../../DataGridTable";
import axios from "axios";
// import { atom, useAtom } from "jotai";
// import { storeDataGrid, storeGridSorting } from "src/utils/store";
// import { Checkbox } from "antd";
import {
  ICol,
  IColumns,
  IProduct,
  IProducts,
  TDataGridRows,
  TGridSorting,
  TStoreDataGrid,
} from "src/DataGridTable/types";
import { ContextProvider } from "src/DataGridTable/ContextProvider";
// import { ContextProvider, TContextData } from "src/DataGridTable/ContextProvider";
// import { Context,   } from "src/DataGridTable/ContextProvider";


const columns = {
  properties: {
    width: "27px 80px 1fr 100px",
  },
  cols: [
    {
      id: "checkbox",
      type: "checkbox",
      // field: {
      // 	style: { textAlign: "center" } as React.CSSProperties,
      // },
    },
    {
      id: "id",
      title: "№",
      type: "id",
    },
    {
      id: "title",
      title: "Наименование",
      type: "string",
    },
    {
      id: "price",
      title: "Цена",
      type: "number",
    },
  ],
};

type TResponseData = {
  products: IProduct[];
  total: number;
  skip: number;
  limit: number;
};
// type TOrderState = {
//   columnID: keyof IProduct;
//   orderBy: "ASC" | "DESC";
// };

type IProductKey = keyof IProduct;
type TProductValue<K extends IProductKey> = IProduct[K];
type TOrderDataGridRows = <K extends IProductKey>(
  DataGridRows: IProduct[],
  columnID: K,
  orderBy: "ASC" | "DESC",
) => IProduct[];
// interface IProductsProps extends HTMLAttributes<HTMLElement> {
// 	// columns: IColumns;
// 	data?: {
// 		gridRows: IProduct[] | undefined;
// 		gridIDs: number[] | undefined;
// 		// sortFn: (columnID: string, orderBy?: string) => void;
// 		// sortDirection: "ASC" | "DESC";
// 	};
// 	isLoading: boolean;
// }






const Products: FC = () => {
  const initHttpResponse: TResponseData = {
    products: [],
    total: 0,
    skip: 0,
    limit: 0,
  };

  const [httpResponse, setHttpResponse] =
    useState<TResponseData>(initHttpResponse);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [sorting, seTOrder] = useState<TGridSorting>({
    columnID: 'id',
    orderBy: 'ASC',
  });

  // const [DataGridRows, setDataGridRows] = useState<TDataGridRows>(undefined);

  // const handleGridSort = (columnID: keyof IProduct = "id") => {
  //   seTOrder((prev) => {
  //     // console.log(columnID, { ...prev });
  //     return {
  //       columnID,
  //       orderBy:
  //         prev.columnID === columnID
  //           ? prev.orderBy === "ASC"
  //             ? "DESC"
  //             : "ASC"
  //           : "ASC",
  //     };
  //   });
  // };

  useEffect(() => {
    const getHttpResponse = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get<TResponseData>(
          "https://dummyjson.com/products?limit=100",
        );
        if (response?.data) {
          // console.log(response?.data.products);
          setHttpResponse(response?.data);
        }
      } catch (e) {
        setError("Ошибка запроса данных JSON");
      } finally {
        setLoading(false);
      }
    };
    // console.log("sts");
    getHttpResponse();
  }, []);

  const sortedDataRows: IProduct[] = useMemo(() => {
    return [...httpResponse.products].sort((a, b): number => {
      const aValue = a[sorting.columnID as keyof IProduct];
      const bValue = b[sorting.columnID as keyof IProduct];

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sorting.orderBy === "ASC"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      } else if (typeof aValue === "number" && typeof bValue === "number") {
        // return sorting.orderBy === 'ASC' ? aValue > bValue : bValue < aValue;
        if (sorting.orderBy === "ASC") {
          return aValue - bValue;
        } else if (sorting.orderBy === "DESC") {
          return bValue - aValue;
        }
      }
      return 0;
    });
  }, [httpResponse, sorting]);

  const dataRows = sortedDataRows;

  const contextInit = {
    columns,
    dataRows,
    sortByColumn: '',
    orderBy: '',
  }

  // console.log(contextInit.dataRows)

  // const [contextData, setContextData] = useState<TContextData>(contextInit);
  // useEffect(() => {
  //   setContextData(contextInit)
  // }, [])
  // console.log(contextData)
  return (
    <ContextProvider>
      {dataRows && Array.isArray(dataRows) && (
        <ContextProvider.Provider value={{ contextData, setContextData }}>
          {httpResponse?.products && (
            <DataGrid
              columns={columns}
              dataRows={sortedDataRows}
            />
          )}
        </ContextProvider.Provider>
      )}
    </ContextProvider>
  );
};

export default Products;
