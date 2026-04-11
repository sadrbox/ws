import { useState, useCallback } from "react";

type Updater<T> = T | ((prev: T) => T);

const useQueryParams = <T>(
	_name: string,
	defaultValue: T,
	initialFromApi?: T,
	_options: {
		/** Как превратить значение в строку для URL (по умолчанию String) */
		stringify?: (value: T) => string;
		/** Нужно ли удалять параметр из URL при значении === defaultValue */
		removeOnDefault?: boolean;
	} = {},
) => {
	// Начальное значение берём ТОЛЬКО из API или defaultValue
	// То, что уже лежит в URL на момент монтирования — игнорируем
	const [value, setValue] = useState<T>(initialFromApi ?? defaultValue);

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
