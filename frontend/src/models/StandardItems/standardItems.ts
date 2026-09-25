/**
 * Справочник пунктов стандарта (E17 СК5.1) — подписи «кто может нарушить» и «как выявляется»,
 * проверка формы. Отдельно от index.tsx (там только компоненты — Fast Refresh).
 *
 * Значения те же, что принимает сервер (PUT /standard-items/:id): прочее он молча игнорирует,
 * поэтому выбор ограничен этим списком.
 */
import { translate } from "src/i18";
import { asText } from "src/utils/asText";

/** Кто может нарушить пункт: сотрудник (любой штатный, включая главбуха), главбух, руководитель. */
export const APPLIES_TO = ["employee", "chief", "manager"] as const;
export type AppliesTo = (typeof APPLIES_TO)[number];

/**
 * Как пункт выявляется (таблица покрытия плана): правило заводит кандидата, система даёт
 * сигнал, только ручная фиксация. На подтверждение не влияет — подтверждает всегда человек.
 */
export const DETECTION_KINDS = ["auto", "signal", "manual"] as const;
export type DetectionKind = (typeof DETECTION_KINDS)[number];

const APPLIES_KEYS: Record<AppliesTo, string> = {
	employee: "standardItemAppliesEmployee",
	chief: "standardItemAppliesChief",
	manager: "standardItemAppliesManager",
};

const KIND_KEYS: Record<DetectionKind, string> = {
	auto: "standardItemKindAuto",
	signal: "standardItemKindSignal",
	manual: "standardItemKindManual",
};

export function appliesToLabel(v: unknown): string {
	return (APPLIES_TO as readonly unknown[]).includes(v) ? translate(APPLIES_KEYS[v as AppliesTo]) : asText(v);
}

export function detectionKindLabel(v: unknown): string {
	return (DETECTION_KINDS as readonly unknown[]).includes(v) ? translate(KIND_KEYS[v as DetectionKind]) : asText(v);
}

export const appliesToOptions = () => APPLIES_TO.map((v) => ({ value: v, label: appliesToLabel(v) }));
export const detectionKindOptions = () => DETECTION_KINDS.map((v) => ({ value: v, label: detectionKindLabel(v) }));

export interface StandardItemFields {
	title: string;
	text: string;
	isActive: boolean;
	appliesTo: string;
	kind: string;
}

/**
 * Тело PUT или ключ ошибки. Формулировка и текст пункта обязательны: пустые сервер молча
 * заменил бы прежними, и человек не понял бы, почему правка «не сохранилась».
 */
export function standardItemPayload(f: StandardItemFields): { payload: Record<string, unknown> } | { error: string } {
	const title = f.title.trim();
	if (!title) return { error: "standardItemNeedTitle" };
	const text = f.text.trim();
	if (!text) return { error: "standardItemNeedText" };
	return {
		payload: {
			title,
			text,
			isActive: !!f.isActive,
			...((APPLIES_TO as readonly string[]).includes(f.appliesTo) ? { appliesTo: f.appliesTo } : {}),
			...((DETECTION_KINDS as readonly string[]).includes(f.kind) ? { kind: f.kind } : {}),
		},
	};
}
