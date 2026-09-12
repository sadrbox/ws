/**
 * Вкладка «Расширения» (E15/A3, A4): что где стоит и как это изменить.
 *
 * Собрана по тому же образцу, что «Пользователи баз», и намеренно так же: задачи у них
 * одинаковой формы — элемент, живущий во многих базах, и команда по отмеченным базам.
 * Разные экраны для одинаковых задач заставляли бы учить панель дважды.
 *
 * Слева — `Table` со сводкой расширений (отметки = цель групповой команды), справа —
 * карточка: реквизиты, базы с отметками, предпросмотр. Все команды живут в командных
 * панелях таблиц, кнопок внутри строк нет.
 *
 * ГРУППИРОВКА ПО ПАРЕ ИМЯ+СИНОНИМ. Служебное имя вида `EF_00_00062442` ничего не говорит,
 * а одно и то же имя в разных базах может принадлежать разным расширениям — склеивать их
 * в одну строку значило бы врать о том, что стоит одинаковое.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import Table from "src/components/Table";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { GroupCol, GroupRow } from "src/components/UI";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { fetchBases, fetchExtensionSummary } from "src/services/onec/api";
import { Icon } from "src/components/IconButton/icons";
import { CapabilityGuard, EchoDelayNotice, QueryError, isApplicable, useBaseContentCheck } from "./shared";
import { useOpenGroupCommand } from "./GroupCommandWizard";
import { useOpenOnecBase } from "src/models/OneCBases";
import styles from "./OneCAdmin.module.scss";

const summaryColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "synonym", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "basesCount", type: "number", width: "90px", minWidth: "70px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

const baseColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "presence", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "extensionsCount", type: "number", width: "130px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Файл .cfe → base64: агент не ходит за ним в сеть, файл едет телом команды. */
export const ExtensionsTab: FC = () => {
	const openBase = useOpenOnecBase();

	const [pickedExt, setPickedExt] = useState<string[]>([]);
	const [pickedBases, setPickedBases] = useState<string[]>([]);

	const summary = useQuery({ queryKey: ["onec", "ext-summary"], queryFn: fetchExtensionSummary });
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });

	const [sumCols, setSumCols] = useState<TColumn[]>(() => getModelColumns(summaryColumns(), "OneCAdmin_extSummary"));
	const [baseCols, setBaseCols] = useState<TColumn[]>(() => getModelColumns(baseColumns(), "OneCAdmin_extBases"));

	/** Карточку показываем для ПЕРВОГО отмеченного: остальные — цели той же команды. */
	const current = pickedExt[0] ?? "";
	const currentRow = useMemo(
		() => (summary.data?.items ?? []).find((x) => x.name === current) ?? null,
		[summary.data, current],
	);

	const sumRows = useMemo(() => (summary.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: `${x.name}|${x.synonym}`, name: x.name,
		synonym: x.synonym || "—", basesCount: x.bases,
	})), [summary.data]);
	const sumView = useStaticTableView(sumRows, { name: "asc" });

	/** Базы, где расширение уже стоит, — из кэша имён расширений базы. */
	const baseRows = useMemo(() => (bases.data?.items ?? [])
		.filter((b) => isApplicable(b, "ib"))
		.map((b, i) => ({
			id: i + 1, uuid: b.key, baseKey: b.key, name: b.name || "—",
			presence: current && b.extensionNames.some((n) => n.toLowerCase() === current.toLowerCase())
				? translate("onecPresent") : translate("onecAbsent"),
			extensionsCount: b.extensionsCount ?? translate("onecExtNotChecked"),
		})), [bases.data, current]);
	const baseView = useStaticTableView(baseRows, { baseKey: "asc" });

	/** Базы, где расширения ещё НЕТ, — цель установки; где есть — цель удаления. */
	const missing = useMemo(() => pickedBases.filter((k) => {
		const b = (bases.data?.items ?? []).find((x) => x.key === k);
		return !!b && !b.extensionNames.some((n) => n.toLowerCase() === current.toLowerCase());
	}), [pickedBases, bases.data, current]);
	const present = pickedBases.filter((k) => !missing.includes(k));

	/*
	 * Отправки задания здесь БОЛЬШЕ НЕТ: групповые операции выполняет помощник
	 * (GroupCommandWizard) — он спрашивает базы, параметры и показывает, что произойдёт,
	 * он же заводит запись в «Прогрессе». Экран остался тем, чем и должен быть: сводкой
	 * «какое расширение в каких базах стоит».
	 */
	const openWizard = useOpenGroupCommand();

	// Чтение расширений баз — тем же механизмом, что и пользователей (см.
	// useBaseContentCheck): операция видна в «Прогрессе запросов и команд», её итог
	// приходит сообщением, сводки после неё перечитываются.
	const check = useBaseContentCheck("extensions");

	return (
		<>
			<CapabilityGuard capability="ib.admin" />
			{/* Установка и удаление расширения обновят сводку сразу или с задержкой. */}
			<EchoDelayNotice />

			<div className={styles.UsersLayout}>
				<div className={styles.UsersList}>
					<QueryError error={summary.error} noticeKey="ext-summary" source={translate("onecTabExtensions")} />
					<Table {...buildStaticTableProps({
						componentName: "OneCAdmin_extSummary", rows: sumView.rows, columns: sumCols,
						setColumns: setSumCols, sorting: sumView.sorting, search: sumView.search,
						isLoading: summary.isLoading,
						onReload: () => void summary.refetch(),
						reloadTitle: translate("onecReloadCached"),
						/*
						 * ОДНО расширение за раз — и отметок здесь нет.
						 *
						 * Команды всё равно уходят по одному расширению: отметить три и получить
						 * установку первого — обман, а в шапке карточки при этом честно писалось
						 * «целей: 3». Работаем с активной строкой, а множественность живёт там,
						 * где она настоящая, — в выборе БАЗ ниже.
						 */
						onActiveRowChange: (r) => setPickedExt(r ? [asText(r.name)] : []),
						extraButtons: (
							<Button variant="secondary"
								title={translate("onecExtInstall")}
								onClick={() => { setPickedExt([]); openWizard("installExt", pickedBases, ""); }}>
								<Icon name="plus" /> {translate("create")}
							</Button>
						),
					})} />
				</div>

				<div className={styles.UsersCard}>
					{!current ? (
						// inline: это ВСЁ содержимое карточки, пока расширение не выбрано.
						// Отправить подсказку в боковую область значило бы показать пустой блок.
						<Notice inline items={[{ type: "info", text: translate("onecPickExtFirst") }]} />
					) : (
						<>
							<div className={styles.SecHead}>
								{translate("onecExtCard")}: {current}
							</div>
							<div className={styles.SecBody}>
								<GroupCol>
									<GroupRow>
										<Field name="ex_name" label={translate("onecExtName")} value={current} disabled width={FIELD_WIDTH.wide} onChange={() => {}} />
										<Field name="ex_syn" label={translate("onecExtSynonym")} value={currentRow?.synonym || "—"} disabled width={FIELD_WIDTH.wide} onChange={() => {}} />
										<Field name="ex_bases" label={translate("bases")} value={String(currentRow?.bases ?? 0)} disabled width={FIELD_WIDTH.sm} onChange={() => {}} />
										<Field name="ex_ver" label={translate("version")}
											value={(currentRow?.versions ?? []).join(", ") || "—"} disabled width={FIELD_WIDTH.md} onChange={() => {}} />
									</GroupRow>
								</GroupCol>
							</div>

							<div className={styles.SecHead}>{translate("onecTabBases")}</div>
							<Table {...buildStaticTableProps({
								componentName: "OneCAdmin_extBases", rows: baseView.rows, columns: baseCols,
								setColumns: setBaseCols, sorting: baseView.sorting, search: baseView.search,
								isLoading: bases.isLoading,
								reloading: check.checking,
								// «Обновить» = прочитать расширения отмеченных баз у самой 1С;
								// ничего не отмечено — перечитать список баз.
								onReload: () => {
									if (pickedBases.length) void check.run(pickedBases);
									else void bases.refetch();
								},
								reloadTitle: translate("onecExtCheck"),
								selectable: true,
								onSelectionChange: (sel, all) =>
									setPickedBases(all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.baseKey))),
								// Строка — база: двойной щелчок открывает её карточку.
								onRowClick: (r) => openBase(asText(r.baseKey)),
								/*
								 * Групповые операции — ТОЛЬКО через помощник: набор баз, параметры
								 * и «что произойдёт» он спрашивает по шагам. Здешние отметки уходят
								 * заготовкой, имя расширения — тоже: то, что уже известно, человек
								 * вводить не должен.
								 */
								extraButtons: (
									<>
										<Button variant="primary" disabled={!missing.length}
											title={missing.length ? translate("onecExtInstall") : translate("onecExtAlreadyEverywhere")}
											onClick={() => openWizard("installExt", missing, current)}>
											<Icon name="download" /> {translate("onecExtInstall")}
										</Button>
										<Button variant="danger" disabled={!present.length}
											title={present.length ? translate("onecExtRemove") : translate("onecPickBasesFirst")}
											onClick={() => openWizard("deleteExt", present, current)}>
											<Icon name="trash" /> {translate("onecExtRemove")}
										</Button>
									</>
								),
							})} />

							<div className={styles.SecHead}>{translate("onecWhatHappens")}</div>
							<div className={styles.SecBody}>
								{/* inline: единственное содержимое блока «Что произойдёт» до выбора баз. */}
								{!pickedBases.length && <Notice inline items={[{ type: "info", text: translate("onecPickBasesFirst") }]} />}
								{pickedBases.length > 0 && (
									<>
										<div className={styles.PlanRow}>
											<span className={styles.PlanBase}>{translate("onecExtInstall")}</span>
											<span className={styles.PlanAdd}>{missing.length ? missing.join(", ") : translate("onecNoChanges")}</span>
										</div>
										<div className={styles.PlanRow}>
											<span className={styles.PlanBase}>{translate("onecExtRemove")}</span>
											<span className={styles.PlanDel}>{present.length ? present.join(", ") : translate("onecNoChanges")}</span>
										</div>
									</>
								)}
								{currentRow && (
									<span className={styles.Hint}>
										{translate("onecDataFrom")}: {getFormatDate(new Date().toISOString())}
									</span>
								)}
							</div>
						</>
					)}
				</div>
			</div>

		</>
	);
};

export default ExtensionsTab;
