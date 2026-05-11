import { useCallback, useRef, useSyncExternalStore } from "react";
import { getCurrentUser } from "src/services/auth";

// ═══════════════════════════════════════════════════════════════════════════
// External Store для данных формы с сохранением в localStorage (по userId)
// ═══════════════════════════════════════════════════════════════════════════
//
// Использование:
//   const [formData, setFormData] = useFormSessionStore<TFormData>("users-form", uuid, EMPTY_FORM);
//
// При каждом setFormData данные автоматически пишутся в localStorage.
// При монтировании (или F5 / обновлении страницы) данные восстанавливаются.
// Ключ: "formStore:<userId>:<formName>:<entityId>" — черновики различных пользователей
// изолированы.

const STORAGE_PREFIX = "formStore:";

function getUserId(): string {
	return getCurrentUser()?.uuid || "anon";
}

function userPrefix(): string {
	return `${STORAGE_PREFIX}${getUserId()}:`;
}

type Listener = () => void;

/** Создаёт external store для одного ключа. */
function createFormStore<T>(storageKey: string, initialValue: T) {
	const listeners: Set<Listener> = new Set();
	let currentValue: T = initialValue;

	// Пробуем восстановить из localStorage
	try {
		const raw = localStorage.getItem(storageKey);
		if (raw !== null) {
			currentValue = JSON.parse(raw) as T;
		}
	} catch {
		// corrupted data — используем initialValue
	}

	function subscribe(listener: Listener): () => void {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}

	function getSnapshot(): T {
		return currentValue;
	}

	function setState(updater: T | ((prev: T) => T)): void {
		const next =
			typeof updater === "function"
				? (updater as (prev: T) => T)(currentValue)
				: updater;

		// Пропускаем если значение не изменилось (поверхностное сравнение)
		if (next === currentValue) return;

		currentValue = next;

		// Сохраняем в localStorage
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
		} catch {
			// quota exceeded — игнорируем
		}

		// Уведомляем подписчиков
		listeners.forEach((l) => l());
	}

	function cleanup(): void {
		try {
			localStorage.removeItem(storageKey);
		} catch {
			/* ignore */
		}
		listeners.clear();
	}

	/** Были ли данные восстановлены из localStorage при создании store?
	 *  Ранее использовалось простое сравнение по ссылке (currentValue !== initialValue),
	 *  что давало true если значения равны по содержимому, но были разными объектами
	 *  (например после восстановления из sessionStorage). Это приводило к ложным
	 *  уведомлениям "несохранённых правок" при открытии формы, которая на самом деле
	 *  не была изменена. Теперь сравниваем через сериализацию JSON (по содержимому).
	 */
	let hadStoredData = false;
	try {
		hadStoredData =
			JSON.stringify(currentValue) !== JSON.stringify(initialValue);
	} catch {
		// Если сериализация не удалась, fallback на ссылочное сравнение
		hadStoredData = currentValue !== initialValue;
	}

	return { subscribe, getSnapshot, setState, cleanup, hadStoredData };
}

// Кэш активных store по ключу — чтобы несколько хуков с одним ключом
// видели одни данные (синглтон на ключ).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storeCache = new Map<string, ReturnType<typeof createFormStore<any>>>();

function getOrCreateStore<T>(storageKey: string, initialValue: T) {
	if (!storeCache.has(storageKey)) {
		storeCache.set(storageKey, createFormStore<T>(storageKey, initialValue));
	}
	return storeCache.get(storageKey)! as ReturnType<typeof createFormStore<T>>;
}

/**
 * Хук для данных формы с автосохранением в localStorage (по userId).
 *
 * @param formName  — имя модели/формы (например "users-form")
 * @param entityId  — uuid или "new" для новой записи
 * @param initialValue — начальное значение формы
 * @param options.keepOnUnmount — если true, данные НЕ удаляются при размонтировании (по умолчанию false)
 *
 * @returns [data, setData, clearStorage, hadStoredData] — как useState + очистка + флаг восстановления
 */
