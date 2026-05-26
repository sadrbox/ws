import {
	useCallback,
	useRef,
	useSyncExternalStore,
	useEffect,
	useMemo,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "src/app";
import { isNetworkError } from "src/services/networkUtils";
import { getIsOnline } from "src/services/networkStatus";
import { commitPendingRows } from "src/services/commitPendingRows";
import {
	pipeFetchOne,
	pipeCreate,
	pipeUpdate,
	isOfflineFirst,
} from "src/services/persistencePipe";
import { translateError } from "src/i18";
import { getCurrentUser } from "src/services/auth";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import useUID from "./useUID";
import { stableStringify } from "src/utils/normalize";

// ═══════════════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/** Возвращает true, если значение обязательного поля считается пустым: null/undefined/""/числовой 0 (включая "0.0000"). */
export const isItemFieldEmpty = (value: unknown): boolean => {
	if (value === null || value === undefined || value === "") return true;
	const n = Number(value);
	return !isNaN(n) && n === 0;
};

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

/** Описание одной вложенной таблицы */
export interface TableDef {
	/** API endpoint SubTable (например "contacts", "saleitems") */
	endpoint: string;
	/** FK-поле, связывающее строки с родителем (например "ownerUuid") */
	parentField: string;
	/** Человекочитаемое имя (для ошибок) */
	label: string;
	/** Доп. поля, добавляемые к каждому payload (например { ownerType: "organization" }) */
	extraFields?: Record<string, unknown>;
	/** Кастомные payload-функции */
	createPayload?: (row: TDataItem) => Record<string, unknown>;
	updatePayload?: (row: TDataItem) => Record<string, unknown>;
	extraSkipFields?: string[];
	/** Если true — не добавлять [parentField]: parentUuid к payload createPayload/updatePayload (createPayload сам отвечает за все поля) */
	skipParentField?: boolean;
	/** Batch endpoint (без /). Если задан — все pending-строки отправляются одним POST /{batchEndpoint}/batch */
	batchEndpoint?: string;
	/** Поля, обязательные в каждой не-удалённой строке. Сохранение блокируется, если хотя бы одно пустое. */
	requiredItemFields?: string[];
	/** Читаемые имена для обязательных полей (field → label), используются в сообщении об ошибке. */
	requiredItemFieldLabels?: Record<string, string>;
}

/** Описание полей формы: ключ → значение по умолчанию */
export type FieldDefs<F extends object> = {
	[K in keyof F]: F[K];
};

/** Данные одной вложенной таблицы в store */
export interface TableState {
	/** Строки с _pendingAction (create | update | delete) */
	pending: TDataItem[];
}

/** Полное состояние формы */
export interface FormStoreState<F extends object> {
	fields: F;
	tables: Record<string, TableState>;
	meta: {
		uuid: string | undefined;
		endpoint: string;
		isLoading: boolean;
		isEditMode: boolean;
		error: string | null;
		errorRevision: number;
		tablesValidationFailed: boolean;
		headerValidationFailed: boolean;
	};
}

/** Тип подписки */
type Listener = () => void;

// ═══════════════════════════════════════════════════════════════════════════
// PERSIST (localStorage, по userId)
// Черновики несохранённых форм хранятся в localStorage по ключу
//   formStore:<userId>:<storageKey>:<entityId|new|uniqId>
// Это позволяет переживать перезагрузку страницы (F5) и закрытие вкладки,
// при этом не смешивая данные разных пользователей одного браузера.
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_PREFIX = "formStore:";

/** Текущий userId или "anon" — для разделения черновиков между пользователями. */
export function getFormStoreUserId(): string {
	return getCurrentUser()?.uuid || "anon";
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB_ID — идентификатор вкладки браузера.
// Хранится в sessionStorage, которое:
//   • переживает F5 / навигацию внутри вкладки;
//   • НЕ переживает закрытие вкладки / её процесса;
//   • изолировано между вкладками.
// Это позволяет различить «черновик моей вкладки после F5» (нужно
// восстановить АВТОМАТИЧЕСКИ, чтобы пользователь не потерял правки при
// случайном Ctrl+R / падении страницы) и «черновик другой вкладки / прошлой
// сессии» (предложить восстановить через кнопку stash).
// ═══════════════════════════════════════════════════════════════════════════
const SESSION_TOKEN_KEY = "_st";
const TAB_ID_STORAGE_KEY = "formStore:tabId";
const CURRENT_SESSION_TOKEN = (() => {
	try {
		const existing = sessionStorage.getItem(TAB_ID_STORAGE_KEY);
		if (existing) return existing;
		const fresh = Math.random().toString(36).slice(2) + Date.now().toString(36);
		sessionStorage.setItem(TAB_ID_STORAGE_KEY, fresh);
		return fresh;
	} catch {
		// sessionStorage недоступен (приватный режим и т.п.) — fallback: in-memory.
		return Math.random().toString(36).slice(2) + Date.now().toString(36);
	}
})();

function persistToSession<F extends object>(
	storageKey: string,
	state: FormStoreState<F>,
): void {
	try {
		// Сохраняем fields + tables + токен текущей сессии
		const payload = {
			fields: state.fields,
			tables: state.tables,
			[SESSION_TOKEN_KEY]: CURRENT_SESSION_TOKEN,
		};
		localStorage.setItem(storageKey, JSON.stringify(payload));
	} catch {
		/* quota exceeded */
	}
}

function restoreFromSession<F extends object>(
	storageKey: string,
): {
	fields: F;
	tables: Record<string, TableState>;
	fromCurrentSession: boolean;
} | null {
	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as {
			fields: F;
			tables: Record<string, TableState>;
			[SESSION_TOKEN_KEY]?: string;
		};
		const fromCurrentSession =
			parsed[SESSION_TOKEN_KEY] === CURRENT_SESSION_TOKEN;
		return { fields: parsed.fields, tables: parsed.tables, fromCurrentSession };
	} catch {
		return null;
	}
}

function clearSession(storageKey: string): void {
	try {
		localStorage.removeItem(storageKey);
	} catch {
		/* ignore */
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE STORE (чистый JS, без React)
// ═══════════════════════════════════════════════════════════════════════════

// (singleton удалён вместе с DirtyFieldDiff)

function createFormStore<F extends object>(
	defaultFields: F,
	tableDefs: Record<string, TableDef>,
	endpoint: string,
	uuid: string | undefined,
	storageKey: string,
	derivedFields: ReadonlySet<string> = new Set(),
) {
	// Мутабельный ключ — может измениться после первого save (new → uuid)
	let currentStorageKey = storageKey;
	// Предыдущие ключи (после миграции) — для очистки при закрытии формы
	const previousStorageKeys: string[] = [];

	// ── Начальное состояние ──
	const emptyTables: Record<string, TableState> = {};
	for (const key of Object.keys(tableDefs)) {
		emptyTables[key] = { pending: [] };
	}

	let state: FormStoreState<F> = {
		fields: { ...defaultFields },
		tables: emptyTables,
		meta: {
			uuid,
			endpoint,
			isLoading: false,
			isEditMode: !!uuid,
			error: null,
			errorRevision: 0,
			tablesValidationFailed: false,
				headerValidationFailed: false,
		},
	};

	// Пробуем восстановить из localStorage.
	// Несохранённые данные ВСЕГДА кладём в stash — пользователь явно
	// восстанавливает их кликом кнопки stash, независимо от того,
	// принадлежат ли они текущей вкладке (F5) или другой сессии.
	// Авто-восстановление после F5 было убрано: форма должна показывать
	// актуальные данные с сервера, а не потенциально устаревшие из памяти.
	const hadStoredData = false;
	let pendingStash: { fields: F; tables: Record<string, TableState> } | null =
		null;
	const restored = restoreFromSession<F>(currentStorageKey);
	if (restored) {
		const merged = {
			fields: { ...defaultFields, ...restored.fields } as F,
			tables: (() => {
				const t: Record<string, TableState> = {};
				for (const key of Object.keys(tableDefs)) {
					t[key] = restored.tables?.[key] ?? { pending: [] };
				}
				return t;
			})(),
		};
		pendingStash = merged;
	}

	// snapshotReady = false пока серверный snapshot не загружен (при hadStoredData).
	// Блокирует isDirty() чтобы не мерцал индикатор «Не сохранено».
	let snapshotReady = !hadStoredData;

	// Флаг: первая загрузка с сервера завершена (успех ИЛИ ошибка).
	// Используется для отображения скелетона в ModelForm вместо мигания
	// disabled-полей. Для новых записей (без uuid) — сразу true, фетч не нужен.
	let initialFetchDone = !uuid;
	function isInitialFetchDone(): boolean {
		return initialFetchDone;
	}
	function markInitialFetchDone(): void {
		if (!initialFetchDone) {
			initialFetchDone = true;
			notify();
		}
	}

	function isSnapshotReady(): boolean {
		return snapshotReady;
	}

	// ── Подписчики ──
	const listeners = new Set<Listener>();

	// Монотонный счётчик мутаций — используется как ключ memo-кешей
	// (isDirty / getDirtyDetails / getDirtyFieldDiff). Инкрементируется
	// в notify(), чтобы любая мутация атомарно инвалидировала кеши.
	let revision = 0;
	function notify(): void {
		revision++;
		for (const l of listeners) l();
	}

	function subscribe(listener: Listener): () => void {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}

	function getSnapshot(): FormStoreState<F> {
		return state;
	}

	// ── Debounced persist ──
	let persistTimer: ReturnType<typeof setTimeout> | null = null;
	function schedulePersist(): void {
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			persistToSession(currentStorageKey, state);
		}, 300);
	}

	// ── Мутации ──

	// userChangeSeq — счётчик «значимых» пользовательских изменений полей
	// формы (non-derived). Инкрементируется в setField/setFields только
	// когда реально меняется состояние, отслеживаемое dirty-сравнением.
	// Используется в submit() для безопасного отложенного markClean: если
	// за время между save и следующим React-commit пользователь ничего
	// не поменял — повторно фиксируем «чистый» снапшот, перекрывая ложный
	// dirty от пост-render эффектов (merge SubTable после refetch,
	// handleTotalChange и т.п.).
	let userChangeSeq = 0;
	function getUserChangeSeq(): number {
		return userChangeSeq;
	}

	/** Обновить одно поле формы */
	function setField<K extends keyof F>(field: K, value: F[K]): void {
		if (state.fields[field] === value) return;
		state = {
			...state,
			fields: { ...state.fields, [field]: value },
		};
		if (!derivedFields.has(field as string)) userChangeSeq++;
		notify();
		schedulePersist();
	}

	/** Обновить несколько полей формы за раз */
	function setFields(patch: Partial<F>): void {
		const prevFields = state.fields;
		state = {
			...state,
			fields: { ...state.fields, ...patch },
		};
		for (const k of Object.keys(patch)) {
			if (derivedFields.has(k)) continue;
			if (prevFields[k as keyof F] !== (patch as any)[k]) {
				userChangeSeq++;
				break;
			}
		}
		notify();
		schedulePersist();
	}

	/**
	 * Обновить поля формы без изменения dirty-состояния.
	 * Используется для программного заполнения начальных значений
	 * (например, авто-подстановка основного договора / банковского счёта).
	 * Только патч-поля сливаются в savedSnapshot — реальные изменения
	 * пользователя в других полях сохраняются нетронутыми.
	 */
	function setFieldsInitial(patch: Partial<F>): void {
		state = {
			...state,
			fields: { ...state.fields, ...patch },
		};
		// Сливаем только патч-поля в сохранённый снапшот, чтобы
		// авто-подстановка не воспринималась как изменение пользователя.
		const mergedSnapFields: Record<string, unknown> = { ...parsedSnapshot.fields };
		for (const k of Object.keys(patch)) {
			if (derivedFields.has(k)) continue;
			mergedSnapFields[k] = (state.fields as Record<string, unknown>)[k];
		}
		savedSnapshot = stableStringify({ fields: mergedSnapFields, tables: parsedSnapshot.tables });
		try {
			parsedSnapshot = JSON.parse(savedSnapshot) as typeof parsedSnapshot;
		} catch {
			parsedSnapshot = { fields: mergedSnapFields, tables: parsedSnapshot.tables };
		}
		snapshotRev++;
		notify();
		schedulePersist();
	}

	/** Заменить все поля формы целиком */
	function replaceFields(fields: F): void {
		state = { ...state, fields };
		notify();
		schedulePersist();
	}

	// ── Dirty tracking ──────────────────────────────────────────────────
	// savedSnapshot хранит JSON-строку «чистого» состояния (после load / save).
	// isDirty() сравнивает текущее состояние с последним сохранённым.
	// ⚠️ Инициализация применяет stripDerived — то же самое что делает markClean().
	// Без этого derived-поля (amount: 0 и т.п.) попадают в снапшот, но исключаются
	// из current в isDirty(), что даёт немедленный ложный dirty при открытии формы.
	const _initSnapStr = stableStringify({
		fields: stripDerived(defaultFields as unknown as Record<string, unknown>),
		tables: emptyTables,
	});
	let savedSnapshot: string = _initSnapStr;
	// Версия snapshot — инкрементируется при каждом markClean().
	// Используется как часть ключа memo-кешей dirty-методов.
	let snapshotRev = 0;
	// Парсенный snapshot — кешируется один раз при markClean(),
	// чтобы не делать JSON.parse на каждом вызове getDirtyDetails/getDirtyFieldDiff.
	let parsedSnapshot: {
		fields: Record<string, unknown>;
		tables: Record<string, TableState>;
	};
	try {
		parsedSnapshot = JSON.parse(_initSnapStr);
	} catch {
		parsedSnapshot = { fields: {}, tables: emptyTables };
	}

	/** Сбросить dirty-флаг (вызывать после load / save) */
	function markClean(): void {
		savedSnapshot = stableStringify({
			fields: stripDerived(state.fields as Record<string, unknown>),
			tables: state.tables,
		});
		try {
			parsedSnapshot = JSON.parse(savedSnapshot);
		} catch {
			parsedSnapshot = { fields: {}, tables: {} };
		}
		snapshotRev++;
		snapshotReady = true;
		if (_paneUniqId) resolvePaneNotifications(_paneUniqId);
		notify(); // Уведомить подписчиков (dirty-индикатор на вкладке)
	}

	/**
	 * Отфильтровать derived-поля из объекта (для dirty-сравнения).
	 * Derived-поля — это поля, которые формируются автоматически из других
	 * полей/таблиц (например amount = Σ saleItems.amount). Они НЕ участвуют
	 * в dirty-tracking, так как «изменение» в них является следствием
	 * изменения первичных данных, а не действием пользователя.
	 */
	function stripDerived<T extends Record<string, unknown>>(obj: T): T {
		if (derivedFields.size === 0) return obj;
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(obj)) {
			if (derivedFields.has(k)) continue;
			out[k] = obj[k];
		}
		return out as T;
	}

	/** Есть ли несохранённые изменения? */
	// Memo по (revision, snapshotRev) — пересчитываем только при мутации
	// state или замене сохранённого snapshot.
	let isDirtyMemo: { rev: number; snapRev: number; value: boolean } | null =
		null;
	function isDirty(): boolean {
		// Пока серверный snapshot не загружен — не показывать dirty
		if (!snapshotReady) return false;
		if (
			isDirtyMemo &&
			isDirtyMemo.rev === revision &&
			isDirtyMemo.snapRev === snapshotRev
		) {
			return isDirtyMemo.value;
		}
		const current = stableStringify({
			fields: stripDerived(state.fields as Record<string, unknown>),
			tables: state.tables,
		});
		const value = current !== savedSnapshot;
		isDirtyMemo = { rev: revision, snapRev: snapshotRev, value };
		return value;
	}

	/** Обновить pending-строки вложенной таблицы */
	function setTablePending(tableKey: string, pending: TDataItem[]): void {
		const prev = state.tables[tableKey];
		if (!prev) return;
		state = {
			...state,
			tables: {
				...state.tables,
				[tableKey]: { ...prev, pending },
			},
		};
		notify();
		schedulePersist();
	}

	/** Очистить pending одной таблицы */
	function clearTablePending(tableKey: string): void {
		setTablePending(tableKey, []);
	}

	/** Очистить pending всех таблиц */
	function clearAllTablesPending(): void {
		const next: Record<string, TableState> = {};
		for (const key of Object.keys(state.tables)) {
			next[key] = { pending: [] };
		}
		state = { ...state, tables: next };
		notify();
		schedulePersist();
	}

	/** Обновить meta-поля */
	function setMeta(patch: Partial<FormStoreState<F>["meta"]>): void {
		state = {
			...state,
			meta: { ...state.meta, ...patch },
		};
		notify();
	}

	/** ID панели — устанавливается из хука, используется для push-уведомлений */
	let _paneUniqId: string | undefined;
	/** Текущая метка панели (заголовок документа) — для контекста уведомлений */
	let _paneLabel: string | undefined;
	function setPaneLabel(label: string | undefined): void {
		_paneLabel = label;
	}
	function setPaneUniqId(id: string | undefined): void {
		_paneUniqId = id;
	}

	/** Установить ошибку: пушит уведомление в колокольчик панели */
	function setError(
		msg: string | null,
		noteType?: PaneNotification["type"],
	): void {
		if (msg && _paneUniqId) {
			const entityUuid = state.meta.uuid || (state.fields as any)?.uuid;
			addPaneNotification(_paneUniqId, noteType ?? "error", msg, {
				paneLabel: _paneLabel,
				ref: entityUuid ? { endpoint, uuid: String(entityUuid) } : undefined,
			});
		}
		setMeta({
			error: msg,
			errorRevision: msg
				? state.meta.errorRevision + 1
				: state.meta.errorRevision,
		});
	}

	// ── API ──

	/**
	 * Загрузить данные сущности с сервера.
	 * @param snapshotOnly — если true, НЕ заменять текущие fields/tables,
	 *   а только обновить savedSnapshot серверными данными (для корректного isDirty).
	 *   Используется когда fields восстановлены из sessionStorage.
	 * @param noCache — обходить HTTP-кэш браузера (используется при reload).
	 */
	async function load(
		entityUuid: string,
		mapServerToForm: (data: any, prev?: F) => F | Promise<F>,
		afterLoad?: () => void | Promise<void>,
		snapshotOnly = false,
		noCache = false,
	): Promise<void> {
		setMeta({ isLoading: true });
		setError(null);
		try {
			let d: any;
			let fromCache = false;

			if (isOfflineFirst()) {
				// ── Offline-first pipe: server → Dexie fallback ──
				const result = await pipeFetchOne(endpoint, entityUuid, { noCache });
				if (result) {
					d = result.item;
					fromCache = result.fromCache;
				} else {
					throw new Error("Запись не найдена");
				}
			} else {
				// ── Transactional pipe: только сервер ──
				const result = await pipeFetchOne(endpoint, entityUuid, { noCache });
				if (result) {
					d = result.item;
					fromCache = false;
				} else {
					throw new Error("Запись не найдена");
				}
			}

			const mapped = await Promise.resolve(
				snapshotOnly
					? mapServerToForm(d, undefined) // pure server state — don't let dirty prev bleed into snapshot
					: mapServerToForm(d, state.fields),
			);

			if (snapshotOnly) {
				savedSnapshot = stableStringify({
					fields: stripDerived(mapped as unknown as Record<string, unknown>),
					tables: emptyTables,
				});
				snapshotReady = true;
				// isLoading остаётся true — снимем ПОСЛЕ afterLoad,
				// чтобы поля формы были disabled до резолва invalidate/refetch SubTable.
				setMeta({ isEditMode: true, uuid: entityUuid });
				notify();
			} else {
				replaceFields(mapped);
				clearAllTablesPending();
				setMeta({ isEditMode: true, uuid: entityUuid });
				markClean();
			}

			if (fromCache) {
				const cacheMsg = "Данные загружены из локального кэша (offline-режим).";
				setError(cacheMsg, "info");
			} else if (_paneUniqId) {
				// Свежие данные с сервера — убираем стальные «сетевые» уведомления.
				dismissNetworkNotifications(_paneUniqId);
			}

			// Дожидаемся всех promise в afterLoad (invalidateQueries
			// + refetch SubTable) — только после разрешаем ввод.
			try {
				await Promise.resolve(afterLoad?.());
			} catch {
				/* ошибки afterLoad не блокируют разблокировку формы */
			}
			setMeta({ isLoading: false });
			markInitialFetchDone();
		} catch (err: any) {
			if (isNetworkError(err)) {
				// Различаем «по-настоящему» offline и разовый сбой сервера: если
				// индикатор сети = Online (`getIsOnline()`), было бы ложью говорить
				// «режим offline» — в этом случае показываем транзиентную ошибку.
				const offMsg = getIsOnline()
					? "Сервер временно недоступен. Повторите попытку."
					: "Нет связи с сервером. Работа в режиме offline — данные будут загружены при восстановлении соединения.";
				setError(offMsg, "warning");
			} else {
				setError(
					translateError(err.response?.data?.message) ||
						"Не удалось загрузить данные",
				);
			}
			setMeta({ isLoading: false });
			// Даже при ошибке — снимаем скелетон, чтобы пользователь увидел
			// сообщение об ошибке вместо бесконечной анимации загрузки.
			markInitialFetchDone();
			// Если снапшот не был установлен (F5-восстановление + сервер недоступен),
			// разблокируем isDirty — иначе dirty-индикатор никогда не покажется.
			if (!snapshotReady) {
				snapshotReady = true;
				notify();
			}
		}
	}

	/** Сохранить поля формы на сервере (POST или PUT).
	 *
	 * @param keepLoadingOnSuccess Если true — после успешного сохранения
	 *   оставляет isLoading=true (поля формы остаются disabled). Используется
	 *   handleSaveAndClose, чтобы избежать визуального «прыжка» disabled→enabled
	 *   между окончанием PUT/POST и анмаунтом панели формы.
	 */
	async function submitFields(
		buildPayload: (fields: F) => Record<string, unknown> | string,
		mapServerToForm: (data: any, prev?: F) => F | Promise<F>,
		buildPaneLabel: (saved: any) => string,
		updatePaneLabel: (uniqId: string, label: string) => void,
		uniqId?: string,
		keepLoadingOnSuccess: boolean = false,
	): Promise<{ success: boolean; savedData?: any }> {
		setMeta({ isLoading: true });
		setError(null);
		_paneLabel = buildPaneLabel(state.fields);

		const payloadOrError = buildPayload(state.fields);
		if (typeof payloadOrError === "string") {
			setError(payloadOrError);
			setMeta({ isLoading: false, headerValidationFailed: true });
			return { success: false };
		}

		try {
			const isEdit =
				state.meta.isEditMode &&
				(state.meta.uuid || (state.fields as any).uuid);
			const entityUuid = state.meta.uuid || (state.fields as any).uuid;

			let saved: any;
			let wasOffline = false;

			if (isEdit && entityUuid) {
				const result = await pipeUpdate(endpoint, entityUuid, payloadOrError);
				saved = result.item;
				wasOffline = result.offline;
			} else {
				const result = await pipeCreate(endpoint, payloadOrError);
				saved = result.item;
				wasOffline = result.offline;
			}

			const mapped = await Promise.resolve(
				mapServerToForm(saved, state.fields),
			);
			replaceFields(mapped);
			setMeta({
				isLoading: keepLoadingOnSuccess ? true : false,
				isEditMode: true,
				uuid: saved.uuid ?? entityUuid,
			});

			if (wasOffline) {
				const saveMsg =
					"Сохранено локально. Синхронизация произойдёт при восстановлении связи.";
				setError(saveMsg, "info");
			} else if (_paneUniqId) {
				// Успешное online-сохранение — убираем стальные «сетевые»
				// уведомления, оставшиеся от прежних неудачных load/save.
				dismissNetworkNotifications(_paneUniqId);
			}

			if (uniqId) {
				const label = buildPaneLabel(saved);
				_paneLabel = label;
				updatePaneLabel(uniqId, label);
			}
			return { success: true, savedData: saved };
		} catch (err: any) {
			let msg = "Не удалось сохранить";
			let noteType: PaneNotification["type"] = "error";
			if (isNetworkError(err)) {
				msg = getIsOnline()
					? "Сервер временно недоступен. Повторите попытку сохранения."
					: "Нет связи с сервером. Повторите попытку при восстановлении соединения.";
				noteType = "warning";
			} else if (err.response?.status === 409)
				msg =
					translateError(err.response.data?.message) || "Запись уже существует";
			else if (err.response?.status === 400)
				msg = translateError(err.response.data?.message) || "Ошибка валидации";
			else if (err.message) msg = translateError(err.message);
			setError(msg, noteType);
			setMeta({ isLoading: false });
			return { success: false };
		}
	}

	/**
	 * Коммит pending-строк всех вложенных таблиц на сервер.
	 *
	 * @param parentUuid UUID родительской записи.
	 * @param opts.clear если true (по умолчанию) — после успешной отправки
	 *   очищает локальное pending-состояние таблиц. В flow `submit()` мы
	 *   передаём `clear: false`, чтобы сначала дождаться `afterSave`
	 *   (invalidate+refetch SubTable из react-query), и только потом
	 *   обнулить pending. Иначе SubTable между шагами успевает отрисовать
	 *   устаревшие серверные данные из локального кэша.
	 */
	async function commitAllTables(
		parentUuid: string,
		opts?: { clear?: boolean },
	): Promise<void> {
		const clear = opts?.clear ?? true;
		for (const [key, tableDef] of Object.entries(tableDefs)) {
			const { pending } = state.tables[key];
			if (!pending.length) continue;
			await commitPendingRows(
				tableDef.endpoint,
				pending,
				parentUuid,
				tableDef.parentField,
				tableDef.label,
				{
					createPayload: tableDef.createPayload,
					updatePayload: tableDef.updatePayload,
					extraSkipFields: tableDef.extraSkipFields,
					extraFields: tableDef.extraFields,
					skipParentField: tableDef.skipParentField,
					batchEndpoint: tableDef.batchEndpoint,
				},
			);
		}
		if (clear) clearAllTablesPending();
	}

	/** Коммит pending-строк одной конкретной таблицы */
	async function commitTable(
		tableKey: string,
		parentUuid: string,
	): Promise<void> {
		const tableDef = tableDefs[tableKey];
		if (!tableDef) return;
		const { pending } = state.tables[tableKey];
		if (!pending.length) return;
		await commitPendingRows(
			tableDef.endpoint,
			pending,
			parentUuid,
			tableDef.parentField,
			tableDef.label,
			{
				createPayload: tableDef.createPayload,
				updatePayload: tableDef.updatePayload,
				extraSkipFields: tableDef.extraSkipFields,
				extraFields: tableDef.extraFields,
				skipParentField: tableDef.skipParentField,
				batchEndpoint: tableDef.batchEndpoint,
			},
		);
		clearTablePending(tableKey);
	}

	/** Полная очистка (sessionStorage + reset state) */
	function destroy(): void {
		if (persistTimer) clearTimeout(persistTimer);
		clearSession(currentStorageKey);
		for (const k of previousStorageKeys) storeCache.delete(k);
		previousStorageKeys.length = 0;
		listeners.clear();
	}

	/**
	 * Миграция storageKey (после первого POST: new → uuid).
	 * Удаляет старый ключ из sessionStorage, обновляет текущий, сохраняет state.
	 */
	function migrateStorageKey(newKey: string): void {
		if (newKey === currentStorageKey) return;
		clearSession(currentStorageKey);
		previousStorageKeys.push(currentStorageKey);
		currentStorageKey = newKey;
		storeCache.set(newKey, storeResult as any);
		schedulePersist();
	}

	/** Получить текущий storageKey (для внешних операций с кэшем) */
	function getStorageKey(): string {
		return currentStorageKey;
	}

	// ── Pending stash (несохранённые данные из прошлой сессии) ─────────────
	// Используется только при открытии формы через "Несохранённые записи".
	function hasPendingStash(): boolean {
		return pendingStash !== null;
	}
	/** Применить stash к state. Вызывается при открытии через "Несохранённые записи". */
	function applyPendingStash(): void {
		if (!pendingStash) return;
		state = {
			...state,
			fields: { ...state.fields, ...pendingStash.fields },
			tables: { ...state.tables, ...pendingStash.tables },
		};
		pendingStash = null;
		notify();
		schedulePersist();
	}
	/** Сбросить stash без применения. */
	function clearPendingStash(): void {
		if (!pendingStash) return;
		pendingStash = null;
		notify();
	}

	/**
	 * Возвращает Set ключей полей, значения которых отличаются от сохранённого snapshot.
	 * Используется для подсветки изменённых полей при открытии через "Несохранённые записи".
	 */
	const EMPTY_KEY_SET = new Set<string>();
	function getDirtyFieldKeys(): Set<string> {
		if (!snapshotReady) return EMPTY_KEY_SET;
		const snap = parsedSnapshot.fields as Record<string, unknown>;
		const curr = state.fields as Record<string, unknown>;
		const dirty = new Set<string>();
		for (const key of Object.keys(curr)) {
			if (stableStringify(curr[key]) !== stableStringify(snap[key])) {
				dirty.add(key);
			}
		}
		return dirty;
	}

	const storeResult = {
		// Подписка
		subscribe,
		getSnapshot,
		hadStoredData,
		isSnapshotReady,
		isInitialFetchDone,

		// Мутации fields
		setField,
		setFields,
		setFieldsInitial,
		replaceFields,

		// Мутации tables
		setTablePending,
		clearTablePending,
		clearAllTablesPending,

		// Meta
		setMeta,
		setError,
		setPaneUniqId,
		setPaneLabel,

		// API
		load,
		submitFields,
		commitAllTables,
		commitTable,

		// Dirty tracking
		isDirty,
		markClean,
		getUserChangeSeq,

		// Storage key migration
		migrateStorageKey,
		getStorageKey,

		// Pending stash (несохранённые данные прошлой сессии — только для UnsavedForms)
		hasPendingStash,
		applyPendingStash,
		clearPendingStash,
		getDirtyFieldKeys,

		// Cleanup
		destroy,
		clearStorage: () => {
			// Отменяем отложенную запись, чтобы она не перезаписала очищенные данные
			if (persistTimer) {
				clearTimeout(persistTimer);
				persistTimer = null;
			}
			clearSession(currentStorageKey);
			// Удаляем старые ключи из кэша (после миграции new → uuid)
			for (const k of previousStorageKeys) storeCache.delete(k);
			previousStorageKeys.length = 0;
		},
	};

	return storeResult;
}

