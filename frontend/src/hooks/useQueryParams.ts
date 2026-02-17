import { useState, useEffect, useCallback } from "react";

type Updater<T> = T | ((prev: T) => T);

const useQueryParams = <T>(
	name: string,
	defaultValue: T,
	initialFromApi?: T,
	options: {
		/** Как превратить значение в строку для URL (по умолчанию String) */
		stringify?: (value: T) => string;
		/** Нужно ли удалять параметр из URL при значении === defaultValue */
		removeOnDefault?: boolean;
	} = {},
) => {
	const { stringify = String, removeOnDefault = true } = options;

	// Начальное значение берём ТОЛЬКО из API или defaultValue
	// То, что уже лежит в URL на момент монтирования — игнорируем
	const [value, setValue] = useState<T>(initialFromApi ?? defaultValue);

	const syncToUrl = useCallback(
		(newValue: T) => {
			const params = new URLSearchParams(window.location.search);

			if ((newValue === defaultValue || newValue == null) && removeOnDefault) {
				params.delete(name);
			} else {
				const serialized = stringify(newValue);
				if (serialized) {
					params.set(name, serialized);
				} else {
					params.delete(name);
				}
			}

			const newSearch = params.toString();
			const newUrl = newSearch ? `?${newSearch}` : window.location.pathname;

			// Обновляем URL без создания новой записи в истории
			window.history.replaceState(null, "", newUrl);
		},
		[name, defaultValue, stringify, removeOnDefault],
	);

	// Синхронизируем URL при изменении значения
	useEffect(() => {
		// Можно добавить условие, если не хотите обновлять URL при каждом рендере
		// например: если значение === defaultValue → не трогаем URL
		syncToUrl(value);
	}, [value, syncToUrl]);

	// Удобная обёртка для setValue, совместимая с useState
	const setQueryParam = useCallback((updater: Updater<T>) => {
		setValue((prev) => {
			const nextValue =
				typeof updater === "function"
					? (updater as (prev: T) => T)(prev)
					: updater;

			return nextValue;
		});
	}, []);

	return [value, setQueryParam] as const;
};

export default useQueryParams;
