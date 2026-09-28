/**
 * АГЕНТ БАЗЫ И ЧЕГО НЕТ В ЕГО СБОРКЕ (С5 задачи агента 28.09).
 *
 * Кнопка команды, которой нет в сборке агента базы, обещает то, чего не будет: «Выгрузить расширение в .cfe» была
 * видна у сборок без `IB_EXPORT_EXTENSION`, а сервис отказывал `CAPABILITY_MISSING` уже после нажатия. Чего в сборке
 * нет, сервис говорит заранее — `missingFeatures` агента (ai/src/agents/features.ts); по нему кнопку гасят с
 * подсказкой «обновите агента».
 *
 * Агент базы — админ-агент её сервера (как у кластеров, agentOfServer): базы разных серверов обслуживают разные
 * агенты, и сборки у них могут быть разные.
 *
 * Модуль без компонентов (Fast Refresh): чистые функции проверяет тест, хук зовёт карточка базы.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBases, type OnecAgent, type OnecBase } from "src/services/onec/api";
import { useAgents } from "./agentsQuery";
import { agentOfServer } from "./clustersView";

/** Признак «нет в этой сборке» у выгрузки расширения: нет типа `IB_EXPORT_EXTENSION` при `ib.admin`. */
export const FEATURE_EXTENSION_EXPORT = "extensionExport";

/** Админ-агент сервера базы; базы нет в реестре или сервер неизвестен — `null`. */
export function baseAgentOf(
	agents: readonly OnecAgent[], bases: readonly Pick<OnecBase, "key" | "serverId">[], baseKey: string,
): OnecAgent | null {
	const key = baseKey.trim().toLowerCase();
	const base = key ? bases.find((b) => b.key.toLowerCase() === key) : undefined;
	return base?.serverId ? agentOfServer(agents, base.serverId) : null;
}

/**
 * Нет ли функции в сборке агента. Агент неизвестен или сервис старее признака — НЕ гасим: «не знаем» не повод
 * отказывать заранее, ответит сервис.
 */
export const agentLacks = (agent: Pick<OnecAgent, "missingFeatures"> | null | undefined, feature: string): boolean =>
	!!agent?.missingFeatures?.includes(feature);

/** Нет ли функции в сборке агента, который обслуживает базу. */
export function useBaseAgentLacks(baseKey: string, feature: string): boolean {
	const agents = useAgents();
	/*
	 * Реестр — тот же кэш, что читает карточка базы. `staleTime: Infinity`: этот наблюдатель сам запрос не повторяет
	 * (карточка уже прочитала реестр и перечитывает его после команд), а пустой кэш прочитает один раз.
	 */
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases, enabled: !!baseKey, staleTime: Infinity });
	const agentItems = agents.data?.items;
	const baseItems = bases.data?.items;
	return useMemo(
		() => agentLacks(baseAgentOf(agentItems ?? [], baseItems ?? [], baseKey), feature),
		[agentItems, baseItems, baseKey, feature],
	);
}
