import { useState, FC, useEffect, useMemo, useCallback } from "react";
import columnsJson from "./columns.json";
import { TDataItem, TypeModelProps, TOrder, TypeDateRange } from "src/components/Table/types";
import { getModelColumns, sortGridRows } from "src/components/Grid/services";
import { checkServerAvailability } from "src/utils/main.module";
import Table from "src/components/Table";
// import Organizations from 'src/models/Organizations';

const getResponseData = async (signal: AbortSignal, page: number, limit: number, filterSearchQuery: TypeDateRange, fastSearchQuery: string, searchColumns: { identifier: string, type: string }[]) => {
  const params = new URLSearchParams({
    page: page.toString(), // String(page ?? 1)
    limit: limit.toString(),
  });

  if (fastSearchQuery.trim()) {
    params.append("searchQuery", fastSearchQuery.trim());
    params.append("searchColumns", JSON.stringify(searchColumns));
  }
  if (filterSearchQuery.startDate) {
    params.append("startDate", filterSearchQuery.startDate);
  }
  if (filterSearchQuery.endDate) {
    params.append("endDate", filterSearchQuery.endDate);
  }
  const url = `http://192.168.1.112:3000/api/v1/organizations?${params.toString()}`;

  // if (!(await checkServerAvailability(url, signal))) {
  //   console.warn("Сервер недоступен.");
  //   return null;
  // }

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

const Organizations: FC = () => {
  const name = Organizations.name;
  const [rows, setRows] = useState<TDataItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [order, setOrder] = useState<TOrder>({
    columnID: "actionDate",
    direction: "desc",
  });
  const [fastSearchQuery, setFastSearchQuery] = useState<string>("");
  const [filterSearchQuery, setFilterSearchQuery] = useState<TypeDateRange>({ startDate: null, endDate: null })

  // Колонки зависят от состояния isLoading
  const columns = useMemo(() => getModelColumns(columnsJson, name), [isLoading]);

  // Загрузка данных
  const loadDataGrid = useCallback(async (page: number = 1, limit: number = 100) => {
    // console.log({ page: page });
    const controller = new AbortController();
    setIsLoading(true);


    const searchColumns = columns.filter(column => column.visible && (column.type === "string" || column.type === "number" || column.type === "object")).map(column => ({ identifier: column.identifier, type: column.type }))
    // console.log(searchColumns)
    try {

      const response = await getResponseData(controller.signal, page, limit, filterSearchQuery, fastSearchQuery, searchColumns);
      if (response) {
        // Сортируем данные сразу после получения
        // console.log(response)
        if (currentPage > response?.totalPages) {
          setCurrentPage(response?.totalPages || 1)
        }
        setRows(sortGridRows(response?.items, order) || []);
        setTotalPages(response?.totalPages || 0);
      } else {
        setRows([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [order, currentPage, fastSearchQuery, filterSearchQuery]); // Зависимость от order для корректной сортировки

  // Загружаем данные при монтировании и изменении порядка сортировки
  // useEffect(() => { setCurrentPage(1) }, [filterSearchQuery, fastSearchQuery])
  useEffect(() => { loadDataGrid(currentPage) }, [loadDataGrid]);


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
      states: { isLoading, setIsLoading, order, setOrder, fastSearchQuery, setFastSearchQuery, filterSearchQuery, setFilterSearchQuery },
    }),
    [rows, columns, currentPage, isLoading, loadDataGrid, order, name, filterSearchQuery, fastSearchQuery]
  );

  return <Table props={props} />;
}
export default Organizations;