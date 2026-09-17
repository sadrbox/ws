/**
 * Вкладка «Расширения» (E15/A3, A4): две связанные таблицы — «Расширения» и «Базы».
 *
 * УСТРОЙСТВО — ТО ЖЕ, ЧТО У «ПОЛЬЗОВАТЕЛЕЙ БАЗ», и намеренно: задачи у них одинаковой
 * формы — элемент, живущий во многих базах, и команда по отмеченным базам. Разные экраны
 * для одинаковых задач заставляли бы учить панель дважды. ОДИНОЧНЫЙ щелчок по строке
 * слева наполняет правую таблицу: выбрали расширение — базы с признаком «Наличие»;
 * выбрали базу — расширения, которые в ней стоят. ДВОЙНОЙ открывает элемент: карточку
 * расширения или карточку базы.
 *
 * КАРТОЧКИ-ПРЕДПРОСМОТРА ЗДЕСЬ БОЛЬШЕ НЕТ. Реквизиты расширения и «что произойдёт»
 * рисовались прямо на вкладке, хотя реквизиты живут в карточке элемента (ElementForm), а
 * «что произойдёт» спрашивает и показывает помощник групповых команд. Экран остался тем,
 * чем и должен быть: сводкой «какое расширение в каких базах стоит».
 *
 * БАЗЫ — ВСЕГДА ВСЕ ПРИМЕНИМЫЕ, а не только те, где расширение уже стоит. Установка идёт
 * туда, где его НЕТ: показывать лишь базы с установленным расширением значило бы убрать с
 * экрана все цели установки. Где стоит, а где нет — говорит колонка «Наличие».
 *
 * ГРУППИРОВКА ПО ПАРЕ ИМЯ+СИНОНИМ. Служебное имя вида `EF_00_00062442` ничего не говорит,
 * а одно и то же имя в разных базах может принадлежать разным расширениям — склеивать их
 * в одну строку значило бы врать о том, что стоит одинаковое.
 */
import { useRunningCommand } from "src/components/TechMessages/operations";
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { asText } from "src/utils/asText";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { VSplitBar, useSplitResize } from "src/components/SplitPane";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import {
	fetchBaseExtensionsCached, fetchBases, fetchExtensionSummary, refreshBases,
} from "src/services/onec/api";
import { Icon } from "src/components/IconButton/icons";
import {
	CapabilityGuard, EchoDelayNotice, QueryError, isApplicable, useBaseContentCheck,
} from "./shared";
import { useOpenElement } from "./ElementForm";
import BaseGroupCommands from "./BaseGroupCommands";
import { withOp } from "./progress";
import { useOpenOnecBase } from "src/models/OneCBases";
import styles from "./OneCAdmin.module.scss";

const extColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "synonym", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "version", type: "string", width: "130px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "basesCount", type: "string", width: "90px", minWidth: "70px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

const baseColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "presence", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "extensionsCount", type: "string", width: "130px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

