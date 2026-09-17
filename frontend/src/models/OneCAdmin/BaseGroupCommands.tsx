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
import { checkBasesDb } from "src/services/onec/api";
import { withOp } from "./progress";
import { notify } from "src/components/TechMessages/store";
import { checkDbOutcome } from "./checkBasesDb";
import { GROUP_OPS, useOpenGroupCommand, type GroupOp } from "./GroupCommandWizard";
import {
	changesNothing, isApplicable, useOnecWrite, useOnecPermissions,
} from "./shared";
import { SECTION_OF_TYPE, sectionAllows } from "./onecPermissions";

export type CommandGroup = "operations" | "maintenance" | "users" | "extensions";

const GROUPS: Record<CommandGroup, { label: string; icon: IconName; ops: GroupOp[]; dangerOps?: GroupOp[] }> = {
	/*
	 * «ОПЕРАЦИИ» (17.09) — всё, что делают с самой базой, одним меню: сведения, регламентные задания, публикация, а
	 * ниже — проверки публикаций и баз данных. Раньше публикация жила отдельной группой, а сведения и регламентные
	 * задания — только в карточке одной базы.
	 */
	operations: {
		label: "onecOperations", icon: "settings", ops: ["info", "denyJobs", "allowJobs", "publish", "unpublish"],
		// Отдельным разделом в конце меню, красным: запись в кластере восстанавливается только вручную.
		dangerOps: ["dropRegistration"],
	},
	maintenance: { label: "onecTabMaintenance", icon: "save", ops: ["checkBase", "backup"] },
	users: { label: "onecTabUsers", icon: "plus", ops: ["createUser", "deleteUser"] },
	extensions: { label: "onecTabExtensions", icon: "download", ops: ["installExt", "deleteExt"] },
};

export const BaseGroupCommands: FC<{
	selected: TDataItem[];
	/** Какие группы показывать. По умолчанию — те, чей предмет сама база. */
	groups?: CommandGroup[];
	/** Имя объекта, подставляемое в помощник: экран расширений знает его заранее. */
	presetName?: string;
}> = ({ selected, groups = ["operations", "maintenance"], presetName }) => {
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
	/*
	 * Удалить регистрацию можно только у базы, в которую не войти. Отмечены одни рабочие — пункт недоступен сразу,
	 * а не после шага помощника с пустым списком целей.
	 */
	const noPhantomSelected = selected.length > 0 && !selected.some((r) => isApplicable({
		status: asText(r.status), disabled: r.disabled === true, published: null,
		clusterStatus: r.clusterStatus ? asText(r.clusterStatus) : undefined,
		ibUnreachableAt: r.ibUnreachableAt ? asText(r.ibUnreachableAt) : null,
	}, "drop"));
	const qc = useQueryClient();
	const openWizard = useOpenGroupCommand();
	const keys = selected.map((r) => asText(r.baseKey)).filter(Boolean);

	/**
	 * «Проверить базы данных» (P2): есть ли у зарегистрированных баз их база данных в СУБД —
	 * фантомы, которые кластер перечисляет, а открыть нельзя. Без отметок — все базы, с
	 * отметками — отмеченные. На сотне баз ответ идёт до минуты: ход виден в «Прогрессе», а
	 * итог пишем сами — содержательнее безликого «Выполнено».
	 */
	const CHECK_DB = "checkBasesDb";

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
					// Чтения — всем, кому открыта панель.
					...(g === "operations"
						? [
							{ id: CHECK_DB, label: translate("onecBasesDbCheck"), icon: "search" as IconName, disabled: checkDb.isPending || dbChecking },
						]
						: []),
					// Опасные команды — последним разделом; только полному доступу.
					...(spec.dangerOps ?? []).filter(opAllowed).map((o) => ({
						id: o, label: translate(OP_LABEL[o]), icon: OP_ICON[o], group: translate("onecDangerousCommands"), danger: true,
						...(o === "dropRegistration" && noPhantomSelected ? { disabled: true, hint: translate("onecDropOnlyUnreachable") } : {}),
					})),
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
							// Отметки списка — заготовка: набор целей правят в самом помощнике.
							openWizard(id as GroupOp, keys, presetName);
						}}
					/>
				);
			})}
		</>
	);
};

export default BaseGroupCommands;
