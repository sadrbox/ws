// hooks/useApiRequest.ts
import {
	useState,
	useCallback,
	useRef,
	useEffect,
	DependencyList,
	useMemo,
} from "react";
import { apiClient, ApiError } from "src/app/services/api/client";

/**
 * Типы HTTP методов
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Конфигурация запроса
 */
export interface ApiRequestConfig<T = any> {
	// Основные параметры
	url: string;
	method?: HttpMethod;
	data?: any;
	params?: Record<string, any>;
	headers?: Record<string, string>;

	// Опции запроса
	timeout?: number;
	signal?: AbortSignal;
	withCredentials?: boolean;
	responseType?: "json" | "text" | "blob" | "arraybuffer";

	// Опции хука
	manual?: boolean; // Только ручной запуск
	lazy?: boolean; // Не выполнять при монтировании
	cacheTime?: number; // Время кэширования в ms
	staleTime?: number; // Время до устаревания данных
	retry?: number; // Количество повторных попыток
	retryDelay?: number | ((attempt: number) => number); // Задержка между попытками

	// Валидация и трансформация
	validate?: (data: any) => boolean;
	transform?: (data: any) => T;

	// Колбэки
	onSuccess?: (data: T, response: any) => void;
	onError?: (error: ApiError) => void;
	onFinish?: () => void;
}

/**
 * Состояние запроса
 */
export interface ApiRequestState<T = any> {
	data: T | null;
	error: ApiError | null;
	isLoading: boolean;
	isFetching: boolean; // Added this property
	isSuccess: boolean;
	isError: boolean;
	status: "idle" | "loading" | "success" | "error";
	response: any | null;
}

/**
 * Результат хука
 */
export interface UseApiRequestResult<T = any> {
	// Состояние
	data: T | null;
	error: ApiError | null;
	isLoading: boolean;
	isFetching: boolean;
	isSuccess: boolean;
	isError: boolean;
	status: "idle" | "loading" | "success" | "error";
	response: any | null;

	// Методы
	execute: (config?: Partial<ApiRequestConfig<T>>) => Promise<T>;
	mutate: (data: Partial<T> | ((prev: T | null) => T)) => void;
	reset: () => void;
	abort: () => void;

	// Информация
	requestCount: number;
	lastUpdated: Date | null;
	isStale: boolean;
}

/**
 * Опции хука useApiRequest
 */
export interface UseApiRequestOptions<T = any> {
	// Дефолтные настройки
	defaultConfig?: Partial<ApiRequestConfig<T>>;

	// Оптимизации
	enabled?: boolean;
	keepPreviousData?: boolean;

	// Зависимости для авто-выполнения
	deps?: DependencyList;

	// Колбэки
	onMount?: () => void;
}

/**
 * Основной хук для выполнения API запросов
 */
