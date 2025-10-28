// Frontend
import { FC, useEffect, useMemo, useState } from "react";
import columnsJson from "./columns.json"; // Убедитесь, что путь правильный
import { TColumn, TDataItem, TypeModelProps, TypeTableParams } from "src/components/Table/types"; // Убедитесь, что путь правильный
import { getModelColumns, sortTableRows } from "src/components/Table/services"; // Убедитесь, что путь правильный
import Table from "src/components/Table"; // Убедитесь, что путь правильный
import { API_BASE_URL } from "src/app/constants"; // Убедитесь, что путь правильный
import { useQuery } from "@tanstack/react-query";

// Удаляем лишний AbortController.abort() в finally, т.к. useQuery управляет сигналом
const fetchData = async (queryParams: TypeTableParams): Promise<{
  items: TDataItem[];
  total: number; // Добавил total в тип возвращаемого значения
  totalPages: number;
} | null> => {
  if (!queryParams?.model) return null;

  // AbortController создается здесь, но его abort() будет вызван React Query
  // когда запрос устареет или отменится. Нам не нужно вызывать его вручную в finally.
  const controller = new AbortController();
  const signal = controller.signal;


  const params = new URLSearchParams({
    page: queryParams.page?.toString() ?? "1",
    limit: queryParams.limit?.toString() ?? "100",
  });

  if (queryParams.sort) {
    params.append("sort", JSON.stringify(queryParams.sort));
  }
  if (queryParams.filter) {
    params.append("filter", JSON.stringify(queryParams.filter));
  }
  // Отправляем selectedIds только если они есть и не пустые
  if (queryParams.selectedIds && queryParams.selectedIds.size > 0) {
    params.append("selectedIds", JSON.stringify(Array.from(queryParams.selectedIds)));
  }

  // console.log(params.toString())
  const url = `${API_BASE_URL}/${queryParams.model.toString()}?${params.toString()}`;

  try {
    const response = await fetch(url, { signal }); // Передаем сигнал в fetch
    if (!response.ok) {
      // Попытка прочитать ошибку из тела ответа, если есть
      let errorDetails = response.statusText;
      try {
        const errorJson = await response.json();
        if (errorJson.message) errorDetails = errorJson.message;
        else if (errorJson.error) errorDetails = errorJson.error;
      } catch (e) { /* ignore json parse error */ }

      throw new Error(`Ошибка ${response.status}: ${errorDetails}`);
    }
    return await response.json();
  } catch (error) {
    // AbortError игнорируется React Query автоматически при отмене запроса
    if (error instanceof Error && error.name !== "AbortError") {
      console.error("Ошибка загрузки данных:", error);
    }
    // Важно выбросить ошибку или вернуть null/undefined, чтобы React Query
    // знал, что запрос не удался
    throw error; // Перебрасываем ошибку дальше, React Query ее поймает
  }
  // finally {
  //     // Удален controller.abort() - это делает React Query
  // }
};

const DEFAULT_PARAMS: TypeTableParams = {
  model: "Counterparties",
  page: 1,
  limit: 100,
  sort: { columnID: 'id', direction: 'asc' },
  filter: { searchBy: { columns: [], value: "" }, dateRange: { startDate: null, endDate: null } }, // Уточняем структуру фильтра по умолчанию
  selectedIds: new Set(), // Уточняем структуру по умолчанию
};

