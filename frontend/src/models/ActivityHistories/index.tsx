import { useState, FC, useEffect, useMemo, useCallback } from "react";
import columnsJson from "./columns.json";
import { TDataItem, TypeModelProps, TOrder } from "src/components/ui/Table/types";
import { getModelColumns, sortGridRows } from "src/components/ui/Grid/services";
import { checkServerAvailability } from "src/utils/main.module";
import Table from "src/components/ui/Table";
import Modal from "src/components/ui/Modal";
import FieldString from "src/components/ui/Field/FieldString";
import FieldSelect from "src/components/ui/Field/FieldSelect";
import styles from "./ActivityHistories.module.scss"

const getResponseData = async (signal: AbortSignal, currentPage: number, limit: number) => {
  const url = `http://192.168.1.112:3000/api/v1/ActivityHistories?page=${currentPage}&limit=${limit}`;

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
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [order, setOrder] = useState<TOrder>({
    columnID: "actionDate",
    direction: "desc",
  });

  // Колонки зависят от состояния isLoading
  const columns = useMemo(() => getModelColumns(columnsJson, name), [isLoading]);

  // Загрузка данных
  const loadDataGrid = useCallback(async (currentPage: number = 1, limit: number = 100) => {
    const controller = new AbortController();
    setIsLoading(true);

    try {
      const response = await getResponseData(controller.signal, currentPage, limit);
      if (response) {
        // Сортируем данные сразу после получения
        // console.log(response)
        setRows(sortGridRows(response?.items, order) || []);
        setTotalPages(response?.totalPages || 0);
      } else {
        setRows([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [order, currentPage]); // Зависимость от order для корректной сортировки

  // Загружаем данные при монтировании и изменении порядка сортировки
  useEffect(() => {
    loadDataGrid(currentPage);
  }, [loadDataGrid]);


  // Мемоизация пропсов для Grid
  const props = useMemo<TypeModelProps>(
    () => ({
      name,
      rows,
      columns,
      pagination: {
        currentPage,
        setCurrentPage,
        totalPages,
      },
      actions: { loadDataGrid },
      states: { isLoading, setIsLoading, order, setOrder },
    }),
    [rows, columns, currentPage, isLoading, loadDataGrid, order, name]
  );

  return <Table props={props} />;
};

export default ActivityHistories;

