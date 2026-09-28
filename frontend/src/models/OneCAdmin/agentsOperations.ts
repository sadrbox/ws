/**
 * «ОПЕРАЦИИ» СПИСКА АГЕНТОВ (28.09) — одна кнопка вместо шести, как у списка баз кластера (BaseGroupCommands).
 *
 * Шесть кнопок подряд («Завести», «Подключить по коду», «Отключить», «Включить», «Перезапустить службу», «Обновить
 * агента») читались как равноправные, хотя делают разное: две заводят нового агента и отметок не требуют, четыре
 * работают над отмеченными, а две из них останавливают службу на чужом компьютере. В меню это видно по разделам,
 * опасное — последним и красным, а у каждого пункта — подсказка: что он сделает или почему сейчас недоступен.
 *
 * ПУНКТ — ПО СОСТОЯНИЮ ОТМЕЧЕННЫХ. «Отключить» — если среди отмеченных есть включённые, «Включить» — если есть
 * отключённые; «Перезапустить» и «Обновить» — только тем, кто это умеет (способность агент объявляет, лишь когда
 * запущен службой) и на связи: молчащему команда ушла бы в очередь и истекла. Число в подписи — сколько агентов
 * команда затронет, а не сколько отмечено.
 *
 * Без React: разделы, подсказки и цели проверяются тестом (Fast Refresh — в модуле-компоненте только компоненты).
 */
import { translate } from "src/i18";
import type { ActionDropdownOption } from "src/components/Toolbar/ActionsDropdownButton";
import type { OnecAgent } from "src/services/onec/api";

export type AgentOp = "create" | "enroll" | "disable" | "enable" | "restart" | "update";

type AgentLike = Pick<OnecAgent, "id" | "disabled" | "online" | "capabilities">;

/** На каких из отмеченных агентов сработает каждая команда. */
export function agentOpTargets<T extends AgentLike>(selected: readonly T[]): Record<"disable" | "enable" | "restart" | "update", T[]> {
	const serviceReady = (cap: string) => selected.filter((a) => a.capabilities.includes(cap) && a.online && !a.disabled);
	return {
		disable: selected.filter((a) => !a.disabled),
		enable: selected.filter((a) => a.disabled),
		restart: serviceReady("agent.restart"),
		update: serviceReady("agent.update"),
	};
}

/** Недоступно — почему: подсказка пункта говорит причину, а не молчит серым. */
const off = (o: ActionDropdownOption, reasonKey: string): ActionDropdownOption =>
	({ ...o, disabled: true, hint: `${translate("onecAgentOpUnavailable")}: ${translate(reasonKey)}` });

/** Причина, по которой служебная команда никому из отмеченных не уйдёт. */
function serviceReason(selected: readonly AgentLike[], cap: string): string {
	if (!selected.length) return "onecAgentOpPick";
	const able = selected.filter((a) => a.capabilities.includes(cap));
	if (!able.length) return "onecAgentOpNotService";
	return "onecAgentOpOffline";
}

const withCount = (key: string, n: number) => `${translate(key)}${n ? ` (${n})` : ""}`;

/** Пункты меню «Операции» списка агентов — в порядке работы: завести, включить или отключить, служба. */
export function agentOperationsMenu(selected: readonly AgentLike[], latestBuild?: string | null): ActionDropdownOption[] {
	const t = agentOpTargets(selected);
	const connect = translate("onecAgentOpsConnect");
	const access = translate("onecAgentOpsAccess");
	const service = translate("onecAgentOpsService");

	const disable: ActionDropdownOption = {
		id: "disable", label: withCount("onecAgentDisable", t.disable.length), icon: "clear", group: access,
		hint: translate("onecAgentOpHintDisable"),
	};
	const enable: ActionDropdownOption = {
		id: "enable", label: withCount("onecAgentEnable", t.enable.length), icon: "restore", group: access,
		hint: translate("onecAgentOpHintEnable"),
	};
	const restart: ActionDropdownOption = {
		id: "restart", label: withCount("onecAgentRestart", t.restart.length), icon: "reload", group: service, danger: true,
		hint: translate("onecAgentOpHintRestart"),
	};
	const update: ActionDropdownOption = {
		id: "update", label: withCount("onecAgentUpdate", t.update.length), icon: "download", group: service, danger: true,
		hint: translate("onecAgentOpHintUpdate").replace("{build}", latestBuild || translate("onecAgentOpLatestUnknown")),
	};

	return [
		{ id: "enroll", label: translate("onecEnrollByCode"), icon: "search", group: connect, hint: translate("onecAgentOpHintEnroll") },
		{ id: "create", label: translate("onecAgentCreate"), icon: "plus", group: connect, hint: translate("onecAgentOpHintCreate") },
		t.disable.length ? disable : off(disable, selected.length ? "onecAgentOpAllDisabled" : "onecAgentOpPick"),
		t.enable.length ? enable : off(enable, selected.length ? "onecAgentOpNoneDisabled" : "onecAgentOpPick"),
		t.restart.length ? restart : off(restart, serviceReason(selected, "agent.restart")),
		t.update.length ? update : off(update, serviceReason(selected, "agent.update")),
	];
}
