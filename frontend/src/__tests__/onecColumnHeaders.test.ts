/**
 * Заголовки колонок панели 1С — словами на обоих языках, а не сырыми ключами (И26 аудита 26.09):
 * «Расписания» (SchedulesTab), помощник групповой команды (fitLabel), помощник пользователя (attr, where).
 */
import { describe, expect, it } from "vitest";
import ru from "src/i18/translations.json";
import kk from "src/i18/translations.kk.json";

const KEYS = ["typeLabel", "atTime", "weekdaysLabel", "basesLabel", "enabledLabel", "lastRunLabel", "fitLabel", "attr", "where"];

describe("заголовки колонок панели 1С", () => {
	it.each(KEYS)("«%s» переведён на русский и казахский", (key) => {
		const r = (ru as Record<string, string>)[key];
		const k = (kk as Record<string, string>)[key];
		expect(r && r !== key).toBeTruthy();
		expect(k && k !== key).toBeTruthy();
	});
});
