import { useState, FC, useEffect } from "react";
import columnsJson from "./columns.json";
import { TColumn, TDataItem, TModelProps, TSorting } from "src/components/ui/Grid/types";
import { getModelColumns, orderGridRows } from "src/components/ui/Grid/services";
import Grid from "src/components/ui/Grid";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ActivityHistory: FC = () => {
  const name = ActivityHistory.name;
  const [rows, setRows] = useState<TDataItem[] | undefined>(undefined)
  const [columns, setColumns] = useState<TColumn[]>(columnsJson)

  const [props, setProps] = useState<TModelProps | undefined>(undefined);
  const [isLoadedGrid, setIsLoadedGrid] = useState<boolean>(false);
  const [order, setOrder] = useState<TSorting>({
    columnID: "actionDate",
    direction: "desc",
  });

  const getResponseData = async () => {
    const response = await fetch("http://192.168.1.112:3000/json");
    const data = await response.json();
    return data;
  };

  const loadDataGrid = async () => {
    // console.log(isLoadedGrid)
    const Data = await delay(2000).then(() => getResponseData());
    const Rows = orderGridRows(Data, order) || [];
    const Columns = getModelColumns(columns, name);

    setRows(Rows)
    setColumns(Columns)
    // setIsLoadedGrid(false); // Start loading animation
  };

  useEffect(() => {
    setIsLoadedGrid(true); // Stop loading animation
    // console.log(isLoadedGrid)
    if (rows?.length) {
      setProps({
        name,
        columns,
        rows,
        order,
        actions: { loadDataGrid, setOrder },
        states: { isLoadedGrid, setIsLoadedGrid }
      });
    }

  }, [rows])

  useEffect(() => {
    loadDataGrid();
  }, [order]);

  return (
    <>
      {props ? <Grid props={props} /> : <div>Loading...</div>}
    </>
  );
};

export default ActivityHistory;