/** Тип store, возвращаемого createFormStore */
export type FormStore<F extends object> = ReturnType<typeof createFormStore<F>>;

// ═══════════════════════════════════════════════════════════════════════════
// КЭШИРОВАНИЕ STORE (синглтон на storageKey)
// ═══════════════════════════════════════════════════════════════════════════

const storeCache = new Map<string, FormStore<any>>();

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL FORM API REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Глобальный реестр API-функций форм, привязанных к paneId.
 * Позволяет вызывать reload/save извне, зная только ID панели.
 */
export const formStoreAPI = (() => {
	const apiMap = new Map<string, { reload?: () => void | Promise<void> }>();
	const listeners = new Map<string, Set<() => void>>();

	function subscribe(paneId: string, cb: () => void) {
		if (!listeners.has(paneId)) listeners.set(paneId, new Set());
		listeners.get(paneId)!.add(cb);
		return () => unsubscribe(paneId, cb);
	}

	function unsubscribe(paneId: string, cb: () => void) {
		listeners.get(paneId)?.delete(cb);
	}

	function notify(paneId: string) {
		listeners.get(paneId)?.forEach((l) => l());
	}

	return {
		register: (
			paneId: string,
			api: { reload?: () => void | Promise<void> },
		) => {
			apiMap.set(paneId, api);
			notify(paneId);
		},
		unregister: (paneId: string) => {
			apiMap.delete(paneId);
			notify(paneId);
		},
		get: (paneId: string) => apiMap.get(paneId),
		subscribe,
		unsubscribe,
	};
})();