export function useApiRequest<T = any>(
	config: ApiRequestConfig<T> | string,
	options: UseApiRequestOptions<T> = {},
): UseApiRequestResult<T> {
	const {
		defaultConfig = {},
		enabled = true,
		keepPreviousData = false,
		deps = [],
		onMount,
	} = options;

	// Нормализация конфига
	const normalizedConfig = useMemo(() => {
		const baseConfig =
			typeof config === "string"
				? { url: config, method: "GET" as HttpMethod }
				: config;

		return {
			method: "GET" as HttpMethod,
			...defaultConfig,
			...baseConfig,
		};
	}, [config, defaultConfig]);

	// Состояние запроса
	const [state, setState] = useState<ApiRequestState<T>>(() => ({
		data: null,
		error: null,
		isLoading: false,
		isFetching: false,
		isSuccess: false,
		isError: false,
		status: "idle",
		response: null,
	}));

	// Рефы
	const abortControllerRef = useRef<AbortController | null>(null);
	const requestCountRef = useRef(0);
	const lastUpdatedRef = useRef<Date | null>(null);
	const cacheRef = useRef<Map<string, { data: T; timestamp: number }>>(
		new Map(),
	);
	const retryCountRef = useRef(0);

	/**
	 * Генерация ключа кэша
	 */
	const getCacheKey = useCallback((reqConfig: ApiRequestConfig<T>): string => {
		const { url, method, data, params } = reqConfig;
		return JSON.stringify({ url, method, data, params });
	}, []);

	/**
	 * Проверка кэша
	 */
	const getFromCache = useCallback(
		(key: string): T | null => {
			const cached = cacheRef.current.get(key);
			if (!cached) return null;

			const { data, timestamp } = cached;
			const now = Date.now();
			const cacheTime = normalizedConfig.cacheTime || 5 * 60 * 1000; // 5 минут по умолчанию

			if (now - timestamp > cacheTime) {
				cacheRef.current.delete(key);
				return null;
			}

			return data;
		},
		[normalizedConfig.cacheTime],
	);

	/**
	 * Сохранение в кэш
	 */
	const saveToCache = useCallback((key: string, data: T) => {
		cacheRef.current.set(key, {
			data,
			timestamp: Date.now(),
		});
	}, []);

	/**
	 * Очистка устаревшего кэша
	 */
	const cleanupCache = useCallback(() => {
		const now = Date.now();
		const cacheTime = normalizedConfig.cacheTime || 5 * 60 * 1000;

		cacheRef.current.forEach((value, key) => {
			if (now - value.timestamp > cacheTime) {
				cacheRef.current.delete(key);
			}
		});
	}, [normalizedConfig.cacheTime]);

	/**
	 * Выполнение запроса
	 */
	const execute = useCallback(
		async (overrideConfig?: Partial<ApiRequestConfig<T>>): Promise<T> => {
			// Отмена предыдущего запроса
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}

			// Создаем новый AbortController
			const abortController = new AbortController();
			abortControllerRef.current = abortController;

			// Объединяем конфиги
			const requestConfig: ApiRequestConfig<T> = {
				...normalizedConfig,
				...overrideConfig,
				signal: abortController.signal,
			};

			const cacheKey = getCacheKey(requestConfig);

			// Проверка кэша
			if (requestConfig.method === "GET") {
				const cachedData = getFromCache(cacheKey);
				if (cachedData) {
					const isStale = lastUpdatedRef.current
						? Date.now() - lastUpdatedRef.current.getTime() >
							(requestConfig.staleTime || 0)
						: false;

					if (!isStale) {
						setState((prev) => ({
							...prev,
							data: cachedData,
							status: "success",
							isSuccess: true,
							isLoading: false,
							isError: false,
							error: null,
						}));

						lastUpdatedRef.current = new Date();
						return cachedData;
					}
				}
			}

			// Увеличиваем счетчик запросов
			requestCountRef.current += 1;
			retryCountRef.current = 0;

			// Устанавливаем состояние загрузки
			setState((prev) => ({
				...prev,
				isLoading: true,
				isFetching: true,
				status: "loading",
				isSuccess: false,
				isError: false,
				error: null,
			}));

			try {
				// Подготовка запроса
				const requestOptions = {
					method: requestConfig.method,
					data: requestConfig.data,
					params: requestConfig.params,
					headers: requestConfig.headers,
					timeout: requestConfig.timeout,
					signal: requestConfig.signal,
					withCredentials: requestConfig.withCredentials,
					responseType: requestConfig.responseType,
				};

				// Выполнение запроса
				const response = await apiClient.request<T>({
					url: requestConfig.url,
					...requestOptions,
				});

				// Валидация данных
				if (requestConfig.validate && !requestConfig.validate(response.data)) {
					throw new Error("Данные не прошли валидацию");
				}

				// Трансформация данных
				let transformedData = response.data;
				if (requestConfig.transform) {
					transformedData = requestConfig.transform(response.data);
				}

				// Сохранение в кэш для GET запросов
				if (requestConfig.method === "GET") {
					saveToCache(cacheKey, transformedData);
				}

				// Обновление состояния
				setState({
					data: transformedData,
					error: null,
					isLoading: false,
					isFetching: false,
					isSuccess: true,
					isError: false,
					status: "success",
					response,
				});

				// Обновление времени последнего обновления
				lastUpdatedRef.current = new Date();

				// Вызов колбэка onSuccess
				if (requestConfig.onSuccess) {
					requestConfig.onSuccess(transformedData, response);
				}

				return transformedData;
			} catch (error: any) {
				// Проверка на отмену запроса
				if (error.name === "AbortError") {
					setState((prev) => ({
						...prev,
						isLoading: false,
						isFetching: false,
					}));
					throw error;
				}

				// Обработка ошибок API
				const apiError: ApiError = error.statusCode
					? error
					: {
							message: error.message || "Неизвестная ошибка",
							statusCode: 500,
						};

				// Логика повторных попыток
				const maxRetries = requestConfig.retry || 0;
				const currentRetry = retryCountRef.current;

				if (currentRetry < maxRetries) {
					const retryDelay =
						typeof requestConfig.retryDelay === "function"
							? requestConfig.retryDelay(currentRetry)
							: requestConfig.retryDelay || 1000;

					retryCountRef.current += 1;

					setTimeout(() => {
						execute(requestConfig);
					}, retryDelay);

					throw apiError;
				}

				// Обновление состояния ошибки
				setState((prev) => ({
					...prev,
					error: apiError,
					isLoading: false,
					isFetching: false,
					isSuccess: false,
					isError: true,
					status: "error",
					data: keepPreviousData ? prev.data : null,
				}));

				// Вызов колбэка onError
				if (requestConfig.onError) {
					requestConfig.onError(apiError);
				}

				throw apiError;
			} finally {
				// Вызов колбэка onFinish
				if (requestConfig.onFinish) {
					requestConfig.onFinish();
				}

				// Очистка AbortController
				abortControllerRef.current = null;
			}
		},
		[
			normalizedConfig,
			getCacheKey,
			getFromCache,
			saveToCache,
			keepPreviousData,
		],
	);

	/**
	 * Мутация данных (оптимистичное обновление)
	 */
	const mutate = useCallback(
		(dataOrUpdater: Partial<T> | ((prev: T | null) => T)) => {
			setState((prev) => {
				const newData =
					typeof dataOrUpdater === "function"
						? dataOrUpdater(prev.data)
						: prev.data
							? { ...prev.data, ...dataOrUpdater }
							: (dataOrUpdater as T);

				return {
					...prev,
					data: newData,
				};
			});
		},
		[],
	);

	/**
	 * Сброс состояния
	 */
	const reset = useCallback(() => {
		setState({
			data: null,
			error: null,
			isLoading: false,
			isFetching: false,
			isSuccess: false,
			isError: false,
			status: "idle",
			response: null,
		});
		requestCountRef.current = 0;
		lastUpdatedRef.current = null;
		retryCountRef.current = 0;
	}, []);

	/**
	 * Отмена запроса
	 */
	const abort = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}

		setState((prev) => ({
			...prev,
			isLoading: false,
			isFetching: false,
		}));
	}, []);

	/**
	 * Автоматическое выполнение при монтировании
	 */
	useEffect(() => {
		if (normalizedConfig.manual || normalizedConfig.lazy || !enabled) {
			return;
		}

		execute();

		if (onMount) {
			onMount();
		}
	}, [
		execute,
		normalizedConfig.manual,
		normalizedConfig.lazy,
		enabled,
		onMount,
		...deps,
	]);

	/**
	 * Очистка кэша при размонтировании
	 */
	useEffect(() => {
		const cleanupInterval = setInterval(cleanupCache, 60 * 1000); // Каждую минуту

		return () => {
			clearInterval(cleanupInterval);
			abort(); // Отмена запроса при размонтировании
		};
	}, [cleanupCache, abort]);

	/**
	 * Проверка устаревания данных
	 */
	const isStale = useMemo(() => {
		if (!lastUpdatedRef.current) return true;

		const staleTime = normalizedConfig.staleTime || 0;
		return Date.now() - lastUpdatedRef.current.getTime() > staleTime;
	}, [normalizedConfig.staleTime, state.data]);

	/**
	 * Результат хука
	 */
	const result: UseApiRequestResult<T> = useMemo(
		() => ({
			// Состояние
			...state,
			isFetching: state.isLoading,

			// Методы
			execute,
			mutate,
			reset,
			abort,

			// Информация
			requestCount: requestCountRef.current,
			lastUpdated: lastUpdatedRef.current,
			isStale,
		}),
		[state, execute, mutate, reset, abort, isStale],
	);

	return result;
}

