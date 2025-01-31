import { useState, FC, useEffect, useMemo } from "react";
import columnsJson from "./columns.json";
import { TColumn, TDataItem, TModelProps, TOrder } from "src/components/ui/Grid/types";
import { getModelColumns, sortGridRows } from "src/components/ui/Grid/services";
import Grid from "src/components/ui/Grid";

const getResponseData = async (signal: AbortSignal) => {
  try {
    const response = await fetch("http://192.168.1.112:3000/json", { signal });
    if (!response.ok) throw new Error(`Ошибка ${response.status}: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") {
      console.error("Ошибка загрузки данных:", error);
    }
    return null;
  }
};

const ActivityHistory: FC = () => {
  const name = ActivityHistory.name;

  const [rows, setRows] = useState<TDataItem[] | null>(null);
  const [columns] = useState<TColumn[]>(getModelColumns(columnsJson, name));
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [order, setOrder] = useState<TOrder>({
    columnID: "actionDate",
    direction: "desc",
  });

  const loadDataGrid = async () => {
    setIsLoading(true);
    const controller = new AbortController();

    try {
      const response = await getResponseData(controller.signal);
      if (response) {
        setRows(sortGridRows(response, order) || []);
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadDataGrid();
    return () => controller.abort(); // Отменяем запрос при размонтировании или изменении `order`
  }, [order]);

  const props = useMemo<TModelProps>(
    () => ({
      name,
      rows: rows || [],
      columns,
      actions: { loadDataGrid },
      states: { isLoading, setIsLoading, order, setOrder },
    }),
    [rows, isLoading, order]
  );

  return <Grid props={props} />;
};

export default ActivityHistory;