// ═══════════════════════════════════════════════════════════════════════════
// DIRTY PANE STORE — реактивный Set<uniqId> для отображения индикатора
// «есть несохранённые изменения» на вкладке панели.
// ═══════════════════════════════════════════════════════════════════════════

const dirtySet = new Set<string>();
const dirtyListeners = new Set<() => void>();

function notifyDirtyListeners(): void {
	for (const l of dirtyListeners) l();
}

export function setPaneDirty(uniqId: string, isDirty: boolean): void {
	const was = dirtySet.has(uniqId);
	if (isDirty && !was) {
		dirtySet.add(uniqId);
		notifyDirtyListeners();
	} else if (!isDirty && was) {
		dirtySet.delete(uniqId);
		notifyDirtyListeners();
	}
}

function subscribeDirty(listener: () => void): () => void {
	dirtyListeners.add(listener);
	return () => {
		dirtyListeners.delete(listener);
	};
}

/** Хук: есть ли несохранённые изменения в форме (для индикатора на вкладке). */
export function usePaneIsDirty(uniqId: string): boolean {
	return useSyncExternalStore(
		subscribeDirty,
		() => dirtySet.has(uniqId),
		() => false,
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// PANE NOTIFICATIONS — уведомления привязанные к конкретной панели.
// Используется для информирования пользователя о состоянии формы
// (например: «данные восстановлены из предыдущей сессии»).
// ═══════════════════════════════════════════════════════════════════════════

export interface PaneNotificationAction {
	label: string;
	onClick: () => void | Promise<void>;
}

export interface PaneNotification {
	id: number;
	type: "info" | "warning" | "error";
	text: string;
	timestamp: number;
	actions?: PaneNotificationAction[];
	/** Уведомление неактуально (форма сохранена/обновлена) — действия заблокированы */
	resolved?: boolean;
	/** Ссылка на объект-источник уведомления — для перехода к форме документа */
	ref?: { endpoint: string; uuid: string };
}

/** Запись в локальном журнале уведомлений (localStorage) */
export interface NotificationJournalEntry {
	id: number;
	type: "info" | "warning" | "error";
	text: string;
	timestamp: number;
	/** Заголовок панели (например «Организации: ТОО Строй-Снаб №1») */
	paneLabel?: string;
	/** Ссылка на объект: endpoint + uuid, чтобы можно было переоткрыть */
	ref?: { endpoint: string; uuid: string };
}

const JOURNAL_KEY = "notification-journal";
const JOURNAL_MAX = 200;

function loadJournal(): NotificationJournalEntry[] {
	try {
		return JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]");
	} catch {
		return [];
	}
}

function saveJournal(entries: NotificationJournalEntry[]): void {
	localStorage.setItem(
		JOURNAL_KEY,
		JSON.stringify(entries.slice(-JOURNAL_MAX)),
	);
}

/** Журнал: подписчики для реактивного обновления */
const journalListeners = new Set<() => void>();
let journalCache: NotificationJournalEntry[] | null = null;

function notifyJournalListeners(): void {
	journalCache = null; // сброс кэша
	for (const l of journalListeners) l();
}

function getJournalSnapshot(): NotificationJournalEntry[] {
	if (!journalCache) journalCache = loadJournal();
	return journalCache;
}

function subscribeJournal(listener: () => void): () => void {
	journalListeners.add(listener);
	return () => {
		journalListeners.delete(listener);
	};
}

/** Хук: получить журнал уведомлений (реактивный) */
export function useNotificationJournal(): NotificationJournalEntry[] {
	return useSyncExternalStore(subscribeJournal, getJournalSnapshot, () => []);
}

/** Очистить журнал уведомлений */
export function clearNotificationJournal(): void {
	localStorage.removeItem(JOURNAL_KEY);
	notifyJournalListeners();
}

let nextNoteId = 1;
const paneNotesMap = new Map<string, PaneNotification[]>();
const noteListeners = new Set<() => void>();
let groupsSnapshot: PaneNotificationGroup[] = [];

function notifyNoteListeners(): void {
	groupsSnapshot = paneNotesMap.size === 0
		? emptyGroups
		: Array.from(paneNotesMap.entries()).map(([paneId, notifications]) => ({ paneId, notifications }));
	for (const l of noteListeners) l();
}

/** Добавить уведомление к панели. Также сохраняет в локальный журнал. */
export function addPaneNotification(
	uniqId: string,
	type: PaneNotification["type"],
	text: string,
	/** Контекст для журнала: заголовок панели и ссылка на объект */
	context?: { paneLabel?: string; ref?: { endpoint: string; uuid: string } },
	/** Кнопки-действия внутри уведомления */
	actions?: PaneNotificationAction[],
): void {
	const ts = Date.now();
	const id = nextNoteId++;
	const list = paneNotesMap.get(uniqId) ?? [];
	list.push({ id, type, text, timestamp: ts, actions, ref: context?.ref });
	paneNotesMap.set(uniqId, list);
	notifyNoteListeners();

	// Сохраняем в журнал localStorage
	const journal = loadJournal();
	journal.push({
		id,
		type,
		text,
		timestamp: ts,
		paneLabel: context?.paneLabel,
		ref: context?.ref,
	});
	saveJournal(journal);
	notifyJournalListeners();

	// Показываем всплывающий тост
	const toastType =
		type === "error"
			? "error"
			: type === "warning"
				? "warning"
				: type === "info"
					? "info"
					: "success";
	window.dispatchEvent(
		new CustomEvent("ui_toast", {
			detail: { message: text, type: toastType, title: context?.paneLabel },
		}),
	);
}

/** Удалить конкретное уведомление */
export function dismissPaneNotification(uniqId: string, noteId: number): void {
	const list = paneNotesMap.get(uniqId);
	if (!list) return;
	const filtered = list.filter((n) => n.id !== noteId);
	if (filtered.length === 0) paneNotesMap.delete(uniqId);
	else paneNotesMap.set(uniqId, filtered);
	notifyNoteListeners();
}

/** Удалить из панели «сетевые» уведомления (offline/нет связи/локальный кэш).
 *  Вызывается после успешного online-обращения к серверу, чтобы стальные
 *  предупреждения не вводили пользователя в заблуждение. */
export function dismissNetworkNotifications(uniqId: string): void {
	const list = paneNotesMap.get(uniqId);
	if (!list || list.length === 0) return;
	const NETWORK_RE =
		/Нет связи с сервером|режиме offline|локального кэша|Сохранено локально/i;
	const filtered = list.filter((n) => !NETWORK_RE.test(n.text));
	if (filtered.length === list.length) return;
	if (filtered.length === 0) paneNotesMap.delete(uniqId);
	else paneNotesMap.set(uniqId, filtered);
	notifyNoteListeners();
}

/** Очистить все Уведомления */
export function clearPaneNotifications(uniqId: string): void {
	if (paneNotesMap.has(uniqId)) {
		paneNotesMap.delete(uniqId);
		notifyNoteListeners();
	}
}

/** Пометить все Уведомления как неактуальные (resolved).
 *  Уведомления остаются видимыми, но действия (кнопки) блокируются. */
export function resolvePaneNotifications(uniqId: string): void {
	const list = paneNotesMap.get(uniqId);
	if (!list || list.length === 0) return;
	let changed = false;
	for (const n of list) {
		if (!n.resolved) {
			n.resolved = true;
			changed = true;
		}
	}
	if (changed) notifyNoteListeners();
}

function subscribeNotes(listener: () => void): () => void {
	noteListeners.add(listener);
	return () => {
		noteListeners.delete(listener);
	};
}

/** Хук: уведомления конкретной панели */
export function usePaneNotifications(uniqId: string): PaneNotification[] {
	return useSyncExternalStore(
		subscribeNotes,
		() => paneNotesMap.get(uniqId) ?? emptyNotes,
		() => emptyNotes,
	);
}

export interface PaneNotificationGroup {
	paneId: string;
	notifications: PaneNotification[];
}

const emptyGroups: PaneNotificationGroup[] = [];

/** Хук: уведомления всех панелей сгруппированные по paneId. */
export function useAllPaneNotifications(): PaneNotificationGroup[] {
	return useSyncExternalStore(
		subscribeNotes,
		() => groupsSnapshot,
		() => emptyGroups,
	);
}

const emptyNotes: PaneNotification[] = [];
const EMPTY_DIRTY_KEYS = new Set<string>();

function getOrCreate<F extends object>(
	defaultFields: F,
	tableDefs: Record<string, TableDef>,
	endpoint: string,
	uuid: string | undefined,
	storageKey: string,
	derivedFields?: ReadonlySet<string>,
): FormStore<F> {
	if (!storeCache.has(storageKey)) {
		storeCache.set(
			storageKey,
			createFormStore(
				defaultFields,
				tableDefs,
				endpoint,
				uuid,
				storageKey,
				derivedFields,
			),
		);
	}
	return storeCache.get(storageKey)! as FormStore<F>;
}

// ═══════════════════════════════════════════════════════════════════════════
// REACT ХУКИ
// ═══════════════════════════════════════════════════════════════════════════

/** Опции для useFormStore */
export interface UseFormStoreOptions<F extends object> {
	/** API endpoint (например "organizations") */
	endpoint: string;
	/** Ключ sessionStorage (например "organizations-form") */
	storageKey: string;
	/** Поля формы по умолчанию */
	defaultFields: F;
	/** Описания вложенных таблиц */
	tables?: Record<string, TableDef>;
	/** Props панели (из компонента формы) */
	paneProps: Partial<TPane>;
	/** Начальные значения формы (если не из server, а из paneProps.data). Перезаписывают defaultFields. */
	initialFields?: F;

	/** Маппинг ответа сервера → fields. Может быть async. */
	mapServerToForm: (data: any, prev?: F) => F | Promise<F>;
	/** Формирование payload для POST/PUT. Возвращает string при ошибке валидации. */
	buildPayload: (fields: F) => Record<string, unknown> | string;
	/** Метка панели после сохранения */
	buildPaneLabel: (saved: any) => string;
	/** Доп. логика после load. Может быть async — форма остаётся
	 * disabled до резолва Promise. */
	afterLoad?: () => void | Promise<void>;
	/** Доп. логика после save (кроме commitTables — он вызывается автоматически) */
	afterSave?: (savedData: any) => Promise<void> | void;
	/**
	 * Имена полей, которые вычисляются автоматически (производные/derived):
	 * например, `amount`, `vatAmount`, `amountWithoutVat` — суммы по
	 * строкам SubTable. Такие поля исключаются из dirty-tracking, иначе
	 * любая правка строки SubTable «протекает» в diff формы и показывает
	 * пользователю шумные/некорректные «было → стало» для итогов.
	 */
	derivedFields?: readonly string[];
}

/** Возвращаемый тип useFormStore */
export interface UseFormStoreReturn<F extends object> {
	/** Ссылка на store (для прямого доступа из колбэков) */
	store: FormStore<F>;

	// ── Реактивные данные (через useSyncExternalStore) ──

	/** Значения полей формы */
	fields: F;
	/** Pending-строки вложенных таблиц */
	tables: Record<string, TableState>;
	/** Мета: isLoading, isEditMode, error и т.д. */
	meta: FormStoreState<F>["meta"];

	// ── Гранулярные хуки (для оптимизации ре-рендеров) ──

	/** Подписка на одно поле. Ре-рендер только при изменении этого поля. */
	useField: <K extends keyof F>(field: K) => [F[K], (value: F[K]) => void];
	/** Подписка на pending-строки одной таблицы. */
	useTable: (tableKey: string) => {
		pending: TDataItem[];
		setPending: (rows: TDataItem[]) => void;
		onItemsChange: (items: TDataItem[] | undefined) => void;
	};

	// ── Действия ──

	/** Обновить одно поле */
	setField: <K extends keyof F>(field: K, value: F[K]) => void;
	/** Обновить несколько полей */
	setFields: (patch: Partial<F>) => void;
	/** Обновить поля без изменения dirty-состояния (для авто-подстановки начальных значений) */
	setFieldsInitial: (patch: Partial<F>) => void;

	/** Загрузить с сервера (GET).
	 * @param opts.noCache — обойти HTTP-кэш браузера (для кнопки «Обновить»). */
	loadFromServer: (
		entityUuid: string,
		opts?: { noCache?: boolean },
	) => Promise<void>;
	/** Сохранить + закрыть (или только сохранить) */
	handleSave: () => void;
	handleSaveAndClose: () => Promise<void>;
	handleClose: () => Promise<void>;
	handleReload: () => Promise<void>;

	/** UUID текущей записи */
	uuid: string | undefined;
	/** Уникальный ID инстанса для привязки к input name */
	formUid: string;
	/** ID панели (для регистрации тулбара) */
	paneId: string | undefined;

	// ── Совместимость со старым API ──
	/** handleFieldChange(field, stringValue) — как в useModelForm */
	handleFieldChange: (field: keyof F, value: string) => void;
	/** setFormData — совместимость для usePendingSubTable */
	setFormData: (updater: F | ((prev: F) => F)) => void;
	/** formData — совместимость с существующим JSX */
	formData: F;
	isLoading: boolean;
	/** true пока ПЕРВАЯ загрузка серверных данных не завершена для существующей записи.
	 *  Используется для отображения скелетона вместо мигания пустых disabled-полей. */
	isInitialLoading: boolean;
	isEditMode: boolean;
	/** true если поля формы были изменены относительно последнего сохранённого состояния. */
	isDirty: boolean;
	error: string | null;
	errorRevision: number;
	setError: (msg: string | null) => void;
	clearFormStorage: () => void;
	submit: () => Promise<boolean>;
	/** true если форма открыта через список "Несохранённые записи" */
	isFromUnsaved: boolean;
	/** Ключи полей, значения которых отличаются от сохранённого состояния (для подсветки) */
	unsavedFields: Set<string>;
}

/**
 * Хук формы на основе ref-store.
 *
 * Заменяет useModelForm + usePendingSubTable единым API.
 * Все данные живут в одном ref-объекте {fields, tables, meta}.
 * React-подписки гранулярные — изменение одного поля НЕ ре-рендерит другие.
 */
export function useFormStore<F extends object>(
	options: UseFormStoreOptions<F>,
): UseFormStoreReturn<F> {
	const {
		endpoint,
		storageKey,
		defaultFields,
		initialFields,
		tables: tableDefs = {},
		paneProps,
		mapServerToForm,
		buildPayload,
		buildPaneLabel,
		afterLoad,
		afterSave,
		derivedFields,
	} = options;

	const { onSave, onClose, data, uniqId } = paneProps;
	const uuid = data?.uuid;
	const {
		windows: { updatePaneLabel, requestClose, registerBeforeClose },
		actions: { confirm },
	} = useAppContext();
	const formUid = useUID();
	const queryClient = useQueryClient();

	// ── Создание / получение store из кэша ──
	// Ключ формы привязан к пользователю, имени формы и идентификатору сущности:
	//   "formStore:<userId>:<storageKey>:<uuid|uniqId|new>"
	// Привязка к userId гарантирует, что черновики одного пользователя не
	// видны другому при работе в одном браузере (см. также logout — данные не
	// удаляются, чтобы при повторном входе пользователь увидел свои черновики).
	// Для НОВЫХ форм ключ привязан к uniqId панели — у каждой новой формы свой store.
	// При восстановлении из UnsavedForms — data._formStorageKey содержит оригинальный ключ.
	const userId = getFormStoreUserId();
	const fullStorageKey =
		((data as any)?._formStorageKey as string) ||
		`${STORAGE_PREFIX}${userId}:${storageKey}:${uuid ?? uniqId ?? "new"}`;
	const effectiveDefaults = initialFields ?? defaultFields;
	// Открыта через "Несохранённые записи" — нужно автоматически применить stash
	// и подсветить поля с изменёнными значениями.
	const isFromUnsaved = !!(data as any)?._formStorageKey;

	// Создаём/получаем store из кэша.
	// Set из derivedFields передаётся в createFormStore при ПЕРВОМ создании
	// (кэш по fullStorageKey). Повторные вызовы используют уже созданный store.
	const store = getOrCreate<F>(
		effectiveDefaults,
		tableDefs,
		endpoint,
		uuid,
		fullStorageKey,
		derivedFields ? new Set(derivedFields) : undefined,
	);

	// Привязываем uniqId панели к store — для push-уведомлений через setError.
	// Вызов в useEffect (а не в теле render) обязателен: setPaneUniqId под
	// капотом дёргает notifyStashListeners(), что приводит к setState в
	// PaneTabItem и порождает React-warning «Cannot update a component while
	// rendering a different component».
	useEffect(() => {
		store.setPaneUniqId(uniqId);
		return () => {
			// При размонтировании панели — отвязать обработчики, чтобы
			// не висели подписки на закрытую вкладку.
			store.setPaneUniqId(undefined);
		};
	}, [store, uniqId]);

	// ── Открыто через "Несохранённые записи": применяем stash сразу при монтировании ──
	useEffect(() => {
		if (isFromUnsaved && store.hasPendingStash()) {
			store.applyPendingStash();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []); // только при монтировании

	// ── Dirty indicator: обновляем глобальный dirtySet при каждом изменении store ──
	useEffect(() => {
		if (!uniqId) return;
		setPaneDirty(uniqId, store.isDirty());
		const unsub = store.subscribe(() => {
			setPaneDirty(uniqId, store.isDirty());
		});
		return () => {
			unsub();
			setPaneDirty(uniqId, false);
		};
	}, [store, uniqId]);

	// ── Стабильные ref-ы для колбэков (не пересоздаются) ──
	const mapRef = useRef(mapServerToForm);
	mapRef.current = mapServerToForm;
	const buildPayloadRef = useRef(buildPayload);
	buildPayloadRef.current = buildPayload;
	const buildLabelRef = useRef(buildPaneLabel);
	buildLabelRef.current = buildPaneLabel;
	const afterLoadRef = useRef(afterLoad);
	afterLoadRef.current = afterLoad;
	const afterSaveRef = useRef(afterSave);
	afterSaveRef.current = afterSave;
	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	// Refs для deferred-доступа из эффектов, создаваемых раньше определения функций
	const submitRef = useRef<
		(options?: { keepLoadingOnSuccess?: boolean }) => Promise<boolean>
	>(() => Promise.resolve(false));
	const loadFromServerRef = useRef<
		(entityUuid: string, opts?: { noCache?: boolean }) => Promise<void>
	>(async () => {});

	// ── Полная подписка (для meta / error / loading) ──
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);

	// ── Auto-load при монтировании ──
	const loadTriggeredRef = useRef(false);
	useEffect(() => {
		if (uuid && !loadTriggeredRef.current) {
			loadTriggeredRef.current = true;
			// Если данные восстановлены из sessionStorage — загружаем серверные данные
			// только для snapshot (isDirty будет сравнивать с реальным серверным состоянием).
			// Если sessionStorage пуст — полная загрузка (заменяет fields).
			void store.load(
				uuid,
				mapRef.current,
				afterLoadRef.current,
				store.hadStoredData,
			);
		}
	}, [uuid, store]);

	// ── Регистрация beforeClose guard ──
	useEffect(() => {
		if (!uniqId) return;

		const unregister = registerBeforeClose(uniqId, async () => {
			if (!store.isDirty()) {
				// Чистая форма — разрешаем закрытие, но чистим ресурсы
				store.clearStorage();
				storeCache.delete(store.getStorageKey());
				void onCloseRef.current?.();
				return true;
			}
			const answer = await confirm(`Закрыть без сохранения ? `);
			if (!answer) return false;
			// Очистка при подтверждённом закрытии
			store.clearStorage();
			storeCache.delete(store.getStorageKey());
			void onCloseRef.current?.();
			return true;
		});

		return unregister;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [uniqId, store]);

	// ── Гранулярный useField ──
	const useField = useCallback(
		<K extends keyof F>(field: K): [F[K], (value: F[K]) => void] => {
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const value = useSyncExternalStore(
				store.subscribe,
				() => store.getSnapshot().fields[field],
				() => store.getSnapshot().fields[field],
			);
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const setValue = useCallback(
				(v: F[K]) => store.setField(field, v),
				[field],
			);
			return [value, setValue];
		},
		[store],
	);

	// ── Гранулярный useTable ──
	const useTable = useCallback(
		(tableKey: string) => {
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const tableState = useSyncExternalStore(
				store.subscribe,
				() => store.getSnapshot().tables[tableKey],
				() => store.getSnapshot().tables[tableKey],
			);

			// eslint-disable-next-line react-hooks/rules-of-hooks
			const setPending = useCallback(
				(rows: TDataItem[]) => store.setTablePending(tableKey, rows),
				[tableKey],
			);

			// onItemsChange — колбэк для SubTable.onItemsChange
			// Фильтрует строки с _pendingAction и сохраняет в store.
			// Если флаг tablesValidationFailed поднят — перепроверяем обязательные поля:
			// сбрасываем флаг только когда все required-поля во всех строках заполнены.
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const onItemsChange = useCallback(
				(items: TDataItem[] | undefined) => {
					const all = items ?? [];
					const pending = all.filter((r: any) => r._pendingAction);
					store.setTablePending(tableKey, pending);
					if (store.getSnapshot().meta.tablesValidationFailed) {
						const def = tableDefs[tableKey];
						if (!def?.requiredItemFields?.length) {
							store.setMeta({ tablesValidationFailed: false });
							return;
						}
						const toCheck = pending.filter((r: any) => r._pendingAction !== "delete");
						const allFilled = toCheck.every((r: any) =>
							def.requiredItemFields!.every(f => !isItemFieldEmpty(r[f]))
						);
						if (allFilled) {
							store.setMeta({ tablesValidationFailed: false });
						}
					}
				},
				// tableDefs is stable (from options destructure, same reference across renders)
				// eslint-disable-next-line react-hooks/exhaustive-deps
				[tableKey],
			);

			return {
				pending: tableState?.pending ?? [],
				setPending,
				onItemsChange,
			};
		},
		[store],
	);

	// ── loadFromServer ──
	const loadFromServer = useCallback(
		async (entityUuid: string, opts?: { noCache?: boolean }) => {
			await store.load(
				entityUuid,
				mapRef.current,
				afterLoadRef.current,
				false,
				Boolean(opts?.noCache),
			);
		},
		[store],
	);

	// ── Submit (fields + tables) ──
	const submit = useCallback(
		async (options?: { keepLoadingOnSuccess?: boolean }): Promise<boolean> => {
			const keepLoading = Boolean(options?.keepLoadingOnSuccess);
			// keepLoadingOnSuccess: true вне зависимости от опции — нужно,
			// чтобы поля формы оставались disabled на протяжении ВСЕЙ цепочки
			// (submitFields → commitAllTables → afterSave + refetch → markClean).
			// В конце явно сбрасываем isLoading, если caller не запросил
			// сохранение isLoading=true (используется handleSaveAndClose, чтобы
			// поля не «прыгали» enabled↔disabled во время анмаунта панели).

			// Проверка обязательных полей в pending-строках вложенных таблиц
			for (const [tableKey, def] of Object.entries(tableDefs)) {
				if (!def.requiredItemFields?.length) continue;
				const { pending } = store.getSnapshot().tables[tableKey] ?? { pending: [] };
				const toSave = pending.filter((r: any) => r._pendingAction !== "delete");
				// Группируем по полю: { fieldKey → [lineNum, ...] }
				const fieldToLines: Record<string, number[]> = {};
				toSave.forEach((r: any, idx: number) => {
					const lineNum: number = (r._lineNumber as number | undefined) ?? idx + 1;
					for (const f of def.requiredItemFields!) {
						if (isItemFieldEmpty(r[f])) {
							(fieldToLines[f] ??= []).push(lineNum);
						}
					}
				});
				const parts = Object.entries(fieldToLines).map(([f, nums]) => {
					const label = def.requiredItemFieldLabels?.[f] ?? f;
					return `«${label}» в стр. ${nums.join(", ")}`;
				});
				if (parts.length > 0) {
					store.setError(`«${def.label}»: не заполнено\n   - ${parts.join(";\n   - ")}`);
					store.setMeta({ tablesValidationFailed: true });
					return false;
				}
			}

			const { success, savedData } = await store.submitFields(
				buildPayloadRef.current,
				mapRef.current,
				buildLabelRef.current,
				updatePaneLabel,
				uniqId,
				true,
			);
			if (!success) {
				if (!keepLoading) store.setMeta({ isLoading: false });
				return false;
			}

			// Коммит всех pending-таблиц.
			// clear: true — сбрасываем pending сразу после успешного коммита,
			// ДО вызова afterSave. Это позволяет React завершить re-render
			// (initialPendingRows → []) до того, как afterSave дождётся refetch.
			// Когда refetch прилетит, SubTable увидит пустой pending и выполнит
			// чистую замену кэша без мержа — дубликаты исключены.
			const parentUuid = savedData?.uuid ?? store.getSnapshot().meta.uuid ?? "";
			if (Object.keys(tableDefs).length > 0 && parentUuid) {
				try {
					await store.commitAllTables(parentUuid, { clear: true });
				} catch (e: any) {
					store.setError(e?.message || "Не удалось сохранить вложенные данные");
					if (!keepLoading) store.setMeta({ isLoading: false });
					return false;
				}
			}

			// afterSave — дополнительная логика (invalidate queries, refetch и т.д.).
			if (afterSaveRef.current) {
				try {
					await afterSaveRef.current(savedData);
				} catch (e: any) {
					store.setError(e?.message || "Ошибка после сохранения");
					if (!keepLoading) store.setMeta({ isLoading: false });
					return false;
				}
			}

			store.setMeta({ tablesValidationFailed: false, headerValidationFailed: false });

			// Инвалидируем список модели — обновляем все открытые {Model}List
			// независимо от того, откуда была открыта форма (fire-and-forget).
			void queryClient.invalidateQueries({ queryKey: [endpoint], refetchType: "active" });

			void onSaveRef.current?.();
			store.markClean();

			// ── Settle: повторный markClean после React-commit ────────────
			// Некоторые пост-render эффекты (SubTable merge после refetch,
			// handleTotalChange с derived-полями, фоновые setFields из хуков
			// автоподстановки и т.п.) могут мутировать state УЖЕ ПОСЛЕ
			// синхронного markClean выше, оставляя ложный dirty-флаг.
			// Перевыполняем markClean после полного цикла render/effects.
			// Защита: пропускаем повторный markClean, если за это время
			// пользователь внёс новые значимые (non-derived) изменения
			// (userChangeSeq изменился) — это означает, что dirty настоящий.
			const seqAfterSave = store.getUserChangeSeq();
			const followUpMarkClean = () => {
				if (store.getUserChangeSeq() !== seqAfterSave) return;
				if (!store.isDirty()) return;
				try {
					store.markClean();
				} catch {
					/* noop */
				}
			};
			if (typeof requestAnimationFrame !== "undefined") {
				requestAnimationFrame(() => {
					requestAnimationFrame(followUpMarkClean);
				});
			} else {
				setTimeout(followUpMarkClean, 32);
			}

			// Миграция storageKey после первого POST (new → uuid).
			// Если запись была создана (есть savedData.uuid) и текущий ключ НЕ содержит uuid —
			// мигрируем ключ, чтобы при F5 данные были привязаны к uuid записи.
			const newUuid = savedData?.uuid ?? store.getSnapshot().meta.uuid;
			if (newUuid) {
				const uuidKey = `${STORAGE_PREFIX}${storageKey}:${newUuid}`;
				if (store.getStorageKey() !== uuidKey) {
					store.migrateStorageKey(uuidKey);
				}
			}

			// Вся цепочка успешно завершена — разрешаем ввод в форму.
			// Если caller запросил keepLoadingOnSuccess (handleSaveAndClose) —
			// оставляем disabled до анмаунта панели.
			if (!keepLoading) store.setMeta({ isLoading: false });

			return true;
		},
		[store, tableDefs, updatePaneLabel, uniqId, storageKey, queryClient, endpoint],
	);

	// ── Actions ──
	submitRef.current = submit;
	loadFromServerRef.current = loadFromServer;

	const handleSave = useCallback(() => {
		void submit();
	}, [submit]);

	const handleSaveAndClose = useCallback(async () => {
		// keepLoadingOnSuccess: оставляем isLoading=true на время закрытия,
		// чтобы поля формы не «прыгали» из disabled в enabled между окончанием
		// сохранения и анмаунтом панели.
		if (await submit({ keepLoadingOnSuccess: true })) {
			const currentKey = store.getStorageKey();
			store.clearStorage();
			storeCache.delete(currentKey);
			void onCloseRef.current?.();
			if (uniqId) void requestClose(uniqId, { force: true });
		}
	}, [submit, store, uniqId, requestClose]);

	const handleClose = useCallback(async () => {
		if (uniqId) {
			// requestClose вызовет beforeClose guard, который
			// проверит isDirty и выполнит очистку при подтверждении
			await requestClose(uniqId);
		} else {
			// Нет uniqId — прямое закрытие с проверкой
			if (store.isDirty()) {
				const answer = await confirm(`Закрыть без сохранения?`);
				if (!answer) return;
			}
			store.clearStorage();
			storeCache.delete(store.getStorageKey());
			void onCloseRef.current?.();
		}
	}, [store, uniqId, requestClose, confirm]);

	const handleReload = useCallback(async () => {
		if (store.isDirty()) {
			const answer = await confirm(`Обновить данные?`);
			if (!answer) return;
		}
		// При reload отбрасываем pending-stash (несохранённые правки из прошлого
		// открытия формы) — пользователь явно запросил свежие данные с сервера.
		store.clearPendingStash();
		// Перезагрузка данных с сервера по uuid записи (если она не новая).
		// noCache: true — принудительно обходим HTTP-кэш браузера, чтобы пользователь
		// всегда получал актуальные данные с сервера.
		const currentUuid = store.getSnapshot().meta.uuid;
		if (currentUuid) {
			await loadFromServer(currentUuid, { noCache: true });
		} else {
			// Новая запись (uuid ещё нет): «Обновить» = сброс полей и таблиц к
			// исходным defaults, чтобы Dirty гарантированно очищался.
			store.replaceFields({ ...effectiveDefaults });
			store.clearAllTablesPending();
			store.markClean();
		}
	}, [store, confirm, loadFromServer, effectiveDefaults]);

	// ── Регистрация в глобальном API ──
	useEffect(() => {
		if (!uniqId) return;
		formStoreAPI.register(uniqId, { reload: handleReload });
		return () => formStoreAPI.unregister(uniqId);
	}, [uniqId, handleReload]);

	// ── Совместимость со старым API ──
	const handleFieldChange = useCallback(
		(field: keyof F, value: string) => {
			store.setField(field, value as any);
		},
		[store],
	);

	const setFormData = useCallback(
		(updater: F | ((prev: F) => F)) => {
			const current = store.getSnapshot().fields;
			const next =
				typeof updater === "function"
					? (updater as (prev: F) => F)(current)
					: updater;
			store.replaceFields(next);
		},
		[store],
	);

	const clearFormStorage = useCallback(() => {
		store.clearStorage();
		storeCache.delete(store.getStorageKey());
	}, [store]);

	// Поля с несохранёнными изменениями — только когда форма открыта через "Несохранённые записи".
	// Реактивно пересчитывается при изменении snapshot (после загрузки серверного snapshot).
	const unsavedFields = useMemo(
		() =>
			isFromUnsaved && store.isSnapshotReady()
				? store.getDirtyFieldKeys()
				: EMPTY_DIRTY_KEYS,
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[snapshot, isFromUnsaved, store],
	);

	return {
		store,

		// Реактивные данные
		fields: snapshot.fields,
		tables: snapshot.tables,
		meta: snapshot.meta,

		// Гранулярные хуки
		useField,
		useTable,

		// Прямые мутации
		setField: store.setField,
		setFields: store.setFields,
		setFieldsInitial: store.setFieldsInitial,

		// API
		loadFromServer,
		handleSave,
		handleSaveAndClose,
		handleClose,
		handleReload,

		uuid,
		formUid,
		paneId: uniqId,

		// ── Совместимость ──
		handleFieldChange,
		setFormData,
		formData: snapshot.fields,
		isLoading: snapshot.meta.isLoading,
		// Скелетон формы: отображается пока серверный фетч не завершился
		// (для уже существующей записи без данных в sessionStorage).
		// Цель — убрать визуальный эффект "мигания" пустых/disabled полей.
		isInitialLoading: !store.isInitialFetchDone(),
		isEditMode: snapshot.meta.isEditMode,
		isDirty: store.isDirty(),
		error: snapshot.meta.error,
		errorRevision: snapshot.meta.errorRevision,
		setError: store.setError,
		clearFormStorage,
		submit,
		// Открыто через "Несохранённые записи"
		isFromUnsaved,
		unsavedFields,
	};
}
