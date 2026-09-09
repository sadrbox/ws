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
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import Tabs from "src/components/Tabs";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
import { asText } from "src/utils/asText";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBaseUsers, fetchBaseUsersCached, fetchBases, fetchBatches, fetchUserOccurrences, fetchUserSummary,
} from "src/services/onec/api";
import { Icon } from "src/components/IconButton/icons";
import { VSplitBar, useSplitResize } from "src/components/SplitPane";
import { CapabilityGuard, QueryError, checkBases, isApplicable, useCheckParallel } from "./shared";
import { useOpenBaseUser } from "./BaseUserForm";
import ProgressTab from "./ProgressTab";
import { finishOp, hasRunningBatches, mergeBatch, progressOp, startOp, useOnecOps } from "./progress";
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

export const UsersTab: FC<{ onBatchStarted: (id: string) => void }> = () => {
	/** Что слева: базы (по умолчанию) или пользователи. Правая таблица — связанная. */
	const [primary, setPrimary] = useState<"bases" | "users">("bases");
	const [activeBase, setActiveBase] = useState("");
	const [activeUser, setActiveUser] = useState("");
	const [checking, setChecking] = useState(false);

	const parallel = useCheckParallel();
	const openCard = useOpenBaseUser();
	const qc = useQueryClient();

	/**
	 * Опрос заданий: пока есть незавершённые команды, состояние тянется каждые три секунды
	 * и переносится в реестр операций. Опрос живёт ЗДЕСЬ, а не во вкладке прогресса: команду
	 * ставят с этого экрана и из карточки, и прогресс не должен замирать оттого, что человек
	 * смотрит на таблицы. Как только незавершённых не остаётся, опрос выключается сам —
	 * держать постоянный трафик ради пустого списка незачем.
	 */
	const ops = useOnecOps();
	const watching = hasRunningBatches(ops);
	const batches = useQuery({
		queryKey: ["onec", "batches"],
		queryFn: fetchBatches,
		// Запрос включён всегда — иначе кнопка «Обновить» на вкладке прогресса не работала
		// бы (отключённый запрос перезапрашивать нечем). Периодичность же появляется только
		// при незавершённых командах.
		refetchInterval: watching ? 3000 : false,
		staleTime: 0,
	});
	useEffect(() => {
		for (const b of batches.data?.items ?? []) mergeBatch(b);
	}, [batches.data]);

	// Команда закончилась — реестр в панели устарел: перечитываем то, что она меняла.
	const wasWatching = useRef(false);
	useEffect(() => {
		if (wasWatching.current && !watching) {
			void qc.invalidateQueries({ queryKey: ["onec", "user-summary"] });
			void qc.invalidateQueries({ queryKey: ["onec", "base-users-cached"] });
			void qc.invalidateQueries({ queryKey: ["onec", "user-where"] });
		}
		wasWatching.current = watching;
	}, [watching, qc]);

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
		const src = primary === "bases"
			? (bases.data?.items ?? []).filter((b) => isApplicable(b, "ib"))
				.map((b) => ({ key: b.key, name: b.name || "—", users: "" }))
			// Правая таблица в режиме «слева пользователи»: базы выбранного человека.
			: (occurrences.data?.items ?? [])
				.map((o) => ({ key: o.baseKey, name: o.baseName || "—", users: String((o.roles ?? []).length) }));
		return src.map((x, i) => ({
			id: i + 1, uuid: x.key, baseKey: x.key, name: x.name,
			usersCount: x.users || (primary === "bases" ? "" : "0"),
		}));
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

	/** Прочитать содержимое базы у самой 1С: единственная команда этого экрана. */
	const recheck = useCallback(async (keys: string[]) => {
		if (!keys.length) return;
		setChecking(true);
		const op = startOp({
			kind: "read", title: translate("onecUsersCheck"),
			target: keys.length === 1 ? keys[0] : `${translate("onecBases")}: ${keys.length}`,
			total: keys.length,
		});
		const r = await checkBases(keys, fetchBaseUsers, parallel, (done, failed) => progressOp(op, done, failed));
		finishOp(op, {
			failed: r.failed.length,
			note: r.failed.length ? `${r.failed[0].baseKey}: ${r.failed[0].message}` : "",
		});
		setChecking(false);
		showToast(
			r.failed.length
				? `${translate("onecChecked")}: ${r.ok}/${keys.length}. ${translate("onecCheckFailed")}: ${r.failed[0].baseKey} — ${r.failed[0].message}`
				: `${translate("onecChecked")}: ${r.ok}`,
			r.failed.length ? "warning" : "success",
		);
	}, [parallel]);

	// ── Таблицы ─────────────────────────────────────────────────────────────
	const basesTable = (
		<Table {...buildStaticTableProps({
			componentName: "OneCAdmin_ubBases", rows: baseView.rows, columns: baseCols,
			setColumns: setBaseCols, sorting: baseView.sorting, search: baseView.search,
			isLoading: bases.isLoading || occurrences.isLoading,
			onReload: () => void bases.refetch(),
			// Одиночный щелчок — связанный список справа. Двойной — карточка пары.
			onActiveRowChange: (r) => setActiveBase(r ? asText(r.baseKey) : ""),
			onRowClick: (r) => openCard(activeUser || "", asText(r.baseKey)),
			extraButtons: (
				<Button variant="secondary" disabled={!activeBase || checking}
					title={activeBase ? `${translate("onecUsersCheck")}: ${activeBase}` : translate("onecPickBaseFirst")}
					onClick={() => void recheck([activeBase])}>
					<Icon name="reload" /> {translate("onecUsersCheck")}
				</Button>
			),
		})} />
	);

	const usersTable = (
		<Table {...buildStaticTableProps({
			componentName: "OneCAdmin_ubUsers", rows: userView.rows, columns: userCols,
			setColumns: setUserCols, sorting: userView.sorting, search: userView.search,
			isLoading: summary.isLoading || baseUsers.isLoading,
			onReload: () => void summary.refetch(),
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
				<Button variant="secondary" title={translate("onecSwapTables")}
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
					<QueryError error={bases.error ?? summary.error ?? baseUsers.error ?? occurrences.error} />
					<Button variant="primary"
						disabled={primary === "bases" ? !activeBase || !activeUser : !activeUser}
						title={primary === "bases"
							? (!activeBase ? translate("onecPickBaseFirst")
								: !activeUser ? translate("onecPickUserFirst") : translate("onecOpenCard"))
							: (!activeUser ? translate("onecPickUserFirst") : translate("onecOpenCard"))}
						onClick={() => openCard(activeUser, activeBase)}>
						<Icon name="open" /> {translate("onecOpenCard")}
					</Button>
				</span>
			</div>
		</div>
	);

	// Прогресс — соседняя вкладка, а не окно поверх: длинная проверка не должна закрывать
	// собой таблицы, а короткая — отвлекать. Обе панели остаются смонтированными, поэтому
	// переключение не теряет ни выделения, ни прокрутки.
	const running = ops.filter((o) => o.state === "running").length;

	return (
		<>
			<CapabilityGuard capability="ib.admin" />
			<Tabs
				tabs={[
					{ id: "screen", label: translate("onecTabUsersList"), component: screen },
					{
						id: "progress",
						label: running ? `${translate("onecTabProgress")} (${running})` : translate("onecTabProgress"),
						component: (
							<ProgressTab
								isLoading={batches.isFetching}
								onRefresh={() => void batches.refetch()}
							/>
						),
					},
				]}
			/>
		</>
	);
};

export default UsersTab;
