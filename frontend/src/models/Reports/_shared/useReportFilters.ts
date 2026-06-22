// Единый стейт фильтров отчёта: персист в localStorage + паттерн «Сформировать»
// (фильтры применяются по кнопке, отчёт грузится по `applied`). Убирает повтор
// usePersistentState×N + applied + handleGenerate в каждом отчёте.
import { useEffect, useRef, useState } from "react";
import { usePersistentState } from "src/hooks/usePersistentState";

export interface ReportFiltersConfig<F extends Record<string, unknown>> {
	/** Префикс ключа localStorage (фильтры запоминаются между сессиями). */
	persistKey: string;
	/** Значения по умолчанию (определяют набор полей). */
	defaults: F;
	/** Переопределение из props — отчёт открыт «по ссылке» с параметрами (drill-target). */
	initial?: Partial<F>;
	/** Сформировать сразу при наличии initial (по умолчанию true). */
	autoApplyInitial?: boolean;
	/** Доступность «Сформировать» (напр. выбран ли счёт). По умолчанию — всегда. */
	canApply?: (f: F) => boolean;
}

export interface ReportFiltersApi<F> {
	fields: F;
	setField: <K extends keyof F>(key: K, value: F[K]) => void;
	patch: (p: Partial<F>) => void;
	/** Применённые фильтры (источник запроса). null — отчёт ещё не сформирован. */
	applied: F | null;
	handleGenerate: () => void;
	generateDisabled: boolean;
}

export function useReportFilters<F extends Record<string, unknown>>(
	config: ReportFiltersConfig<F>,
): ReportFiltersApi<F> {
	const { persistKey, defaults, initial, autoApplyInitial = true, canApply } = config;
	const hasInitial = !!initial && Object.keys(initial).length > 0;

	const [fields, setFields] = usePersistentState<F>(persistKey, () => ({ ...defaults }));

	// applied считается синхронно: drill-target (есть initial) формируется сразу.
	const [applied, setApplied] = useState<F | null>(() =>
		hasInitial && autoApplyInitial ? { ...fields, ...(initial as Partial<F>) } : null,
	);

	// Один раз вмерживаем props-initial поверх восстановленных фильтров (initial важнее).
	const merged = useRef(false);
	useEffect(() => {
		if (hasInitial && !merged.current) {
			merged.current = true;
			setFields((prev) => ({ ...prev, ...(initial as Partial<F>) }));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const setField = <K extends keyof F>(key: K, value: F[K]) =>
		setFields((prev) => ({ ...prev, [key]: value }));
	const patch = (p: Partial<F>) => setFields((prev) => ({ ...prev, ...p }));

	const generateDisabled = canApply ? !canApply(fields) : false;
	const handleGenerate = () => { if (!generateDisabled) setApplied({ ...fields }); };

	return { fields, setField, patch, applied, handleGenerate, generateDisabled };
}
