/**
 * Групповые команды — ВЫБОР ОПЕРАЦИИ, а не сама операция.
 *
 * Раньше здесь же жило и окно ввода параметров, и отправка задания. Теперь кнопка только
 * называет операцию и открывает помощник (GroupCommandWizard), где по шагам спрашивают
 * над чем, что менять и что из этого выйдет. Причина простая: три разных вопроса в одном
 * модальном окне размером с записку перемешивались, а «что произойдёт» не показывалось
 * вовсе — человек узнавал итог из отчёта задания.
 *
 * Исключение — чтение, которому помощник не нужен: «Проверить базы данных» (отмеченные базы или все) — в меню
 * «Операции». Публикации проверяет сама кнопка «Обновить» списка баз (17.09): отдельный пункт стал не нужен. Они доступны
 * и уровню «только просмотр» — чтение ничего не меняет (F5).
 */
import { useRunningCommand } from "src/components/TechMessages/operations";
import { FC } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import type { IconName } from "src/components/IconButton/icons";
import { reportError } from "src/services/errors/route";
import type { TDataItem } from "src/components/Table/types";
import { asText } from "src/utils/asText";
import { checkBasesDb, removeBaseFromRegistry } from "src/services/onec/api";
import { withOp } from "./progress";
import { notify } from "src/components/TechMessages/store";
import { checkDbOutcome } from "./checkBasesDb";
import { GROUP_OPS, useOpenGroupCommand, type GroupOp } from "./GroupCommandWizard";
import {
	changesNothing, reportBatchStart, splitTargets, useOnecWrite, useOnecPermissions,
} from "./shared";
import { runGroupCommand } from "./runGroupCommand";
import { useAppContext } from "src/app/context";
import { SECTION_OF_TYPE, sectionAllows } from "./onecPermissions";

export type CommandGroup = "operations" | "users" | "extensions";

/** Строка таблицы баз — в вид, который понимают правила пригодности (shared.isApplicable / alreadyInTarget). */
const asBase = (r: TDataItem) => ({
	status: asText(r.status),
	disabled: r.disabled === true,
	published: typeof r.published === "boolean" ? r.published : null,
	clusterStatus: r.clusterStatus ? asText(r.clusterStatus) : undefined,
	ibUnreachableAt: r.ibUnreachableAt ? asText(r.ibUnreachableAt) : null,
	ibUnreachableReason: r.ibUnreachableReason ? asText(r.ibUnreachableReason) : null,
	scheduledJobsDenied: typeof r.scheduledJobsDenied === "boolean" ? r.scheduledJobsDenied : null,
});

type GroupSpec = {
	label: string;
	icon: IconName;
	ops: GroupOp[];
	/** Разделы меню: заголовок и свои команды (17.09) — «Обслуживание» внутри «Операций». */
	sections?: { label: string; ops: GroupOp[] }[];
};

const GROUPS: Record<CommandGroup, GroupSpec> = {
	/*
	 * «ОПЕРАЦИИ» (17.09) — всё, что делают с самой базой, одним меню: сведения, регламентные задания, публикация, а
	 * ниже — проверки публикаций и баз данных. Раньше публикация жила отдельной группой, а сведения и регламентные
	 * задания — только в карточке одной базы.
	 */
	operations: {
		label: "onecOperations", icon: "settings",
		// Без раздела — то, что про саму базу целиком.
		ops: ["info"],
		/*
		 * РАЗДЕЛЫ (18.09): публикация, регламентные задания и обслуживание — три разных предмета, и вперемешку
		 * читались как один список из семи строк. Отдельные кнопки рядом с «Операциями» им не нужны: предмет у всех
		 * один — что сделать с отмеченными базами.
		 */
		sections: [
			{ label: "onecPublication", ops: ["publish", "unpublish"] },
			{ label: "onecScheduledJobs", ops: ["denyJobs", "allowJobs"] },
			{ label: "onecTabMaintenance", ops: ["checkBase", "backup"] },
		],
	},
	users: { label: "onecTabUsers", icon: "plus", ops: ["createUser", "deleteUser"] },
	extensions: { label: "onecTabExtensions", icon: "download", ops: ["installExt", "deleteExt"] },
};

