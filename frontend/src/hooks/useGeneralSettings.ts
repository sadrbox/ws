import { useState, useCallback } from "react";
import { setAppUtcOffset, setAppDateFormat, type DateFormat } from "src/utils/datetime";

const STORAGE_KEY = "app_general_settings";

export interface GeneralSettings {
	utcOffset: number; // целое число часов: -12…+14
	dateFormat: DateFormat; // формат отображения дат
}

const DEFAULT_SETTINGS: GeneralSettings = {
	utcOffset: 5, // UTC+5 (Казахстан / Нур-Султан)
	dateFormat: "DD.MM.YYYY",
};

function load(): GeneralSettings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GeneralSettings>) };
	} catch { /* ignore */ }
	return DEFAULT_SETTINGS;
}

function persist(s: GeneralSettings): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
	setAppUtcOffset(s.utcOffset);
	setAppDateFormat(s.dateFormat);
}

/** Хук для чтения и изменения общих настроек приложения. */
export function useGeneralSettings() {
	const [settings, setSettings] = useState<GeneralSettings>(load);

	const update = useCallback((patch: Partial<GeneralSettings>) => {
		setSettings((prev) => {
			const next = { ...prev, ...patch };
			persist(next);
			return next;
		});
	}, []);

	return { settings, update };
}

/** Форматы отображения даты — пример на 31.12.2026 для наглядности. */
export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
	{ value: "DD.MM.YYYY", label: "31.12.2026 (ДД.ММ.ГГГГ)" },
	{ value: "DD/MM/YYYY", label: "31/12/2026 (ДД/ММ/ГГГГ)" },
	{ value: "MM/DD/YYYY", label: "12/31/2026 (ММ/ДД/ГГГГ)" },
	{ value: "YYYY-MM-DD", label: "2026-12-31 (ГГГГ-ММ-ДД, ISO)" },
];

/** Список поддерживаемых UTC-смещений (целые часы -12…+14). */
export const UTC_OFFSET_OPTIONS: { value: number; label: string }[] = Array.from(
	{ length: 27 },
	(_, i) => {
		const h = i - 12;
		const sign = h >= 0 ? "+" : "−";
		return { value: h, label: `UTC${sign}${Math.abs(h)}` };
	},
);
