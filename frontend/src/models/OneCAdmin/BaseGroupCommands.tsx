/**
 * Групповые команды — ВЫБОР ОПЕРАЦИИ, а не сама операция.
 *
 * Раньше здесь же жило и окно ввода параметров, и отправка задания. Теперь кнопка только
 * называет операцию и открывает помощник (GroupCommandWizard), где по шагам спрашивают
 * над чем, что менять и что из этого выйдет. Причина простая: три разных вопроса в одном
 * модальном окне размером с записку перемешивались, а «что произойдёт» не показывалось
 * вовсе — человек узнавал итог из отчёта задания.
 *
 * Исключения — чтения, которым помощник не нужен: «Проверить публикации» (одно чтение
 * веб-сервера на все базы) и «Проверить базы данных» (отмеченные базы или все). Они доступны
 * и уровню «только просмотр» — чтение ничего не меняет (F5).
 */
import { useRunningCommand } from "src/components/TechMessages/operations";
import { FC } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import type { IconName } from "src/components/IconButton/icons";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import type { TDataItem } from "src/components/Table/types";
import { asText } from "src/utils/asText";
import { checkBasesDb, refreshPublications } from "src/services/onec/api";
import { withOp } from "./progress";
import { noteNotice, notify } from "src/components/TechMessages/store";
import { checkDbOutcome } from "./checkBasesDb";
import { GROUP_OPS, useOpenGroupCommand, type GroupOp } from "./GroupCommandWizard";
import {
	useOnecWrite, useOnecPermissions,
} from "./shared";
import { SECTION_OF_TYPE, sectionAllows } from "./onecPermissions";

export type CommandGroup = "publication" | "maintenance" | "users" | "extensions";

const GROUPS: Record<CommandGroup, { label: string; icon: IconName; ops: GroupOp[] }> = {
	publication: { label: "onecPublication", icon: "open", ops: ["publish", "unpublish"] },
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
}> = ({ selected, groups = ["publication", "maintenance"], presetName }) => {
	const canWrite = useOnecWrite();
	const perms = useOnecPermissions();
	const pubChecking = useRunningCommand(["CLUSTER_LIST_PUBLICATIONS"]);
	const dbChecking = useRunningCommand(["CLUSTER_CHECK_BASES"]);
	/** Пользователи и расширения — по вложенным разрешениям, прочие операции — по общему праву. */
	const opAllowed = (o: GroupOp) => {
		const need = SECTION_OF_TYPE[GROUP_OPS[o].type];
		return need ? sectionAllows(perms, need.section, need.action, 1) : canWrite;
	};
	const qc = useQueryClient();
	const openWizard = useOpenGroupCommand();
	const keys = selected.map((r) => asText(r.baseKey)).filter(Boolean);

	/**
	 * «Проверить публикации» стоит В ГРУППЕ «Публикация», но отметок строк ей не нужно:
	 * это одно чтение веб-сервера, одно на все базы. Поэтому единственный пункт группы,
	 * доступный без выбора, — и единственный, который не открывает помощник.
	 */
	const CHECK_PUBLICATIONS = "checkPublications";

	const checkPublications = useMutation({
		mutationFn: () => withOp(
			{ kind: "read", title: translate("onecPublicationsCheck"), target: translate("onecTabBases") },
			refreshPublications,
		),
		onSuccess: (d) => {
			// Список баз приходит и в старой форме ответа — его показываем в любом случае.
			if (Array.isArray(d.items)) qc.setQueryData(["onec", "bases"], { items: d.items });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });

			/*
			 * ГОВОРИМ ТО, ЧТО ПРОИЗОШЛО НА САМОМ ДЕЛЕ. Раньше здесь было «Проверено
			 * публикаций: 110» — по длине списка. На деле опубликованной не нашлось ни
			 * одной, срез был отвергнут как недостоверный, и состояние баз не изменилось.
			 *
			 * РАЗБОРА МОЖЕТ НЕ БЫТЬ: панель и сервис обновляются по отдельности, и пока
			 * сервис старый, он отвечает в прежней форме. Это не ошибка, а известное
			 * состояние — «не знаем, что нашлось», и сказать надо именно это, а не уронить
			 * обработчик обращением к несуществующему полю.
			 */
			const r = d.report;
			if (!r) {
				noteNotice(translate("onecPublication"),
					{ type: "warning", text: translate("onecPublicationsNoReport") });
				showToast(translate("onecPublicationsNoReport"), "warning");
				return;
			}
			if (r.accepted) {
				showToast(`${translate("onecPublicationsChecked")}: ${r.published} / ${r.total}`, "success");
				return;
			}
			const where = r.lookedIn
				? ` ${translate("onecPublicationsLookedIn")}: ${r.lookedIn}${r.source ? ` (${r.source})` : ""}.`
				: "";
			noteNotice(translate("onecPublication"), {
				type: "warning",
				text: `${translate("onecPublicationsNoneFound")} ${translate("onecPublicationsNotApplied")}${where}`,
			});
			showToast(translate("onecPublicationsNoneFound"), "warning");
		},
		onError: (e) => reportError(e, { source: translate("onecTabBases") }),
	});

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
					...spec.ops.filter(opAllowed).map((o) => ({ id: o, label: translate(OP_LABEL[o]), icon: OP_ICON[o] })),
					// Чтения — всем, кому открыта панель.
					...(g === "publication"
						? [
							{ id: CHECK_PUBLICATIONS, label: translate("onecPublicationsCheck"), icon: "search" as IconName, disabled: checkPublications.isPending || pubChecking },
							{ id: CHECK_DB, label: translate("onecBasesDbCheck"), icon: "search" as IconName, disabled: checkDb.isPending || dbChecking },
						]
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
							if (id === CHECK_PUBLICATIONS) { checkPublications.mutate(); return; }
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
