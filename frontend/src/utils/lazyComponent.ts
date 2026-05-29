/**
 * Ленивая загрузка компонента-панели из модуля по имени экспорта.
 *
 * Используется реестрами форм (openFormByRef) и отчётов (openReport): оба
 * хранят `{ loader, key }`, лениво импортируют модуль и достают компонент по
 * ключу (с фолбэком на default). Любая ошибка загрузки → null (вызывающий код
 * сам решает, что делать с отсутствующим компонентом).
 */
import type { FC } from "react";

export interface LazyComponentEntry {
	/** Динамический import модуля с компонентом. */
	loader: () => Promise<Record<string, unknown>>;
	/** Имя именованного экспорта компонента в модуле. */
	key: string;
}

/** Загружает компонент по записи реестра. Возвращает null при любой ошибке. */
export async function loadLazyComponent(
	entry: LazyComponentEntry,
): Promise<FC<any> | null> {
	try {
		const mod = await entry.loader();
		return ((mod[entry.key] ?? mod.default) as FC<any> | undefined) ?? null;
	} catch {
		return null;
	}
}
