import React, { useEffect, useState, FC, useMemo, useCallback, useContext, createContext, Dispatch, SetStateAction } from "react";
import _, { reject } from "lodash";
// import { ContextInstance, ContextProvider } from "src/components/DataGrid/ContextProvider";
// import { IColumns, IProduct, IRootProduct } from "src/components/DataGrid/types";
// import ContextProvider, { contextDataInit, TContextData, TOrdering } from "src/components/DataGrid/ContextProvider";
// import { createColumnsConfigFromResponse, initialCols, initialConfig, TColumn, TConfig } from "src/components/DataGrid/DataGrid.module";
// import { Testing } from "src/components/Testing";
// import { TColumn, TDataItem } from "src/components/DataGrid/services";
// import DataGrid from "src/components/DataGrid";
// import { ProductType } from './index';
// import { TContextData } from 'src/DataGridTable/ContextProvider';
// import { contextDataInit } from '../../components/DataGrid/ContextProvider';

import columns from "./columns.json"
import DataGrid from "src/components/Grid/DataGrid/index_2";
import { TColumn, TDataItem } from "src/components/Grid/types";
import Grid from "src/components/Grid/index_2";
// import { TProduct } from "./types";

// type TColum = typeof columns;


type TResponseData = { products: TDataItem[] } & {
  [key: string]: string | number | boolean
};

type TParams = {
  tabName: string;
  rows: TDataItem[]
  columns: TColumn[];
}

const Products: FC = () => {


  const [responseData, setResponseData] = useState<TResponseData | undefined>(undefined);
  const [params, setParams] = useState<TParams | undefined>(undefined)
  const [sortedColumns, setSortedColumns] = useState<TColumn[]>([])


  function buildColumns(columns: TColumn[], tabName: string) {
    const cols = columns.map((col, keyID) => {
      col.position = keyID + 1
      return col;
    }).sort((a, b) => a.position - b.position);
    const getStorageOfSettings = localStorage.getItem("username_gridSetting_" + tabName);
    let storageOfSettings = [];
    storageOfSettings = getStorageOfSettings && JSON.parse(getStorageOfSettings)

    if (storageOfSettings) {
      setSortedColumns(storageOfSettings);
    } else {
      setSortedColumns(cols);
    }
  }

  useEffect(() => {
    if (params)
      buildColumns(columns, params?.tabName)
  }, [params])

  useEffect(() => {
    buildColumns(columns, 'products')
    loadDataGrid();
  }, [])

  useEffect(() => {
    // console.log(sortedColumns)
    if (responseData?.products) {
      const rows = responseData?.products;
      setParams({ tabName: 'products', rows, columns: sortedColumns })
    } else {
      setParams(undefined)
    }
  }, [responseData])

  const loadDataGrid = async () => {
    buildColumns(columns, 'products');
    setParams(undefined)
    await fetch('https://dummyjson.com/products?limit=30')
      .then(response => response.json())
      .then(data => setResponseData(data))
  }

  return (
    <>
      {params ? (<Grid params={params} actions={{ loadDataGrid }} />) : (<h1>Loading...</h1>)}
    </>
  )

};

export default Products;

