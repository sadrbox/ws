import { useState, FC, useEffect, useMemo, useCallback } from "react";
import columnsJson from "./columns.json";
import { TDataItem, TypeModelProps, TOrder, TypeDateRange } from "src/components/Table/types";
import { getModelColumns, sortGridRows } from "src/components/Grid/services";
// import { checkServerAvailability } from "src/utils/main.module";
import Table from "src/components/Table";

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

  const url = `http://192.168.1.112:3000/api/v1/ActivityHistories?${params.toString()}`;

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


const ActivityHistories: FC = () => {
  const name = ActivityHistories.name;
  const [rows, setRows] = useState<TDataItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [orderQuery, setOrderQuery] = useState<TOrder>({
    columnID: "actionDate",
    direction: "desc",
  });
  // const [activeRowQuery, setActiveRowsQuery] = useState<number | null>(null);
  // const [marked, setCheckedRowsQuery] = useState()
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  // const [isSelectedRows, setIsSelectedRows] = useState<boolean>(false);
  const [fastSearchQuery, setFastSearchQuery] = useState<string>("");
  const [dateRangeQuery, setDateRangeQuery] = useState<TypeDateRange>({ startDate: null, endDate: null })

  // useEffect(() => {
  //   if (isSelectedRows) {
  //     setSelectedRows(rows.map(row => row.id as number))
  //   } else {
  //     setSelectedRows([])
  //   }
  // }, [isSelectedRows])

  // useEffect(() => {
  //   if (selectedRows.length === rows.length) {
  //     setIsSelectedRows(true)
  //   } else if (selectedRows.length < rows.length) {
  //     setIsSelectedRows(false)
  //   }
  // }, [selectedRows])


  const isSelectedRows = rows.length > 0 && selectedRows.length === rows.length;
  const toggleSelectAllRows = () => {
    if (isSelectedRows) {
      setSelectedRows([]);
    } else {
      setSelectedRows(rows.map(row => row.id as number));
    }
  };

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

      const response = await getResponseData(controller.signal, page, limit, dateRangeQuery, fastSearchQuery, searchColumns);
      if (response) {
        // Сортируем данные сразу после получения
        // console.log(response)
        if (currentPage > response?.totalPages) {
          setCurrentPage(response?.totalPages || 1)
        }
        setRows(sortGridRows(response?.items, orderQuery) || []);
        setTotalPages(response?.totalPages || 0);
      } else {
        setRows([]);
      }
    } finally {
      // setActiveRowsQuery(null)
      setIsLoading(false);
    }
  }, [orderQuery, currentPage, fastSearchQuery, dateRangeQuery]); // Зависимость от order для корректной сортировки

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
      query: {
        orderQuery,
        setOrderQuery,
        fastSearchQuery,
        setFastSearchQuery,
        dateRangeQuery,
        setDateRangeQuery,
      },
      actions: { loadDataGrid },
      states: { isLoading, setIsLoading, selectedRows, setSelectedRows, isSelectedRows, toggleSelectAllRows },
    }),
    [name, rows, columns, isLoading, loadDataGrid, currentPage, orderQuery, dateRangeQuery, fastSearchQuery, selectedRows]
  );

  return <Table props={props} />;
};

export default ActivityHistories;