/**
 * Специализированные хуки для разных HTTP методов
 */

// GET запрос
export function useGet<T = any>(
	url: string,
	config?: Omit<ApiRequestConfig<T>, "url" | "method">,
	options?: UseApiRequestOptions<T>,
) {
	return useApiRequest<T>(
		{
			url,
			method: "GET",
			...config,
		},
		options,
	);
}

// POST запрос
export function usePost<T = any>(
	url: string,
	config?: Omit<ApiRequestConfig<T>, "url" | "method">,
	options?: UseApiRequestOptions<T>,
) {
	return useApiRequest<T>(
		{
			url,
			method: "POST",
			...config,
		},
		options,
	);
}

// PUT запрос
export function usePut<T = any>(
	url: string,
	config?: Omit<ApiRequestConfig<T>, "url" | "method">,
	options?: UseApiRequestOptions<T>,
) {
	return useApiRequest<T>(
		{
			url,
			method: "PUT",
			...config,
		},
		options,
	);
}

// PATCH запрос
export function usePatch<T = any>(
	url: string,
	config?: Omit<ApiRequestConfig<T>, "url" | "method">,
	options?: UseApiRequestOptions<T>,
) {
	return useApiRequest<T>(
		{
			url,
			method: "PATCH",
			...config,
		},
		options,
	);
}

