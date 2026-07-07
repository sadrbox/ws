// Доступ к классификаторам РК/ЕАЭС (страны/ТН ВЭД/КАТО/ГС ВС/…) — общий для
// гос-документов. См. backend/api/router/classifiers.js.
import { api } from "src/services/api/client";

export interface ClassifierItem { code: string; name: string; parentCode: string | null; }

export const fetchClassifiers = (type: string, search = "", parentCode?: string) =>
	api.get<{ success: boolean; items: ClassifierItem[] }>("/classifiers", {
		params: { type, search, ...(parentCode !== undefined ? { parentCode } : {}) },
	});

/** Массовый импорт значений классификатора (суперадмин). */
export const importClassifiers = (type: string, rows: { code: string; name: string; parentCode?: string }[]) =>
	api.post<{ success: boolean; upserted: number }>("/classifiers/import", { type, rows }, { timeout: 120_000 });

/** Доступные типы классификаторов (для селектора). */
export const CLASSIFIER_TYPES: { type: string; i18: string }[] = [
	{ type: "country", i18: "clsCountry" },
	{ type: "tnved", i18: "clsTnved" },
	{ type: "kato", i18: "clsKato" },
	{ type: "gsvs", i18: "clsGsvs" },
];
