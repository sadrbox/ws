/**
 * Вкладка «Пользователи баз» (E15/A3): две связанные таблицы и карточка пары.
 *
 * УСТРОЙСТВО. Слева и справа — «Базы» и «Пользователи»; какая где, решает переключатель.
 * ОДИНОЧНЫЙ щелчок по строке слева (activeRow) наполняет правую таблицу связанными
 * данными: щёлкнули базу — её пользователи, щёлкнули человека — базы, где он заведён.
 * ДВОЙНОЙ щелчок открывает карточку пары «человек + база» отдельным пейном.
 *
 * ПОЧЕМУ ОДИНОЧНЫЙ, А НЕ ДВОЙНОЙ. Двойной занят открытием элемента — это общий жест
 * приложения. Если связанный список вешать на него, то, чтобы просто увидеть содержимое
 * базы, придётся открывать форму и закрывать её обратно; администратор с сотней баз
 * делает это десятки раз за день.
 *
 * КАРКАС ЖЁСТКИЙ: полоса режима, тело из двух колонок, полоса состояния. Прокручиваются
 * только таблицы, поэтому появление сообщения ничего не сдвигает.
 */
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
import {
	fetchBaseUsersCached, fetchBases, fetchUserOccurrences, fetchUserSummary, refreshBases,
} from "src/services/onec/api";
import { Icon } from "src/components/IconButton/icons";
import { VSplitBar, useSplitResize } from "src/components/SplitPane";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { CapabilityGuard, QueryError, isApplicable, useBaseUsersCheck } from "./shared";
import { useOpenBaseUser } from "./BaseUserForm";
import { useOpenBaseUserWizard } from "./BaseUserWizard";
import BaseGroupCommands from "./BaseGroupCommands";
import { withOp } from "./progress";
import { useOpenOnecBase } from "src/models/OneCBases";
import styles from "./OneCAdmin.module.scss";

const baseColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "190px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "usersCount", type: "string", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

const userColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "220px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "fullName", type: "string", width: "220px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "state", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesLabel", type: "string", width: "320px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/**
 * Пропа `onBatchStarted` у экрана нет намеренно: заданий он не запускает. Групповые
 * команды по многим базам живут в списке «Базы 1С», а правка одного человека идёт
 * карточкой пары — её прогресс виден на соседней вкладке. Раньше проп был объявлен, панель
 * передавала обработчик, а экран его даже не принимал: договорённость, которой никто не
 * исполнял.
 */