// DELETE запрос
export function useDelete<T = any>(
	url: string,
	config?: Omit<ApiRequestConfig<T>, "url" | "method">,
	options?: UseApiRequestOptions<T>,
) {
	return useApiRequest<T>(
		{
			url,
			method: "DELETE",
			...config,
		},
		options,
	);
}

/**
 * Хук для работы с кэшем
 */
export function useApiCache<T = any>() {
	const cache = useRef<
		Map<string, { data: T; timestamp: number; metadata?: any }>
	>(new Map());

	const set = useCallback((key: string, data: T, metadata?: any) => {
		cache.current.set(key, {
			data,
			timestamp: Date.now(),
			metadata,
		});
	}, []);

	const get = useCallback((key: string, maxAge?: number): T | null => {
		const cached = cache.current.get(key);
		if (!cached) return null;

		if (maxAge && Date.now() - cached.timestamp > maxAge) {
			cache.current.delete(key);
			return null;
		}

		return cached.data;
	}, []);

	const remove = useCallback((key: string) => {
		cache.current.delete(key);
	}, []);

	const clear = useCallback(() => {
		cache.current.clear();
	}, []);

	const has = useCallback((key: string): boolean => {
		return cache.current.has(key);
	}, []);

	const keys = useCallback((): string[] => {
		return Array.from(cache.current.keys());
	}, []);

	const size = useCallback((): number => {
		return cache.current.size;
	}, []);

	return {
		set,
		get,
		remove,
		clear,
		has,
		keys,
		size,
		cache: cache.current,
	};
}

/**
 * Хук для предзагрузки данных
 */
export function usePrefetch<T = any>() {
	const cache = useApiCache<T>();

	const prefetch = useCallback(
		async (config: ApiRequestConfig<T>): Promise<T | null> => {
			const cacheKey = JSON.stringify({
				url: config.url,
				method: config.method,
				params: config.params,
			});

			// Проверка кэша
			const cached = cache.get(cacheKey);
			if (cached) {
				return cached;
			}

			// Выполнение запроса
			try {
				const response = await apiClient.request<T>({
					url: config.url,
					method: config.method || "GET",
					params: config.params,
					data: config.data,
				});

				cache.set(cacheKey, response.data);
				return response.data;
			} catch (error) {
				console.error("Prefetch error:", error);
				return null;
			}
		},
		[cache],
	);

	return {
		prefetch,
		cache,
	};
}