export const useQueryParams = (initProps?: Partial<TypeTableParams>) => {
  const [params, setParams] = useState<TypeTableParams>({
    ...DEFAULT_PARAMS,
    ...initProps,
    // Глубокое слияние для filter и selectedIds, если они переданы в initProps
    filter: {
      ...DEFAULT_PARAMS.filter,
      ...(initProps?.filter ?? {}),
    },
    selectedIds: initProps?.selectedIds instanceof Set
      ? initProps.selectedIds // Используем переданный Set, если это Set
      : DEFAULT_PARAMS.selectedIds, // Иначе используем дефолтный
  });

  const setQueryParams = (newParams: Partial<TypeTableParams>) => {
    setParams(prev => {
      // Копируем предыдущие параметры
      const updatedParams = { ...prev };

      // Специальное слияние для filter (т.к. это объект)
      if (newParams.filter !== undefined) {
        updatedParams.filter = { ...prev.filter, ...newParams.filter };
      }

      // Специальное слияние/замена для selectedIds (т.к. это Set)
      // Если newParams.selectedIds - это Set, используем его
      // Если undefined, оставляем prev.selectedIds
      // Если null или другой тип, можно решить как обрабатывать (сейчас оставим prev)
      if (newParams.selectedIds !== undefined) {
        // Если передан Set, используем его, иначе игнорируем (или обрабатываем иначе по логике)
        if (newParams.selectedIds instanceof Set) {
          updatedParams.selectedIds = newParams.selectedIds;
        } else {
          // Здесь можно решить, что делать, если передали не Set
          // Например, сбросить selectedIds в пустой Set: updatedParams.selectedIds = new Set();
          console.warn("setQueryParams called with non-Set for selectedIds", newParams.selectedIds);
        }
      }


      // Слияние всех остальных параметров поверх скопированных
      // Это перезапишет page, limit, sort, model и т.д., а также filter/selectedIds
      // если они были простыми значениями, но наши спецобработчики выше более приоритетны для этих полей
      return {
        ...updatedParams, // Обновленные filter и selectedIds уже здесь
        ...newParams, // Остальные параметры (page, limit, sort, model и т.д.)
        // Гарантируем, что filter и selectedIds остаются объектами/Set из updatedParams
        filter: updatedParams.filter,
        selectedIds: updatedParams.selectedIds,
      };
    });
  };

  return [params, setQueryParams] as const;
};

const Counterparties: FC = () => {
  // Получаем имя модели из имени компонента
  const model = "Counterparties"; // Лучше явно указать строку, чем полагаться на .name
  const [columns, setColumns] = useState<TColumn[]>(getModelColumns(columnsJson, model))
  const [queryParams, setQueryParams] = useQueryParams({ model });

  // useEffect(() => {

  //   setColumns
  //   // getModelColumns(columnsJson, model),
  //   // Зависимости useMemo должны быть только от входных данных
  // },[columns]);


  // Удален отладочный useEffect

  const {
    data,
    isLoading,
    isFetching, // Можно использовать isFetching для индикации загрузки при смене параметров
    error, // Получаем ошибку из React Query
    refetch,
  } = useQuery({
    queryKey: [model, queryParams], // queryKey: [строка модели, объект параметров]
    queryFn: () => fetchData(queryParams),
    // Опции React Query
    // staleTime: 60 * 1000, // Данные считаются "свежими" 1 минуту
    // keepPreviousData: true, // Позволяет показывать старые данные пока грузятся новые
    retry: 2, // Повторить запрос 2 раза при ошибке
    // Включаем автоматическое управление AbortController через useQuery
  });

  // Обработка ошибок загрузки
  useEffect(() => {
    if (error) {
      console.error("React Query Error fetching Counterparties:", error);
      // Здесь можно показать уведомление пользователю об ошибке
      // Например, с помощью какой-либо библиотеки для тостов/уведомлений
      // alert(`Ошибка загрузки данных: ${error.message}`);
    }
  }, [error]);




  const rows = useMemo(() => {
    return data?.items ? sortTableRows(data.items, queryParams.sort) : [];
  }, [data?.items, queryParams.sort]); // Зависим только от items и sort

  const totalPages = data?.totalPages || 0; // И total из ответа

  const props = useMemo<Omit<TypeModelProps, 'states'>>(
    () => ({
      model,
      rows,
      columns,
      totalPages,
      isLoading,
      isFetching,
      query: {
        queryParams,
        setQueryParams,
      },
      actions: { refetch, setColumns },
      // states: {
      //   isLoading: isLoading || isFetching, // Индикация загрузки, включая фоновые выборки
      //   // setIsLoading: () => {} // Этот пропс больше не нужен с useQuery
      // },
      error: error, // Передаем ошибку в Table компонент, если нужно ее там отобразить
    }),
    // Зависимости props: все, что используется внутри
    [model, rows, columns, totalPages, queryParams, setQueryParams, refetch, isLoading, isFetching, error]
  );

  return <Table props={props} />;
};

export default Counterparties;