/**
 * Групповые команды — ВЫБОР ОПЕРАЦИИ, а не сама операция.
 *
 * Раньше здесь же жило и окно ввода параметров, и отправка задания. Теперь кнопка только
 * называет операцию и открывает помощник (GroupCommandWizard), где по шагам спрашивают
 * над чем, что менять и что из этого выйдет. Причина простая: три разных вопроса в одном
 * модальном окне размером с записку перемешивались, а «что произойдёт» не показывалось
 * вовсе — человек узнавал итог из отчёта задания.
 *
 * Единственное исключение — «Проверить публикации»: это не операция над выбранными базами,
 * а одно чтение веб-сервера, и спрашивать для него «над чем» нечего.
 */
import { FC } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import type { IconName } from "src/components/IconButton/icons";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import type { TDataItem } from "src/components/Table/types";
import { asText } from "src/utils/asText";
import { refreshPublications } from "src/services/onec/api";
import { withOp } from "./progress";
import { noteNotice } from "src/components/TechMessages/store";
import { useOpenGroupCommand, type GroupOp } from "./GroupCommandWizard";
import { useOnecWrite } from "./shared";

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

	/** Подпись операции в списке группы — та же, что была на отдельной кнопке. */
	const OP_LABEL: Record<GroupOp, string> = {
		publish: "onecPublish", unpublish: "onecUnpublish",
		createUser: "onecUserCreate", deleteUser: "onecUserDelete",
		installExt: "onecExtInstall", deleteExt: "onecExtRemove",
		backup: "onecBackup", checkBase: "onecMaintCheck",
	};

	// Групповые команды — только изменения (публикация, пользователи, расширения,
	// выгрузка): правом «только просмотр» их не показываем вовсе (F5).
	if (!canWrite) return null;

	return (
		<>
			{groups.map((g) => {
				const spec = GROUPS[g];
				const options = [
					...spec.ops.map((o) => ({ id: o, label: translate(OP_LABEL[o]) })),
					...(g === "publication"
						? [{
							id: CHECK_PUBLICATIONS,
							label: translate("onecPublicationsCheck"),
							disabled: checkPublications.isPending,
						}]
						: []),
				];
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
