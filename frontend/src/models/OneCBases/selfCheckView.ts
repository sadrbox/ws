/**
 * Разбор ответа самопроверки базы (ПН6) — без JSX, ради тестов и Fast Refresh.
 *
 * ПОЧЕМУ РАЗБОР МЯГКИЙ. Набор проверок задаёт расширение в базе, и он будет расти: сегодня это токен, права
 * и организации с БИН, завтра — что-то ещё. Панель, которая знает список наизусть, на каждой новой проверке
 * показывала бы пустоту вместо ответа. Поэтому читаем то, что пришло: список `checks`, а если его нет —
 * булевы поля верхнего уровня как проверки. Чего не поняли — показываем как есть, а не прячем.
 *
 * «Не знаем» — это не «плохо». Проверка без признака `ok` (null) не красится в отказ: выдавать незнание за
 * поломку значит гонять администратора чинить то, что цело.
 */
import type { SelfCheckResult } from "src/services/onec/api";
import { translate } from "src/i18";

export type SelfCheckLine = {
	/** Что проверяли — как назвало расширение, иначе имя поля. */
	title: string;
	/** true — цело, false — не так, null — расширение не сказало. */
	ok: boolean | null;
	/** Подробность от расширения: что именно нашли. */
	detail: string;
	/** Что делать; пусто — подсказки нет, и выдумывать её панель не вправе. */
	hint: string;
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Поля ответа, которые проверками не являются: они описывают саму базу, а не её состояние. */
const NOT_A_CHECK = new Set(["ok", "version", "checks", "organizations", "base", "baseKey", "name"]);

export function selfCheckLines(result: SelfCheckResult | null): SelfCheckLine[] {
	if (!result) return [];
	const checks = Array.isArray(result.checks) ? result.checks : null;
	if (checks) {
		return checks.map((c, i) => ({
			title: text(c?.title) || text(c?.id) || `${translate("onecSelfCheckStep")} ${i + 1}`,
			ok: typeof c?.ok === "boolean" ? c.ok : null,
			detail: text(c?.detail),
			hint: text(c?.hint),
		}));
	}
	/*
	 * Старая (или будущая) сборка ответила плоским объектом вида `{ token: true, rights: false }`. Это тоже
	 * ответ, и он полезнее строки «формат не распознан»: имя поля называет проверку не хуже, чем ничего.
	 */
	return Object.entries(result)
		.filter(([k, v]) => typeof v === "boolean" && !NOT_A_CHECK.has(k))
		.map(([k, v]) => ({ title: k, ok: v as boolean, detail: "", hint: "" }));
}

export type SelfCheckSummary = {
	/** Всё ли цело. Неизвестные проверки на приговор не влияют. */
	ok: boolean;
	failed: number;
	unknown: number;
	version: string;
	/** Организации базы, у которых нет БИН: без него база не найдётся ни по одной команде с БИН. */
	organizationsWithoutBin: string[];
};

export function selfCheckSummary(result: SelfCheckResult | null): SelfCheckSummary {
	const lines = selfCheckLines(result);
	const failed = lines.filter((l) => l.ok === false).length;
	const unknown = lines.filter((l) => l.ok === null).length;
	const orgs = Array.isArray(result?.organizations) ? result!.organizations : [];
	return {
		// `ok` расширения главнее нашего подсчёта: оно знает про проверки, которых панель ещё не понимает.
		ok: typeof result?.ok === "boolean" ? result.ok && failed === 0 : failed === 0,
		failed,
		unknown,
		version: text(result?.version),
		organizationsWithoutBin: orgs
			.filter((o) => !/^\d{12}$/.test(text(o?.bin)))
			.map((o) => text(o?.name) || translate("onecSelfCheckOrgNoName")),
	};
}
