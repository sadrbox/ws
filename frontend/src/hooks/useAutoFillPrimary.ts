import { useEffect, useRef } from "react";
import { usePrimaryChild } from "src/hooks/usePrimaryChild";

/**
 * Авто-подстановка "основной" сущности (банковский счёт / договор) в форму
 * документа при изменении владельца (organizationUuid / counterpartyUuid).
 *
 * Поведение:
 * - Срабатывает ТОЛЬКО для новых форм (isEditMode=false) и пока поле пустое
 *   (currentUuid не задан). Если пользователь уже выбрал значение вручную —
 *   авто-подстановка не перезаписывает выбор.
 * - При изменении scope (например, выбрана новая организация) — повторно
 *   ищет основной объект и подставляет его, если поле всё ещё пустое.
 * - Каждый scope обрабатывается единожды: повторных авто-подстановок при
 *   смене и возврате к тому же scope не делает (чтобы не "восстанавливать"
 *   значение, которое пользователь намеренно очистил).
 *
 * Используется для основного банковского счёта и основного договора в
 * формах документов (продажа, покупка, счёт на оплату, входящая накладная
 * и т.д.) — единообразно для всех документов.
 *
 * Бэкенд (см. router/contracts.js, router/bankaccounts.js) гарантирует, что
 * isPrimary=true есть максимум у одной записи в рамках одного владельца.
 */
export function useAutoFillPrimary(opts: {
	/** API endpoint ("bankaccounts", "contracts" и т.п.). */
	endpoint: string;
	/** Поле для имени (по умолчанию "name"). */
	displayField?: string;
	/** Фильтр-владелец (например, { organizationUuid, counterpartyUuid }). */
	scope: Record<string, string> | null;
	/** Текущее значение uuid в форме (если непусто — не подставляем). */
	currentUuid: string;
	/** Режим редактирования (загружено с сервера) — не подставляем. */
	isEditMode: boolean;
	/** Идёт загрузка/сохранение — не подставляем. */
	isLoading: boolean;
	/** Колбэк применения найденного primary (uuid, name, raw item). */
	apply: (uuid: string, name: string, item: any) => void;
	/** Полное отключение хука. */
	enabled?: boolean;
}) {
	const {
		endpoint,
		displayField = "name",
		scope,
		currentUuid,
		isEditMode,
		isLoading,
		apply,
		enabled = true,
	} = opts;

	// Фетч включён только когда: hook включён, не edit-режим, нет текущего
	// значения и задан scope. Это минимизирует лишние сетевые запросы.
	const fetchEnabled = enabled && !isEditMode && !currentUuid && Boolean(scope);

	const { primaryUuid, primaryName, primary } = usePrimaryChild({
		endpoint,
		displayField,
		scope,
		enabled: fetchEnabled,
	});

	// Стабильная ссылка на apply, чтобы useEffect не срабатывал лишний раз
	// при смене ссылки колбэка между рендерами.
	const applyRef = useRef(apply);
	applyRef.current = apply;

	// Каждый уникальный scope (JSON-ключ) обрабатывается единожды.
	const scopeKey = scope ? JSON.stringify(scope) : null;
	const handledScopeRef = useRef<string | null>(null);

	useEffect(() => {
		if (!enabled) return;
		if (isEditMode || isLoading) return;
		if (!scopeKey || !primaryUuid) return;
		if (currentUuid) return; // пользователь уже выбрал/значение пришло с сервера
		if (handledScopeRef.current === scopeKey) return;
		handledScopeRef.current = scopeKey;
		applyRef.current(primaryUuid, primaryName, primary);
	}, [
		enabled,
		isEditMode,
		isLoading,
		scopeKey,
		primaryUuid,
		primaryName,
		primary,
		currentUuid,
	]);
}

export default useAutoFillPrimary;
