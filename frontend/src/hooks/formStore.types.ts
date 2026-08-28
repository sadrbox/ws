// Типы и чистые хелперы стора форм. Вынесено из useFormStore.ts (Q9).
// Нулевой рантайм-риск: типы стираются, isItemFieldEmpty — чистая функция.
import type { TDataItem } from "src/components/Table/types";

/**
 * Axios-подобная ошибка запроса — для сужения `unknown` в catch (T3).
 * Позволяет читать response.status/data.message без `any`.
 */
export type ApiError = {
	response?: { status?: number; data?: { message?: string } };
	message?: string;
};

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
		/**
		 * Класс ошибки — определяет, ГДЕ её показывать (см. памятку Notice vs Toast):
		 *   "form"   — ошибка ДАННЫХ формы: клиентская валидация или бизнес-отказ бэка
		 *              (400/409/422/423: «серий меньше количества», «период закрыт»…).
		 *              Показывается в <Notice /> ВНУТРИ формы — её чинят правкой полей.
		 *   "system" — сбой, к форме не относящийся (сеть, 5xx, нет прав). Правкой полей
		 *              не лечится → уходит в <UIToast />.
		 */
		errorKind: "form" | "system";
		errorRevision: number;
		tablesValidationFailed: boolean;
		headerValidationFailed: boolean;
	};
}

/** Тип подписки */
export type Listener = () => void;
