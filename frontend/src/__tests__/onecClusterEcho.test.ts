/**
 * Список сеансов и соединений — из ответа на снятие, а не второй командой.
 *
 * Правило (docs/TASK_PANEL_SESSIONS_ECHO.md): список из ответа замещает таблицу, только если
 * он полный. Частичный показал бы закрытыми живые сеансы; его нет — перечитываем, как раньше.
 */
import { describe, it, expect } from "vitest";
import { echoList } from "src/models/OneCAdmin/clusterEcho";
import type { ClusterListEcho } from "src/services/onec/api";

const row = { session: "8f0c-uuid", infobase: "ib-uuid", userName: "Оператор" };
const full = (over: Partial<ClusterListEcho> = {}) => ({ state: { sessions: { items: [row], complete: true, ...over } } });

describe("список кластера из ответа на снятие", () => {
	it("полный список — берём его как есть", () => {
		const r = full();
		expect(echoList(r, "sessions")).toBe(r.state.sessions);
	});

	it("недочитанный кластер — перечитать", () => {
		expect(echoList(full({ complete: false }), "sessions")).toBeNull();
	});

	it("старый агент без state — перечитать", () => {
		expect(echoList({ ok: true } as never, "sessions")).toBeNull();
		expect(echoList(undefined, "sessions")).toBeNull();
	});

	it("items не массив — не доверяем форме", () => {
		expect(echoList({ state: { sessions: { items: "x", complete: true } } } as never, "sessions")).toBeNull();
	});

	it("список сеансов не выдаётся за список соединений", () => {
		expect(echoList(full(), "connections")).toBeNull();
	});

	it("строка ещё в списке — признак доезжает до панели", () => {
		expect(echoList(full({ stillListed: true }), "sessions")?.stillListed).toBe(true);
	});

	it("пустой полный список законен: снят последний сеанс", () => {
		const r = echoList({ state: { sessions: { items: [], complete: true } } }, "sessions");
		expect(r?.items).toEqual([]);
	});

	it("блокировки из ответа на разрыв — отдельным списком (агент R7-А3)", () => {
		const r = { state: { connections: { items: [], complete: true }, locks: { items: [row], complete: true } } };
		expect(echoList(r, "locks")?.items).toEqual([row]);
		expect(echoList({ state: { connections: { items: [], complete: true } } }, "locks")).toBeNull();
	});
});
