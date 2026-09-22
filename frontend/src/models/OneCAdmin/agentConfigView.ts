/**
 * Настройки агента (задача агенту §3) — правила без JSX: что агент разрешил менять и что уйдёт в команду.
 */
import type { AgentConfigPatch } from "src/services/onec/api";

/**
 * Разрешил ли агент править это поле. Список `editable` приходит от него: сборка, которая поле ещё не умеет,
 * его не назовёт, и панель не предложит менять то, что агент отвергнет. Списка нет вовсе — сборка старее правки,
 * и править нечего.
 */
export const canEditField = (editable: readonly string[] | undefined, field: string): boolean =>
	!!editable?.includes(field);

/** Число из поля ввода: пусто или мусор — `null`, и такое поле в команду не уйдёт. */
export function numberField(text: string): number | null {
	const t = text.trim();
	return /^\d{1,6}$/.test(t) ? Number(t) : null;
}

/** Есть ли что отправлять: пустая правка — не «Сохранено», а «ничего не изменилось» (аудит 21.09). */
export const hasChanges = (draft: AgentConfigPatch): boolean => Object.keys(configPatch(draft)).length > 0;

/**
 * Что действительно уйдёт агенту: пустые правки и негодные числа отбрасываются, иначе «сохранить» слало бы
 * `null` и агент отвечал бы отказом по схеме.
 */
export function configPatch(draft: AgentConfigPatch): AgentConfigPatch {
	const out: AgentConfigPatch = {};
	// Ноль в пределах — «без предела» (так его принимает агент); у числа баз ноль бессмысленен.
	if (typeof draft.ibParallel === "number" && Number.isInteger(draft.ibParallel) && draft.ibParallel > 0) out.ibParallel = draft.ibParallel;
	for (const field of ["commandTimeoutSecs", "longCommandTimeoutSecs"] as const) {
		const v = draft[field];
		if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[field] = v;
	}
	if (typeof draft.logLevel === "string" && draft.logLevel) out.logLevel = draft.logLevel;
	const bases = (draft.bases ?? []).filter((b) => !!b.key && (b.order !== undefined || b.enabled !== undefined));
	if (bases.length) out.bases = bases;
	return out;
}