export const BaseGroupCommands: FC<{
	selected: TDataItem[];
	/** Какие группы показывать. По умолчанию — те, чей предмет сама база. */
	groups?: CommandGroup[];
	/** Имя объекта, подставляемое в помощник: экран расширений знает его заранее. */
	presetName?: string;
}> = ({ selected, groups = ["operations"], presetName }) => {
	const canWrite = useOnecWrite();
	const perms = useOnecPermissions();
	const dbChecking = useRunningCommand(["CLUSTER_CHECK_BASES"]);
	/**
	 * Пользователи и расширения — по вложенным разрешениям, прочие операции — по общему праву. «Обновить сведения»
	 * — чтение: доступно и просмотру (сервис такое задание разрушающим не считает).
	 */
	const opAllowed = (o: GroupOp) => {
		if (GROUP_OPS[o].type === "IB_INFO") return true;
		const need = SECTION_OF_TYPE[GROUP_OPS[o].type];
		return need ? sectionAllows(perms, need.section, need.action, 1) : canWrite;
	};
	/*
	 * ПУНКТ — ПО СОСТОЯНИЮ ОТМЕЧЕННЫХ БАЗ. «Запретить регламентные задания» нужен, если хоть у одной отмеченной они
	 * не запрещены; «Разрешить» — если хоть у одной запрещены; отмечены базы в обоих состояниях — доступны оба. Без
	 * отметок доступно всё: базы выбирают в помощнике. Правило то же, по которому помощник отсеивает базы
	 * (alreadyInTarget), — меню и помощник не спорят.
	 */
	const nothingToChange = (o: GroupOp) => changesNothing(selected, GROUP_OPS[o].target);
	const qc = useQueryClient();
	const { confirm } = useAppContext().actions;
	const openWizard = useOpenGroupCommand();
	const keys = selected.map((r) => asText(r.baseKey)).filter(Boolean);

	/**
	 * «Проверить базы данных» (P2): есть ли у зарегистрированных баз их база данных в СУБД —
	 * фантомы, которые кластер перечисляет, а открыть нельзя. Без отметок — все базы, с
	 * отметками — отмеченные. На сотне баз ответ идёт до минуты: ход виден в «Прогрессе», а
	 * итог пишем сами — содержательнее безликого «Выполнено».
	 */
	const CHECK_DB = "checkBasesDb";
	/**
	 * «Удалить запись идентификатора базы» — не команда 1С, а удаление записи ПАНЕЛИ по каждой отмеченной базе
	 * (сервис удаляет по одной, задания для этого нет). Поэтому не через GROUP_OPS: у него нет типа команды агента.
	 */
	const REMOVE_RECORD = "removeBaseRecord";

	const checkDb = useMutation({
		mutationFn: () => withOp(
			{
				kind: "read", title: translate("onecBasesDbCheck"),
				target: keys.length ? `${translate("onecBatchTargets")}: ${keys.length}` : translate("onecTabBases"),
				total: 0, reportsOwnOutcome: true,
			},
			() => checkBasesDb(keys),
		),
		onSuccess: (d) => {
			// Отметки в реестре сервис уже поставил при приёме ответа — перечитываем список.
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
			const o = checkDbOutcome(d);
			notify({ severity: o.severity, source: translate("onecTabBases"), text: o.text });
		},
		onError: (e) => reportError(e, { source: translate("onecTabBases") }),
	});

	/*
	 * КОМАНДА ВЫПОЛНЯЕТСЯ ПО ОТМЕЧЕННЫМ БАЗАМ (17.09), а помощник остаётся там, где без него нельзя: базы не отмечены
	 * (их надо выбрать) или у команды есть параметры — имя пользователя, файл расширения.
	 *
	 * Перед запуском отмеченные базы отсеиваются тем же правилом, что показывает помощник (fitReason): непригодные
	 * (нет в кластере, не войти) и те, которым команда ничего не изменит, в задание не уходят, а называются в
	 * подтверждении. Не осталось ни одной — команды нет вовсе, и панель говорит почему.
	 */
	const run = useMutation({
		mutationFn: ({ op, targets }: { op: GroupOp; targets: string[] }) =>
			runGroupCommand(GROUP_OPS[op], targets, GROUP_OPS[op].payload ?? {}),
		onSuccess: (r, { op }) => {
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
			reportBatchStart(r, translate(GROUP_OPS[op].title));
		},
		onError: (e, { op }) => reportError(e, { source: translate(GROUP_OPS[op].title) }),
	});

	/*
	 * Удаление записей панели идёт по одной базе: сервис удаляет по ключу и отказывает базе, которая есть в кластере.
	 * Отказ по одной базе не отменяет остальные — итог собираем и говорим числом.
	 */
	const removeRecords = useMutation({
		mutationFn: (targets: string[]) => withOp(
			{ kind: "delete", title: translate("onecBaseRemoveFromList"), target: `${translate("onecBases")}: ${targets.length}`, total: targets.length },
			async () => {
				let removed = 0;
				const failed: string[] = [];
				for (const key of targets) {
					try {
						const r = await removeBaseFromRegistry(key);
						if (r.removed) removed += 1; else failed.push(key);
					} catch { failed.push(key); }
				}
				return { removed, failed };
			},
		),
		onSuccess: ({ removed, failed }) => {
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
			notify({
				severity: failed.length ? "warning" : "success", source: translate("onecBaseRemoveFromList"),
				text: `${translate("onecBaseRemovedFromList")}: ${removed}`
					+ (failed.length ? ` · ${translate("onecBatchNotQueued")}: ${failed.length} (${failed[0]})` : ""),
			});
		},
		onError: (e) => reportError(e, { source: translate("onecBaseRemoveFromList") }),
	});

	/** Отмеченные базы в виде, который понимают правила пригодности. */
	const chosenBases = selected
		.filter((r) => keys.includes(asText(r.baseKey)))
		.map((r) => ({ key: asText(r.baseKey), ...asBase(r) }));
	/** Цели опасных команд: только отмеченные и только те, к которым команда применима (18.09). */
	const dangerTargets = {
		dropRegistration: splitTargets(chosenBases, "drop").targets,
		[REMOVE_RECORD]: splitTargets(chosenBases, "record").targets,
	} as Record<string, { key: string }[]>;

	const start = async (op: GroupOp) => {
		const spec = GROUP_OPS[op];
		// Помощник: целей нет или команде нужны параметры (имя, файл, каталог выгрузки).
		if (!keys.length || spec.needsName || spec.needsFile || spec.needsDir) { openWizard(op, keys, presetName); return; }

		const { targets, skipped } = splitTargets(chosenBases, spec.needs, spec.target);
		if (!targets.length) {
			const reason = skipped[0]?.reason ?? "";
			notify({
				severity: "warning", source: translate(spec.title),
				text: `${translate("onecBatchNothingQueued")}${reason ? `: ${reason}` : ""}`,
			});
			return;
		}
		// Изменение подтверждаем: команда уходит сразу, без шага «что произойдёт».
		if (spec.kind !== "read") {
			const lines = [
				translate(spec.warning),
				`${translate("onecBatchTargets")}: ${targets.length}`
					+ (skipped.length ? ` · ${translate("onecBatchNotQueued")}: ${skipped.length} (${skipped[0].reason})` : ""),
			];
			if (!(await confirm(lines.join("\n\n")))) return;
		}
		run.mutate({ op, targets: targets.map((r) => r.key) });
	};

	const startRemoveRecords = async () => {
		const targets = dangerTargets[REMOVE_RECORD];
		if (!targets.length) return;
		const lines = [
			translate("onecBaseRemoveFromListWarning"),
			`${translate("onecBatchTargets")}: ${targets.length}`,
		];
		if (!(await confirm(lines.join("\n\n")))) return;
		removeRecords.mutate(targets.map((r) => r.key));
	};

	/** Подпись операции в списке группы — та же, что была на отдельной кнопке. */
	const OP_LABEL: Record<GroupOp, string> = {
		publish: "onecPublish", unpublish: "onecUnpublish",
		info: "onecBaseInfoRefresh", denyJobs: "onecScheduledJobsDeny", allowJobs: "onecScheduledJobsAllow",
		dropRegistration: "onecBaseDropRegistration",
		createUser: "onecUserCreate", deleteUser: "onecUserDelete",
		installExt: "onecExtInstall", deleteExt: "onecExtRemove",
		backup: "onecBackup", checkBase: "onecMaintCheck",
	};

	/*
	 * Иконка вложенной команды — та же 16×16 из общего реестра, что и у кнопок: пункт
	 * меню и кнопка, которая делает то же самое (например «Установить расширение» в
	 * карточке базы), должны выглядеть одинаково. Разрушающее — «корзиной», создающее —
	 * «плюсом» или «загрузкой», чтение — «поиском».
	 */
	const OP_ICON: Record<GroupOp, IconName> = {
		publish: "open", unpublish: "close",
		info: "reload", denyJobs: "clear", allowJobs: "restore", dropRegistration: "trash",
		createUser: "plus", deleteUser: "trash",
		installExt: "download", deleteExt: "trash",
		backup: "save", checkBase: "search",
	};

	return (
		<>
			{groups.map((g) => {
				const spec = GROUPS[g];
				const options = [
					// Изменения (публикация, пользователи, расширения, выгрузка) — только полному
					// доступу: правом «только просмотр» их не показываем вовсе (F5).
					...spec.ops.filter(opAllowed).map((o) => ({
						id: o, label: translate(OP_LABEL[o]), icon: OP_ICON[o],
						...(nothingToChange(o) ? { disabled: true, hint: translate("onecOpNothingToChange") } : {}),
					})),
					// Разделы группы («Обслуживание») — своим заголовком, теми же правилами доступа.
					...(spec.sections ?? []).flatMap((sec) => sec.ops.filter(opAllowed).map((o) => ({
						id: o, label: translate(OP_LABEL[o]), icon: OP_ICON[o], group: translate(sec.label),
						...(nothingToChange(o) ? { disabled: true, hint: translate("onecOpNothingToChange") } : {}),
					}))),
					// Чтения — всем, кому открыта панель.
					...(g === "operations"
						? [
							{ id: CHECK_DB, label: translate("onecBasesDbCheck"), icon: "search" as IconName, disabled: checkDb.isPending || dbChecking },
						]
						: []),
					/*
					 * Опасные команды — последним разделом; только полному доступу и только когда среди ОТМЕЧЕННЫХ есть
					 * базы, к которым команда применима (18.09): снятие регистрации — пока она есть, удаление записи
					 * панели — наоборот, когда базы в кластере уже нет. Подсказка прямо в меню: по одной подписи разницу
					 * между кластером и панелью не видно, а цена ошибки разная.
					 */
					...(g === "operations" && canWrite
						? [
							{ id: "dropRegistration", label: translate(OP_LABEL.dropRegistration), icon: OP_ICON.dropRegistration, hint: translate("onecBaseDropRegistrationHint") },
							{ id: REMOVE_RECORD, label: translate("onecBaseRemoveFromList"), icon: "trash" as IconName, hint: translate("onecBaseRemoveFromListHint") },
						].map((o) => ({
							...o, group: translate("onecDangerousCommands"), danger: true,
							...(dangerTargets[o.id]?.length ? {} : { disabled: true, hint: translate("onecOpPickApplicable") }),
						}))
						: []),
				];
				if (!options.length) return null;
				return (
					<ActionsDropdownButton
						key={g}
						label={translate(spec.label)}
						icon={spec.icon}
						options={options}
						title={keys.length
							? `${translate("onecBatchTargets")}: ${keys.length}`
							: translate("onecWizPickInside")}
						onSelect={(id) => {
							if (id === CHECK_DB) { checkDb.mutate(); return; }
							if (id === REMOVE_RECORD) { void startRemoveRecords(); return; }
							void start(id as GroupOp);
						}}
					/>
				);
			})}
		</>
	);
};

export default BaseGroupCommands;