export const ExtensionsTab: FC = () => {
	const openBase = useOpenOnecBase();
	const openExt = useOpenElement("extension");
	const qc = useQueryClient();

	/**
	 * Что слева: расширения (по умолчанию) или базы. Правая таблица — связанная.
	 *
	 * По умолчанию слева РАСШИРЕНИЯ: вкладка про них, и открывать её списком баз значило бы
	 * начинать разговор не с того предмета (ср. «Пользователи баз», где слева базы).
	 */
	const [primary, setPrimary] = useState<"extensions" | "bases">("extensions");
	const [activeBase, setActiveBase] = useState("");
	/** Активное расширение целиком: его строку открывает карточка элемента. */
	const [activeExtRow, setActiveExtRow] = useState<TDataItem | null>(null);
	const activeExt = asText(activeExtRow?.name);
	/** Отмеченные базы — цель групповых команд по расширениям. */
	const [pickedBases, setPickedBases] = useState<TDataItem[]>([]);

	// Ширина таблиц — тем же разделителем, что у «Пользователей баз» и списков с
	// предпросмотром; пропорция своя и переживает закрытие вкладки.
	const split = useSplitResize({
		storageKey: "onec_ext_split",
		side: "left",
		defaultPercent: 50,
		min: 25,
		max: 75,
	});

	const summary = useQuery({ queryKey: ["onec", "ext-summary"], queryFn: fetchExtensionSummary });
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	// Расширения выбранной базы — из кэша реестра: связанный список должен появляться от
	// щелчка, а не от сеанса 1С (живое чтение — кнопка «Обновить» этой же таблицы).
	// Ключ ТОТ ЖЕ, что у карточки базы (["onec","base-ext",<база>]): живое чтение
	// (useBaseContentCheck) кладёт прочитанное именно в него — со своим ключом таблица
	// не увидела бы того, что сама же попросила прочитать.
	const baseExts = useQuery({
		queryKey: ["onec", "base-ext", activeBase],
		queryFn: () => fetchBaseExtensionsCached(activeBase),
		enabled: primary === "bases" && !!activeBase,
		staleTime: Infinity,
	});

	const [extCols, setExtCols] = useState<TColumn[]>(() => getModelColumns(extColumns(), "OneCAdmin_extSummary"));
	const [baseCols, setBaseCols] = useState<TColumn[]>(() => getModelColumns(baseColumns(), "OneCAdmin_extBases"));

	// ── Строки: расширения ──────────────────────────────────────────────────
	const extRows = useMemo(() => {
		const src = primary === "extensions"
			? (summary.data?.items ?? []).map((x) => ({
				name: x.name, synonym: x.synonym || "—",
				version: (x.versions ?? []).join(", ") || "—", bases: String(x.bases),
			}))
			// Правая таблица в режиме «слева базы»: расширения выбранной базы.
			: (baseExts.data?.items ?? []).map((x) => ({
				name: x.name, synonym: x.synonym || "—",
				version: x.version || "—", bases: "",
			}));
		return src.map((x, i) => ({
			id: i + 1, uuid: x.name, name: x.name, synonym: x.synonym,
			version: x.version, basesCount: x.bases,
		}));
	}, [primary, summary.data, baseExts.data]);
	const extView = useStaticTableView(extRows, { name: "asc" });

	// ── Строки: базы ────────────────────────────────────────────────────────
	// ВСЕ применимые базы в обоих режимах: где расширение стоит, а где нет — говорит
	// колонка «Наличие», и она же отделяет цели установки от целей удаления.
	const baseRows = useMemo(() => (bases.data?.items ?? [])
		.filter((b) => isApplicable(b, "ib"))
		.map((b, i) => ({
			id: i + 1, uuid: b.key, baseKey: b.key, name: b.name || "—",
			presence: activeExt
				? (b.extensionNames.some((n) => n.toLowerCase() === activeExt.toLowerCase())
					? translate("onecPresent") : translate("onecAbsent"))
				: "—",
			extensionsCount: b.extensionsCount == null
				? translate("onecExtNotChecked") : String(b.extensionsCount),
		})), [bases.data, activeExt]);
	const baseView = useStaticTableView(baseRows, { baseKey: "asc" });

	/** Сколько баз из показанных держат активное расширение — для полосы состояния. */
	const installed = useMemo(() => (!activeExt ? 0 : (bases.data?.items ?? [])
		.filter((b) => isApplicable(b, "ib"))
		.filter((b) => b.extensionNames.some((n) => n.toLowerCase() === activeExt.toLowerCase()))
		.length), [bases.data, activeExt]);

	// Чтение расширений баз — общий механизм (см. useBaseContentCheck): та же кнопка в
	// карточке базы обязана делать ровно то же самое.
	const check = useBaseContentCheck("extensions");

	/** Состав баз заводит кластер: обновление списка спрашивает его, а не наш кэш. */
	const refreshFromCluster = useMutation({
		// Операция видна в «Прогрессе»: срез кластера по сотне баз идёт не мгновенно.
		mutationFn: () => withOp(
			{ kind: "read", title: translate("onecRefreshFromCluster"), target: translate("onecTabBases") },
			refreshBases,
		),
		onSuccess: (d) => {
			qc.setQueryData(["onec", "bases"], d);
			showToast(translate("onecBasesRefreshed"), "success");
		},
		onError: (e) => reportError(e, { source: translate("onecTabExtensions") }),
	});

	// Работа, начатая до перезагрузки страницы: чтение баз у кластера и расширений у 1С.
	const basesRefreshing = useRunningCommand(["CLUSTER_LIST_INFOBASES"]);
	const extReading = useRunningCommand(["IB_LIST_EXTENSIONS"]);

	// ── Таблицы ─────────────────────────────────────────────────────────────
	const extsTable = (
		<Table {...buildStaticTableProps({
			componentName: "OneCAdmin_extSummary", rows: extView.rows, columns: extCols,
			setColumns: setExtCols, sorting: extView.sorting, search: extView.search,
			isLoading: summary.isLoading || baseExts.isLoading,
			// Таблица не гаснет на время чтения: крутится только кнопка, прежние данные
			// остаются читаемыми.
			reloading: check.checking || extReading,
			// Показаны расширения базы — обновляем их у самой 1С; показана сводка по всем
			// базам — перечитываем сводку: спрашивать сто баз по одной кнопке нельзя.
			onReload: () => {
				if (primary === "bases" && activeBase) void check.run([activeBase]);
				else void summary.refetch();
			},
			reloadTitle: primary === "bases" && activeBase
				? `${translate("onecExtCheck")}: ${activeBase}`
				: translate("onecReloadCached"),
			// Одиночный щелчок — связанный список справа, двойной — карточка расширения
			// (в режиме «слева базы» — в контексте выбранной базы).
			onActiveRowChange: (r) => setActiveExtRow(r ?? null),
			onRowClick: (r) => openExt(r, primary === "bases" ? activeBase : undefined),
		})} />
	);

	const basesTable = (
		<Table {...buildStaticTableProps({
			componentName: "OneCAdmin_extBases", rows: baseView.rows, columns: baseCols,
			setColumns: setBaseCols, sorting: baseView.sorting, search: baseView.search,
			isLoading: bases.isLoading,
			reloading: refreshFromCluster.isPending || basesRefreshing,
			/*
			 * «Обновить» в таблице БАЗ обновляет БАЗЫ — спрашивает кластер и перечитывает
			 * список. Содержимое базы обновляет та таблица, которая его показывает, — своей
			 * кнопкой: иначе по кнопке нельзя понять, что именно сейчас запросят.
			 */
			onReload: () => void refreshFromCluster.mutate(),
			reloadTitle: translate("onecRefreshFromCluster"),
			selectable: true,
			onSelectionChange: (sel, all) => setPickedBases(all.filter((r) => sel.has(Number(r.id)))),
			onActiveRowChange: (r) => setActiveBase(r ? asText(r.baseKey) : ""),
			// Строка — база: двойной щелчок открывает её карточку.
			onRowClick: (r) => openBase(asText(r.baseKey)),
			/*
			 * Установка и удаление — ТОЛЬКО через помощник: набор баз, параметры и «что
			 * произойдёт» он спрашивает по шагам. Отметки строк уходят заготовкой, имя
			 * расширения — тоже: то, что уже известно, человек вводить не должен.
			 */
			extraButtons: <BaseGroupCommands selected={pickedBases} groups={["extensions"]} presetName={activeExt} />,
		})} />
	);

	const status = primary === "extensions"
		? (activeExt
			? `${translate("onecExtBases")}: ${activeExt} · ${installed} / ${baseRows.length}`
			: translate("onecPickExtFirst"))
		: (activeBase
			? `${translate("onecBaseExtensions")}: ${activeBase} · ${extRows.length}`
			: translate("onecPickBaseFirst"));

	return (
		<>
			<CapabilityGuard capability="ib.admin" />
			{/* Установка и удаление расширения обновят сводку сразу или с задержкой. */}
			<EchoDelayNotice />
			{/* Ошибки запросов рисуют НИЧЕГО — уходят сообщением в «Технические сообщения». */}
			<QueryError error={summary.error ?? bases.error ?? baseExts.error}
				noticeKey="ext-summary" source={translate("onecTabExtensions")} />

			<div className={styles.ModeBar}>
				{/* Один переключатель, а не два состояния кнопками: раскладок ровно две,
				    и «поменять местами» — одно действие, а не выбор из списка. */}
				<Button variant="secondary" title={translate("onecSwapTablesHint")}
					onClick={() => setPrimary((p) => (p === "extensions" ? "bases" : "extensions"))}>
					<Icon name="syncFromBasis" /> {translate("onecSwapTables")}
				</Button>
			</div>

			<div className={styles.PairBody} ref={split.containerRef}>
				<div className={styles.NavPane} style={{ flexBasis: `${split.percent}%` }}>
					{primary === "extensions" ? extsTable : basesTable}
				</div>
				<VSplitBar onPointerDown={split.startResize} onDoubleClick={split.reset} onNudge={split.nudge} />
				<div className={styles.NavPane} style={{ flexBasis: `${100 - split.percent}%` }}>
					{primary === "extensions" ? basesTable : extsTable}
				</div>
			</div>

			<div className={styles.StatusBar}>
				<span className={styles.StatusText}>{status}</span>
				<span className={styles.HeadActions}>
					<Button variant="primary" disabled={!activeExtRow}
						title={activeExtRow ? translate("onecOpenCard") : translate("onecPickExtFirst")}
						onClick={() => activeExtRow && openExt(activeExtRow, primary === "bases" ? activeBase : undefined)}>
						<Icon name="open" /> {translate("onecOpenCard")}
					</Button>
				</span>
			</div>
		</>
	);
};

export default ExtensionsTab;
