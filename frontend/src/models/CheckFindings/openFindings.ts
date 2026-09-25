/**
 * Открыть «Проверки учёта 1С» с отбором — из других экранов (панель главбуха: ячейка участка;
 * чек-лист: привязка пункта к проверке; карточка прогона).
 *
 * Список — синглтон: если он уже открыт, новая data до него не дойдёт, поэтому отбор идёт
 * через paneFilterBus. Рецепт восстановления несёт организацию: после перезагрузки вкладка
 * откроется с тем же клиентом.
 */
import type { TPane } from "src/app/types";
import type { TDataItem } from "src/components/Table/types";
import { translate } from "src/i18";
import { CheckFindingsList } from "./index";
import { requestPaneFilter } from "./paneFilterBus";
import { FINDINGS_FILTER_KEY, type FindingsFilter } from "./findingsView";

export function openFindingsPane(addPane: (pane: Partial<TPane>) => void, filter: Partial<FindingsFilter>): void {
	requestPaneFilter(FINDINGS_FILTER_KEY, filter);
	const data: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(filter)) if (v) data[k] = v;
	addPane({
		component: CheckFindingsList,
		label: translate("CheckFindingsList"),
		data: data as Partial<TDataItem>,
		restore: { kind: "view", name: "CheckFindingsList", data },
	});
}
