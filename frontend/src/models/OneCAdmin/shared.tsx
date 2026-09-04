/**
 * Общие части вкладок «Администрирования 1С»: таблица баз с отметками и модалка
 * подтверждения групповой операции.
 *
 * Групповые операции идут ПО ВЫБРАННЫМ базам, поэтому таблица баз повторяется на
 * нескольких вкладках — здесь она одна на всех, чтобы колонки и поведение не разошлись.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { asText } from "src/utils/asText";
import { fetchBases, fetchAgents, hasCapability, type OnecBase } from "src/services/onec/api";
import styles from "./OneCAdmin.module.scss";

/** Колонки списка баз в режиме выбора цели: только то, что помогает выбрать. */
const targetColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "110px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "extensionsCount", type: "number", width: "140px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

export type BaseTargetsApi = {
	/** Ключи отмеченных баз — цель групповой операции. */
	selectedKeys: string[];
	table: React.ReactNode;
	bases: OnecBase[];
	isLoading: boolean;
};

/**
 * Таблица баз с чекбоксами. Клик по строке (не по чекбоксу) отдаёт ключ базы наружу —
 * так вкладка показывает содержимое одной базы, не теряя набор отмеченных.
 */
export function useBaseTargets(opts: {
	componentName: string;
	onOpenBase?: (baseKey: string) => void;
	/** Кнопки тулбара — функция от выбора: они почти всегда зависят от числа отмеченных. */
	extraButtons?: (selectedKeys: string[]) => React.ReactNode;
}): BaseTargetsApi {
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(targetColumns(), opts.componentName));
	const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

	const rowsRaw = useMemo(() => (bases.data?.items ?? []).map((b, i) => ({
		id: i + 1,
		uuid: b.id,
		baseKey: b.key,
		name: b.name || "",
		status: b.status,
		extensionsCount: b.extensionsCount,
	})), [bases.data]);

	const sorted = useStaticTableView(rowsRaw, { baseKey: "asc" });
	const rows = useMemo(() => sorted.rows.map((r) => ({
		...r,
		name: r.name || "—",
		extensionsCount: r.extensionsCount ?? translate("onecExtNotChecked"),
	})), [sorted.rows]);

	const onSelectionChange = useCallback((selected: Set<number>, all: TDataItem[]) => {
		setSelectedKeys(all.filter((r) => selected.has(Number(r.id))).map((r) => String(r.baseKey)));
	}, []);

	const onRowClick = useCallback((row: Partial<TDataItem>) => {
		if (opts.onOpenBase) opts.onOpenBase(asText(row.baseKey));
	}, [opts]);

	const table = (
		<Table
			{...buildStaticTableProps({
				componentName: opts.componentName,
				rows, columns, setColumns,
				sorting: sorted.sorting,
				search: sorted.search,
				isLoading: bases.isLoading,
				onReload: () => void bases.refetch(),
				selectable: true,
				onSelectionChange,
				...(opts.onOpenBase ? { onRowClick } : {}),
				...(opts.extraButtons ? { extraButtons: opts.extraButtons(selectedKeys) } : {}),
			})}
		/>
	);

	return { selectedKeys, table, bases: bases.data?.items ?? [], isLoading: bases.isLoading };
}

/** Заголовок раздела внутри вкладки — вместо самодельных подписей в каждой. */
export const SectionTitle: FC<{ children: React.ReactNode }> = ({ children }) => (
	<div className={styles.SectionTitle}>{children}</div>
);

/**
 * Предупреждение «этого не может произойти в принципе»: у админ-агента нет способности,
 * без которой команда не будет даже поставлена в очередь. Показывается ДО нажатия кнопки —
 * иначе пользователь узнаёт о препятствии из отчёта «пропущено 110 из 110».
 */
export const CapabilityGuard: FC<{ capability: string; children?: React.ReactNode }> = ({ capability }) => {
	const agents = useQuery({ queryKey: ["onec", "agents"], queryFn: fetchAgents });
	if (agents.isLoading || hasCapability(agents.data?.items, capability)) return null;

	const online = (agents.data?.items ?? []).filter((a) => a.role === "admin" && a.online && !a.disabled);
	return (
		<div className={styles.Blocked}>
			{online.length
				? `${translate("onecCapabilityMissing")}: ${capability}`
				: translate("onecNoAdminAgent")}
		</div>
	);
};

/**
 * Причина, по которой таблица пуста. Ошибку запроса react-query по умолчанию НИКУДА не
 * показывает: пользователь видел пустой список и ни слова о том, что 1С ответила отказом.
 * Текст приходит от сервиса и написан для человека — выводим как есть.
 */
export const QueryError: FC<{ error: unknown }> = ({ error }) => {
	if (!error) return null;
	// Только Error даёт осмысленный текст; всё прочее — неизвестная ошибка, а не
	// «[object Object]» в лицо пользователю.
	const text = error instanceof Error ? error.message : translate("unknownError");
	return <div className={styles.Blocked}>{text}</div>;
};

/**
 * Прогон чтения по нескольким базам — прямыми запросами, без задания.
 *
 * Задание (command_batches) существует для ИЗМЕНЯЮЩИХ операций: их результат по каждой
 * базе нужно хранить и к нему возвращаться. Чтение списка — обычный запрос: нажал и увидел,
 * заводить ради него сущность и уходить на другую вкладку незачем.
 *
 * Ограничение одновременности — не из вежливости: каждое обращение к базе занимает у 1С
 * сеанс и лицензию, а агент и так исполняет команды пачками по `max_parallel`.
 */
export async function checkBases(
	keys: string[],
	read: (baseKey: string) => Promise<unknown>,
	limit = 4,
): Promise<{ ok: number; failed: { baseKey: string; message: string }[] }> {
	const queue = [...keys];
	let ok = 0;
	const failed: { baseKey: string; message: string }[] = [];

	const worker = async () => {
		for (;;) {
			const key = queue.shift();
			if (!key) return;
			try {
				await read(key);
				ok += 1;
			} catch (e) {
				failed.push({ baseKey: key, message: e instanceof Error ? e.message : String(e) });
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, keys.length) }, worker));
	return { ok, failed };
}
