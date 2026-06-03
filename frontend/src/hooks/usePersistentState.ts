/**
 * usePersistentState — useState, значение которого сохраняется в localStorage.
 *
 * Поведение полностью повторяет useState (включая ленивую инициализацию и
 * функциональные апдейтеры), но при монтировании значение восстанавливается из
 * localStorage по ключу `key`, а при каждом изменении — записывается обратно.
 *
 * Используется для запоминания настроек/фильтров отчётов между сессиями (см.
 * отчёты в src/models/Reports), чтобы при повторном открытии отчёта применялись
 * последние использованные параметры.
 *
 * Ключи namespace-ются префиксом, чтобы не конфликтовать с другими данными.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "ui.persist.";

function read<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(PREFIX + key);
		if (raw != null) return JSON.parse(raw) as T;
	} catch {
		/* повреждённое значение / недоступный storage — используем fallback */
	}
	return fallback;
}

function write<T>(key: string, value: T): void {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify(value));
	} catch {
		/* квота / приватный режим — молча игнорируем */
	}
}

export function usePersistentState<T>(
	key: string,
	initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
	const initialRef = useRef(initial);
	const [state, setState] = useState<T>(() => {
		const fallback =
			typeof initialRef.current === "function"
				? (initialRef.current as () => T)()
				: initialRef.current;
		return read(key, fallback);
	});

	// Если ключ изменился (переиспользование хука) — перечитываем значение.
	const keyRef = useRef(key);
	useEffect(() => {
		if (keyRef.current === key) return;
		keyRef.current = key;
		const fallback =
			typeof initialRef.current === "function"
				? (initialRef.current as () => T)()
				: initialRef.current;
		setState(read(key, fallback));
	}, [key]);

	// Сохраняем при каждом изменении значения.
	useEffect(() => {
		write(key, state);
	}, [key, state]);

	return [state, setState];
}

export default usePersistentState;