export function useFormSessionStore<T>(
	formName: string,
	entityId: string | undefined,
	initialValue: T,
	options?: { keepOnUnmount?: boolean },
): [T, (updater: T | ((prev: T) => T)) => void, () => void, boolean] {
	const storageKey = `${userPrefix()}${formName}:${entityId ?? "new"}`;
	const keepOnUnmount = options?.keepOnUnmount ?? false;

	// Получаем или создаём store для этого ключа
	const storeRef = useRef(getOrCreateStore<T>(storageKey, initialValue));

	// Если ключ изменился (другой entityId) — пересоздаём store
	if (storeRef.current !== storeCache.get(storageKey)) {
		storeRef.current = getOrCreateStore<T>(storageKey, initialValue);
	}

	const store = storeRef.current;

	const data = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);

	const setData = useCallback(
		(updater: T | ((prev: T) => T)) => {
			store.setState(updater);
		},
		[store],
	);

	const clearStorage = useCallback(() => {
		store.cleanup();
		storeCache.delete(storageKey);
	}, [store, storageKey]);

	// Очистка при размонтировании (если не keepOnUnmount)
	// Используем useRef + эффект, чтобы не зависеть от clearStorage в deps
	const clearRef = useRef(clearStorage);
	clearRef.current = clearStorage;
	const keepRef = useRef(keepOnUnmount);
	keepRef.current = keepOnUnmount;

	// Cleanup at unmount
	// useEffect(() => {
	//   return () => {
	//     if (!keepRef.current) {
	//       clearRef.current();
	//     }
	//   };
	// }, [storageKey]);

	return [data, setData, clearStorage, store.hadStoredData];
}

/**
 * Утилита для очистки всех данных форм текущего пользователя из localStorage.
 * Полезно при logout. Черновики других пользователей (если были) не трогаются.
 */
export function clearAllFormStores(): void {
	const prefix = userPrefix();
	const keysToRemove: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key?.startsWith(prefix)) {
			keysToRemove.push(key);
		}
	}
	keysToRemove.forEach((k) => localStorage.removeItem(k));
	// Очистка in-memory кэша только для своих ключей
	for (const key of Array.from(storeCache.keys())) {
		if (key.startsWith(prefix)) storeCache.delete(key);
	}
}

/**
 * Запись несохранённой формы из localStorage.
 */
export interface FormStoreEntry {
	/** Полный ключ localStorage */
	storageKey: string;
	/** Имя формы (например "users-form") */
	formName: string;
	/** ID сущности или "new" */
	entityId: string;
	/** Сырые данные формы */
	data: Record<string, unknown>;
}

/**
 * Получить все несохранённые записи форм текущего пользователя из localStorage.
 * Возвращает массив FormStoreEntry для каждого ключа `formStore:<userId>:*`.
 */
export function getAllFormStoreEntries(): FormStoreEntry[] {
	const prefix = userPrefix();
	const entries: FormStoreEntry[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (!key?.startsWith(prefix)) continue;

		// Ключ: "formStore:<userId>:<formName>:<entityId>"
		const rest = key.slice(prefix.length); // "users-form:some-uuid"
		const colonIdx = rest.indexOf(":");
		if (colonIdx === -1) continue;

		const formName = rest.slice(0, colonIdx);
		const entityId = rest.slice(colonIdx + 1);

		try {
			const raw = localStorage.getItem(key);
			if (raw === null) continue;
			const data = JSON.parse(raw) as Record<string, unknown>;
			entries.push({ storageKey: key, formName, entityId, data });
		} catch {
			// corrupted — skip
		}
	}
	return entries;
}

/**
 * Удалить одну запись из localStorage по storageKey.
 */
export function removeFormStoreEntry(storageKey: string): void {
	try {
		localStorage.removeItem(storageKey);
	} catch {
		/* ignore */
	}
	storeCache.delete(storageKey);
}