export const UsersTab: FC = () => {
	/** Что слева: базы (по умолчанию) или пользователи. Правая таблица — связанная. */
	const [primary, setPrimary] = useState<"bases" | "users">("bases");
	const [activeBase, setActiveBase] = useState("");
	const [activeUser, setActiveUser] = useState("");
	/** Отмеченные базы — цель групповых команд по пользователям. */
	const [pickedBases, setPickedBases] = useState<TDataItem[]>([]);

	const openCard = useOpenBaseUser();
	const openWizard = useOpenBaseUserWizard();
	const openBase = useOpenOnecBase();
	const qc = useQueryClient();

	// Ширина таблиц — тем же разделителем, что в списках с предпросмотром и отчётах:
	// у администратора свои пропорции (сто баз против десятка людей), и они должны
	// пережить закрытие вкладки.
	const split = useSplitResize({
		storageKey: "onec_users_split",
		side: "left",
		defaultPercent: 50,
		min: 25,
		max: 75,
	});

	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	const summary = useQuery({ queryKey: ["onec", "user-summary"], queryFn: fetchUserSummary });
	// Пользователи выбранной базы и базы выбранного человека — оба из кэша реестра:
	// связанный список должен появляться от щелчка, а не от сеанса 1С.
	const baseUsers = useQuery({
		queryKey: ["onec", "base-users-cached", activeBase],
		queryFn: () => fetchBaseUsersCached(activeBase),
		enabled: primary === "bases" && !!activeBase,
	});
	const occurrences = useQuery({
		queryKey: ["onec", "user-where", activeUser],
		queryFn: () => fetchUserOccurrences(activeUser),
		enabled: primary === "users" && !!activeUser,
	});

	const [baseCols, setBaseCols] = useState<TColumn[]>(() => getModelColumns(baseColumns(), "OneCAdmin_ubBases"));
	const [userCols, setUserCols] = useState<TColumn[]>(() => getModelColumns(userColumns(), "OneCAdmin_ubUsers"));

	// ── Строки: базы ────────────────────────────────────────────────────────
	const baseRows = useMemo(() => {
		const known = new Map((bases.data?.items ?? []).map((b) => [b.key.toLowerCase(), b]));
		const src = primary === "bases"
			? (bases.data?.items ?? []).filter((b) => isApplicable(b, "ib"))
				.map((b) => ({ key: b.key, name: b.name || "—", users: "" }))
			// Правая таблица в режиме «слева пользователи»: базы выбранного человека.
			: (occurrences.data?.items ?? [])
				.map((o) => ({ key: o.baseKey, name: o.baseName || "—", users: String((o.roles ?? []).length) }));
		return src.map((x, i) => {
			const b = known.get(x.key.toLowerCase());
			return {
				id: i + 1, uuid: x.key, baseKey: x.key, name: x.name,
				usersCount: x.users || (primary === "bases" ? "" : "0"),
				// Реквизиты применимости — для групповых команд по отмеченным базам:
				// без них команда ушла бы в пропавшую или отключённую базу.
				status: b?.status ?? "UNKNOWN",
				disabled: b?.disabled ?? false,
				published: b?.published ?? null,
			};
		});
	}, [primary, bases.data, occurrences.data]);
	const baseView = useStaticTableView(baseRows, { baseKey: "asc" });

	// ── Строки: пользователи ────────────────────────────────────────────────
	const userRows = useMemo(() => {
		const src = primary === "users"
			? (summary.data?.items ?? []).map((u) => ({
				name: u.name, fullName: "—", disabled: u.disabled > 0,
				roles: (u.roles ?? []).join(", ") || "—",
			}))
			// Правая таблица в режиме «слева базы»: пользователи выбранной базы.
			: (baseUsers.data?.items ?? []).map((u) => ({
				name: u.name, fullName: u.fullName || "—", disabled: !!u.disabled,
				roles: (u.roles ?? []).join(", ") || "—",
			}));
		return src.map((u, i) => ({
			id: i + 1, uuid: u.name, name: u.name, fullName: u.fullName,
			state: u.disabled ? translate("onecUserDisabled") : translate("onecUserActive"),
			rolesLabel: u.roles,
		}));
	}, [primary, summary.data, baseUsers.data]);
	const userView = useStaticTableView(userRows, { name: "asc" });

	// Проверка содержимого базы — общий механизм (см. useBaseUsersCheck): та же кнопка
	// в карточке базы обязана делать ровно то же самое.
	const check = useBaseUsersCheck();

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
		onError: (e) => reportError(e, { source: translate("onecTabUsers") }),
	});

	// ── Таблицы ─────────────────────────────────────────────────────────────
	const basesTable = (
		<Table {...buildStaticTableProps({
			componentName: "OneCAdmin_ubBases", rows: baseView.rows, columns: baseCols,
			setColumns: setBaseCols, sorting: baseView.sorting, search: baseView.search,
			isLoading: bases.isLoading || occurrences.isLoading,
			// Таблица не гаснет на время чтения: крутится только кнопка, прежние данные
			// остаются читаемыми.
			reloading: refreshFromCluster.isPending,
			/*
			 * «Обновить» в таблице БАЗ обновляет БАЗЫ — спрашивает кластер и перечитывает
			 * список. Раньше она читала пользователей активной базы: кнопка стояла в одной
			 * таблице, а обновляла содержимое соседней, и по ней нельзя было понять, что
			 * именно сейчас запросят. Содержимое базы обновляет та таблица, которая его
			 * показывает, — своей кнопкой.
			 *
			 * ОТМЕТКИ СТРОК — для групповых команд по пользователям: завести или удалить
			 * человека сразу в нескольких базах. Раньше они жили в списке «Базы 1С», то
			 * есть команда про пользователей стояла там, где о пользователях ни слова;
			 * теперь каждая команда живёт рядом со своим предметом.
			 */
			onReload: () => void refreshFromCluster.mutate(),
			reloadTitle: translate("onecRefreshFromCluster"),
			selectable: true,
			onSelectionChange: (sel, all) =>
				setPickedBases(all.filter((r) => sel.has(Number(r.id)))),
			// Одиночный щелчок — связанный список справа. Двойной — карточка БАЗЫ:
			// строка таблицы баз открывает элемент своего типа, а не то, ради чего
			// таблицу показали рядом.
			onActiveRowChange: (r) => setActiveBase(r ? asText(r.baseKey) : ""),
			onRowClick: (r) => openBase(asText(r.baseKey)),
			/*
			 * Групповые команды по пользователям — через помощник: набор баз, параметры и
			 * «что произойдёт» он спрашивает по шагам. Отметки строк уходят заготовкой.
			 */
			extraButtons: <BaseGroupCommands selected={pickedBases} groups={["users"]} />,
		})} />
	);

	const usersTable = (
		<Table {...buildStaticTableProps({
			componentName: "OneCAdmin_ubUsers", rows: userView.rows, columns: userCols,
			setColumns: setUserCols, sorting: userView.sorting, search: userView.search,
			isLoading: summary.isLoading || baseUsers.isLoading,
			reloading: check.checking,
			// Показаны пользователи базы — обновляем их у 1С; показана сводка по всем
			// базам — перечитываем сводку: спрашивать сто баз по одной кнопке нельзя.
			onReload: () => {
				if (primary === "bases" && activeBase) void check.run([activeBase]);
				else void summary.refetch();
			},
			reloadTitle: primary === "bases" && activeBase
				? `${translate("onecUsersCheck")}: ${activeBase}`
				: translate("onecReloadCached"),
			onActiveRowChange: (r) => setActiveUser(r ? asText(r.name) : ""),
			// Карточка пары: человек из этой строки, база — активная слева.
			onRowClick: (r) => openCard(asText(r.name), activeBase),
		})} />
	);

	const status = primary === "bases"
		? (activeBase
			? `${translate("onecBaseUsers")}: ${activeBase} · ${userRows.length}`
			: translate("onecPickBaseFirst"))
		: (activeUser
			? `${translate("onecUserBases")}: ${activeUser} · ${baseRows.length}`
			: translate("onecPickUserFirst"));

	const screen = (
		<div className={styles.UsersScreen}>
			<div className={styles.ModeBar}>
				{/* Один переключатель, а не два состояния кнопками: раскладок ровно две,
				    и «поменять местами» — одно действие, а не выбор из списка. */}
				<Button variant="secondary" title={translate("onecSwapTablesHint")}
					onClick={() => setPrimary((p) => (p === "bases" ? "users" : "bases"))}>
					<Icon name="syncFromBasis" /> {translate("onecSwapTables")}
				</Button>
				<span className={styles.ModeSpacer} />
			</div>

			<div className={styles.PairBody} ref={split.containerRef}>
				<div className={styles.NavPane} style={{ flexBasis: `${split.percent}%` }}>
					{primary === "bases" ? basesTable : usersTable}
				</div>
				<VSplitBar onPointerDown={split.startResize} onDoubleClick={split.reset} onNudge={split.nudge} />
				<div className={styles.NavPane} style={{ flexBasis: `${100 - split.percent}%` }}>
					{primary === "bases" ? usersTable : basesTable}
				</div>
			</div>

			<div className={styles.StatusBar}>
				<span className={styles.StatusText}>{status}</span>
				<span className={styles.HeadActions}>
					<QueryError error={bases.error ?? summary.error ?? baseUsers.error ?? occurrences.error}
						noticeKey="base-users" source={translate("onecTabUsers")} />
					<Button variant="primary"
						disabled={primary === "bases" ? !activeBase || !activeUser : !activeUser}
						title={primary === "bases"
							? (!activeBase ? translate("onecPickBaseFirst")
								: !activeUser ? translate("onecPickUserFirst") : translate("onecOpenCard"))
							: (!activeUser ? translate("onecPickUserFirst") : translate("onecOpenCard"))}
						onClick={() => openCard(activeUser, activeBase)}>
						<Icon name="open" /> {translate("onecOpenCard")}
					</Button>
					{/*
					  * Групповая правка одного человека сразу в нескольких базах — помощником:
					  * базы выбирают явным шагом, расхождения видно до применения. Карточка
					  * пары правит ОДНУ базу и в чужие не лезет.
					  */}
					<Button variant="secondary" disabled={!activeUser}
						title={activeUser ? `${translate("onecUserGroupEdit")}: ${activeUser}` : translate("onecPickUserFirst")}
						onClick={() => openWizard(activeUser)}>
						<Icon name="editInline" /> {translate("onecUserGroupEdit")}
					</Button>
				</span>
			</div>
		</div>
	);

	/*
	 * Прогресс здесь БОЛЬШЕ НЕ ЖИВЁТ: он переехал в правую область панели и виден с любой
	 * вкладки. Своя вкладка прогресса означала, что операция, запущенная отсюда, пропадает
	 * из виду, стоит уйти на «Базы», — хотя она продолжает идти.
	 */
	return (
		<>
			<CapabilityGuard capability="ib.admin" />
			{screen}
		</>
	);
};

export default UsersTab;
