import { useState, FC, useEffect, useMemo } from "react";
import columnsJson from "./columns.json";
import { TColumn, TDataItem, TModelProps, TOrder } from "src/components/ui/Grid/types";
import { getModelColumns, sortGridRows } from "src/components/ui/Grid/services";
import Grid from "src/components/ui/Grid";
import { checkServerAvailability } from "src/utils/main.module";
// import Counterparties from 'src/models/Counterparties';


const getResponseData = async (signal: AbortSignal) => {
  const url = "http://192.168.1.112:3000/api/v1/counterparties";

  if (!(await checkServerAvailability(url, signal))) {
    console.warn("Сервер недоступен.");
    return null;
  }
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Ошибка ${response.status}: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") {
      console.error("Ошибка загрузки данных:", error);
    }
    return null;
  }
};



const Counterparties: FC = () => {
  const name = Counterparties.name;
  const [responseData, setResponseData] = useState<TDataItem[] | null>(null);
  const [rows, setRows] = useState<TDataItem[]>([]);
  const [columns, setColumns] = useState<TColumn[]>(getModelColumns(columnsJson, name));
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [order, setOrder] = useState<TOrder>({
    columnID: "actionDate",
    direction: "desc",
  });


  const loadDataGrid = async () => {
    const controller = new AbortController();
    setIsLoading(true);
    try {
      const response = await getResponseData(controller.signal);

      if (response !== null) {
        setResponseData(response);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    setColumns(getModelColumns(columnsJson, name));
  }, [isLoading])

  // useEffect(() => {
  //   loadDataGrid();
  // }, [order]); // Загружаем данные один раз при монтировании

  useEffect(() => {
    if (responseData) {

      setRows(sortGridRows(responseData, order) || []);
    }
  }, [responseData, order]); // Теперь сортировка обновляется при загрузке новых данных

  const props = useMemo<TModelProps>(
    () => ({
      name,
      rows,
      columns,
      actions: { loadDataGrid, setColumns }, // `loadDataGrid` больше не нужен
      states: { isLoading, setIsLoading, order, setOrder },
    }),
    [rows, order, isLoading, columns]
  );


  return (
    <Grid props={props} />
  );
};

export default Counterparties;
