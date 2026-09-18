/**
 * «Обновить» списка баз проверяет и публикации (17.09): что сказать человеку об их итоге.
 *
 * Успех молчит — он виден в колонке «Публикация». Говорим, когда срез не принят, агент отказал или проверка
 * не выполнена: иначе «Обновить» оставит прежнее состояние публикаций и выдаст его за свежее.
 */
import { describe, it, expect } from "vitest";
import { dbCheckProblem, publicationsProblem, rejectedReportText } from "src/models/OneCAdmin/publicationsOutcome";
import type { PublicationReport } from "src/services/onec/api";

const report = (over: Partial<PublicationReport> = {}): PublicationReport => ({
	total: 110, published: 75, complete: true, evidence: true, accepted: true, source: "iis", lookedIn: 3, ...over,
});

describe("итог публикаций после «Обновить»", () => {
	it("срез принят — молчим", () => {
		expect(publicationsProblem({ report: report() })).toBeNull();
	});

	it("сервис старее правки (поля нет) и проверка ещё идёт — молчим", () => {
		expect(publicationsProblem(undefined)).toBeNull();
		expect(publicationsProblem({ pending: true, commandId: "cmd-1" })).toBeNull();
	});

	it("срез не принят — предупреждение с тем, где агент искал", () => {
		const text = publicationsProblem({ report: report({ accepted: false, published: 0, lookedIn: 2, source: "iis" }) });
		expect(text).toMatch(/не нашёл ни одной опубликованной/);
		expect(text).toMatch(/не изменено/);
		expect(text).toMatch(/Просмотрено каталогов: 2 \(iis\)/);
	});

	it("отказ агента — «Публикации не проверены» с его текстом", () => {
		expect(publicationsProblem({ error: { code: "IB_ERROR", message: "веб-сервер недоступен" } }))
			.toBe("Публикации не проверены: веб-сервер недоступен");
		expect(publicationsProblem({ error: {} })).toBe("Публикации не проверены");
	});

	it("разбор дождавшейся проверки — тем же правилом", () => {
		expect(rejectedReportText(report())).toBeNull();
		expect(rejectedReportText(report({ accepted: false, lookedIn: 0 }))).not.toMatch(/Просмотрено/);
	});
});

/**
 * «Обновить» заодно проверяет базы данных у новых и давно не проверявшихся баз (18.09). Обычно проверять нечего —
 * и тогда сказать нечего: человек нажал «Обновить», а не «Проверить базы данных».
 */
describe("итог выборочной проверки баз данных", () => {
	it("проверять было нечего или всё на месте — молчим", () => {
		expect(dbCheckProblem(undefined)).toBeNull();
		expect(dbCheckProblem({ checked: 0, missing: 0 })).toBeNull();
		expect(dbCheckProblem({ checked: 7, missing: 0 })).toBeNull();
		expect(dbCheckProblem({ pending: true, commandId: "cmd-1" })).toBeNull();
	});

	it("база из СУБД пропала — предупреждение с числами", () => {
		const r = dbCheckProblem({ checked: 7, missing: 2 });
		expect(r?.severity).toBe("warning");
		expect(r?.text).toBe("Проверено баз: 7, нет базы данных: 2");
	});

	it("проверка не выполнена — своё сообщение с текстом отказа", () => {
		expect(dbCheckProblem({ error: { message: "нет пароля СУБД" } })?.text)
			.toBe("Проверка баз данных не выполнена: нет пароля СУБД");
		expect(dbCheckProblem({ error: {} })?.text).toBe("Проверка баз данных не выполнена");
	});
});
