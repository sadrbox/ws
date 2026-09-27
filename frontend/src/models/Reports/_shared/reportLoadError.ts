// Ошибка загрузки отчёта — видна, а не выглядит пустым отчётом (аудит 26.09, И21).
//
// ОСВ, карточка счёта, журнал проводок, кассовый отчёт не смотрели на isError: ответ 500
// показывался как «Нет данных», и бухгалтер делал вывод «оборотов нет». Теперь текст ошибки
// стоит на месте таблицы, а системный сбой ещё и уходит тостом и в журнал.
import { useEffect } from "react";
import { translate } from "src/i18";
import { errorText, reportError } from "src/services/errors/route";

/** Текст ошибки для места таблицы (undefined — ошибки нет); о новой ошибке сообщает один раз. */
export function useReportLoadError(error: unknown, source: string): string | undefined {
	useEffect(() => {
		if (error) reportError(error, { source, fallback: translate("reportLoadFailed") });
		// source — подпись отчёта, от неё повторный показ той же ошибки не зависит.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [error]);
	if (!error) return undefined;
	return `${translate("reportLoadFailed")}: ${errorText(error, translate("unknownError"))}`;
}
