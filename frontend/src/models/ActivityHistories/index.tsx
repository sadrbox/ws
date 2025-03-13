import { useState, FC, useEffect, useMemo, useCallback } from "react";
import columnsJson from "./columns.json";
import { TDataItem, TModelProps, TOrder } from "src/components/ui/Grid/types";
import { getModelColumns, sortGridRows } from "src/components/ui/Grid/services";
import Grid from "src/components/ui/Grid";
import { checkServerAvailability } from "src/utils/main.module";

const getResponseData = async (signal: AbortSignal) => {
  const url = "http://192.168.1.112:3000/json";

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

const ActivityHistories: FC = () => {
  const name = ActivityHistories.name;
  const [rows, setRows] = useState<TDataItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [order, setOrder] = useState<TOrder>({
    columnID: "actionDate",
    direction: "desc",
  });

  // Колонки зависят от состояния isLoading
  const columns = useMemo(() => getModelColumns(columnsJson, name), [isLoading]);

  // Загрузка данных
  const loadDataGrid = useCallback(async () => {
    const controller = new AbortController();
    setIsLoading(true);

    try {
      const response = await getResponseData(controller.signal);
      if (response) {
        // Сортируем данные сразу после получения
        // console.log(response)
        setRows(sortGridRows(response, order) || []);
      } else {
        setRows([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [order]); // Зависимость от order для корректной сортировки

  // Загружаем данные при монтировании и изменении порядка сортировки
  useEffect(() => {
    loadDataGrid();
  }, [loadDataGrid]);



  // Мемоизация пропсов для Grid
  const props = useMemo<TModelProps>(
    () => ({
      name,
      rows,
      columns,
      actions: { loadDataGrid }, // setColumns не используется
      states: { isLoading, setIsLoading, order, setOrder },
    }),
    [rows, columns, isLoading, loadDataGrid, order, name]
  );

  return <Grid props={props} />;
};

export default ActivityHistories;