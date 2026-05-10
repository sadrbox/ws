// Форматирование даты (только дд.мм.гггг) в локальной TZ.
//
// ISO с маркером таймзоны (например, "2026-05-10T22:00:00Z") интерпретируется
// через Date → берутся ЛОКАЛЬНЫЕ компоненты, чтобы отображение совпадало
// с datetime-local в формах и getFormatDate в таблицах. Иначе при KZ TZ
// (+05/+06) UTC-полночь даёт расхождение на день между заголовком панели
// и значением в форме.
//
// Простой формат "YYYY-MM-DD" (без TZ) выводится как есть.
export const getFormatDateOnly = (dateString?: string | null): string => {
	if (!dateString) return "";
	const s = String(dateString).slice(0, 32).trim();
	if (!s) return "";
	// "YYYY-MM-DD" без TZ — выводим как локальную дату.
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
	}
	// ISO с временем/TZ → локальные компоненты.
	const d = new Date(s);
	if (isNaN(d.getTime())) return s;
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

// Форматирование даты
export const getFormatDate = (dateString?: string) => {
	if (!dateString) return "";

	const date = new Date(dateString);
	if (isNaN(date.getTime())) return "";

	const formatter = new Intl.DateTimeFormat("ru-RU", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

	// Получаем части и убираем запятую
	return formatter.format(date).replace(/,\s*/, " ");
};

// ── ISO ↔ <input type="datetime-local"> в локальной TZ ──────────────────
// Сервер хранит дату в UTC (ISO с "Z"). Форма использует <input
// type="datetime-local">, который оперирует значениями БЕЗ часового пояса
// и интерпретирует их в локальной TZ. Чтобы отображение в форме совпадало
// с отображением в таблицах (getFormatDate(...) форматирует в локальной TZ),
// нужно конвертировать ISO → "YYYY-MM-DDTHH:mm" в локальной TZ для формы,
// и обратно при сохранении.

/** ISO/Date → "YYYY-MM-DDTHH:mm" в локальной TZ (для input[type=datetime-local]). */
export const isoToLocalInput = (value?: string | Date | null): string => {
	if (!value) return "";
	const d = value instanceof Date ? value : new Date(value);
	if (isNaN(d.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}`
	);
};

/** "YYYY-MM-DDTHH:mm[:ss]" (локальное) или "YYYY-MM-DD" → ISO UTC для сервера. */
export const localInputToIso = (value?: string | null): string | null => {
	if (!value) return null;
	const s = String(value).trim();
	if (!s) return null;
	// Только дата → 00:00 локально
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		const d = new Date(`${s}T00:00`);
		return isNaN(d.getTime()) ? null : d.toISOString();
	}
	// datetime-local без TZ → интерпретируется в локальной TZ
	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
		const d = new Date(s);
		return isNaN(d.getTime()) ? null : d.toISOString();
	}
	// Любой другой парсимый формат
	const d = new Date(s);
	return isNaN(d.getTime()) ? null : d.toISOString();
};

// Уникальный генератор UUID (полифилл)
export const crypto = {
	randomUUID: (): string => {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
			/[xy]/g,
			function (c) {
				const r = (Math.random() * 16) | 0,
					v = c === "x" ? r : (r & 0x3) | 0x8;
				return v.toString(16);
			},
		);
	},
};
