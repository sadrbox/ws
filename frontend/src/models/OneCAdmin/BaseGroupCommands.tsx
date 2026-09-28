/**
 * Групповые команды — ВЫБОР ОПЕРАЦИИ, а не сама операция.
 *
 * Раньше здесь же жило и окно ввода параметров, и отправка задания. Теперь кнопка только
 * называет операцию и открывает помощник (GroupCommandWizard), где по шагам спрашивают
 * над чем, что менять и что из этого выйдет. Причина простая: три разных вопроса в одном
 * модальном окне размером с записку перемешивались, а «что произойдёт» не показывалось
 * вовсе — человек узнавал итог из отчёта задания.
 *
 * Исключение — чтение, которому помощник не нужен: «Проверить наличие в СУБД» (отмеченные базы или все) — в меню
 * «Операции». Публикации проверяет сама кнопка «Обновить» списка баз (17.09): отдельный пункт стал не нужен. Они доступны
 * и уровню «только просмотр» — чтение ничего не меняет (F5).
 *
 * ПОДСКАЗКА У КАЖДОГО ПУНКТА (28.09). Наведение на пункт говорит, что именно сделает команда и где она действует
 * (в 1С, на веб-сервере или только в панели); недоступный пункт вместо этого называет причину — для одной базы
 * конкретную («уже опубликована», «нет в кластере»), для отметок в списке — общую.
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
import { checkBasesDb, removeBaseFromRegistry, setBaseHidden, setSessionsLock } from "src/services/onec/api";
import { finishOp, startOp, withOp } from "./progress";
import { lockOutcome } from "./sessionsLock";
import { notify } from "src/components/TechMessages/store";
import { checkDbOutcome } from "./checkBasesDb";
import { GROUP_OPS, useOpenGroupCommand, type GroupOp } from "./GroupCommandWizard";
import {
	changesNothing, isApplicable, reportBatchStart, splitTargets, unreachableReason, useOnecWrite, useOnecPermissions,
} from "./shared";
import { runGroupCommand } from "./runGroupCommand";
import { useAppActions } from "src/app/context";
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
	// Вход в базу (блокировка начала сеансов): «закрыт» — только если блокировка стоит и действует сейчас.
	sessionsClosed: r.sessionsDenied === true && r.sessionsDeniedActive !== false,
	sessionsOpen: r.sessionsDenied === false,
});

/** Пункт меню: подсказка — у каждого (что сделает команда или почему недоступна). */
type MenuOption = {
	id: string; label: string; icon: IconName; hint?: string;
	group?: string; danger?: boolean; disabled?: boolean;
};

/** Причина для подсказки — строчной буквой после «Недоступно: …». */
const lcFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

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
		 * один — что сделать с отмеченными базами. Между заданиями и обслуживанием — «Блокировка сеансов» (28.09):
		 * её пункты не задания сервиса, и порядок разделов задаёт сборка меню ниже.
		 */
		sections: [
			{ label: "onecPublication", ops: ["publish", "unpublish"] },
			{ label: "onecScheduledJobs", ops: ["denyJobs", "allowJobs"] },
			{ label: "onecTabMaintenance", ops: ["checkBase", "backup"] },
		],
	},
	users: { label: "onecTabUsersList", icon: "plus", ops: ["createUser", "deleteUser"] },
	extensions: { label: "onecTabExtensions", icon: "download", ops: ["installExt", "deleteExt"] },
};

export const BaseGroupCommands: FC<{
	selected: TDataItem[];
	/** Какие группы показывать. По умолчанию — те, чей предмет сама база. */
	groups?: CommandGroup[];
	/** Имя объекта, подставляемое в помощник: экран расширений знает его заранее. */
	presetName?: string;
	/** Записи панели удалены — карточке удалённой базы больше нечего показывать. */
	onRecordsRemoved?: (keys: string[]) => void;
	/** Меню карточки одной базы: подпись кнопки называет базу, а не «отмечено баз: 1». */
	card?: boolean;
}> = ({ selected, groups = ["operations"], presetName, onRecordsRemoved, card }) => {
	const canWrite = useOnecWrite();
	const perms = useOnecPermissions();
	const dbChecking = useRunningCommand(["CLUSTER_CHECK_BASES"]);
	const lockRunning = useRunningCommand(["CLUSTER_SET_SESSIONS_LOCK"]);
	/**
	 * Пользователи и расширения — по вложенным разрешениям, прочие операции — по общему праву. «Обновить сведения»
	 * — чтение: доступно и просмотру (сервис такое задание разрушающим не считает).
	 */
	const opAllowed = (o: GroupOp) => {
		if (GROUP_OPS[o].type === "IB_INFO") return true;
		const need = SECTION_OF_TYPE[GROUP_OPS[o].type];
		return need ? sectionAllows(perms, need.section, need.action, 1) : canWrite;
	};
	const qc = useQueryClient();
	const { confirm } = useAppActions().actions;
	const openWizard = useOpenGroupCommand();
	const keys = selected.map((r) => asText(r.baseKey)).filter(Boolean);

	/**
	 * «Проверить наличие в СУБД» (P2, до 28.09 — «Проверить базы данных»): есть ли у зарегистрированных баз их база данных —
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
	/**
	 * «Скрыть базу в панели» и «Показать базу в панели» — тоже отметка ПАНЕЛИ, а не команда 1С (28.09). Раньше они
	 * жили только в группе «Доступность базы» карточки; теперь — здесь, со всеми командами над базой, и работают по
	 * отмеченным базам и в списке.
	 */
	const HIDE = "hideBase";
	const UNHIDE = "unhideBase";
	/**
	 * «Закрыть вход в базу» и «Открыть вход в базу» — блокировка начала сеансов (28.09). Раньше кнопка жила в строке
	 * «Блокировка сеансов» карточки; теперь — в «Операциях», как и остальные команды над базой. Пакетом сервис её
	 * не ставит (команда кластера по одной базе), поэтому по отмеченным базам идём по одной.
	 */
	const LOCK = "lockSessions";
	const UNLOCK = "unlockSessions";

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
				const removed: string[] = [];
				const failed: string[] = [];
				for (const key of targets) {
					try {
						const r = await removeBaseFromRegistry(key);
						if (r.removed) removed.push(key); else failed.push(key);
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
				text: `${translate("onecBaseRemovedFromList")}: ${removed.length}`
					+ (failed.length ? ` · ${translate("onecBatchNotQueued")}: ${failed.length} (${failed[0]})` : ""),
			});
			if (removed.length) onRecordsRemoved?.(removed);
		},
		onError: (e) => reportError(e, { source: translate("onecBaseRemoveFromList") }),
	});

	/** Скрыть или вернуть в работу — по одной базе, как и удаление записи: отказ по одной не отменяет остальные. */
	const setHidden = useMutation({
		mutationFn: ({ targets, hidden }: { targets: string[]; hidden: boolean }) => withOp(
			{
				kind: "update", title: translate(hidden ? "onecBaseHide" : "onecBaseUnhide"),
				target: targets.length === 1 ? targets[0] : `${translate("onecBases")}: ${targets.length}`, total: targets.length,
			},
			async () => {
				let done = 0;
				const failed: string[] = [];
				for (const key of targets) {
					try { await setBaseHidden(key, hidden); done += 1; } catch { failed.push(key); }
				}
				return { done, failed };
			},
		),
		onSuccess: ({ done, failed }, { hidden }) => {
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
			notify({
				severity: failed.length ? "warning" : "success", source: translate(hidden ? "onecBaseHide" : "onecBaseUnhide"),
				text: `${translate("saved")}: ${done}`
					+ (failed.length ? ` · ${translate("onecBatchNotQueued")}: ${failed.length} (${failed[0]})` : ""),
			});
		},
		onError: (e, { hidden }) => reportError(e, { source: translate(hidden ? "onecBaseHide" : "onecBaseUnhide") }),
	});

	/*
	 * Итог — по факту, а не по нажатию (И26): «Вход в базу закрыт» только если кластер это подтвердил. Разбор ответа
	 * общий с вкладкой «Сеансы» (lockOutcome); отказ по одной базе не отменяет остальные.
	 */
	const setLock = useMutation({
		mutationFn: async ({ targets, enabled }: { targets: string[]; enabled: boolean }) => {
			const op = startOp({
				kind: "update", title: translate(enabled ? "onecSessionsLockClose" : "onecSessionsLockOpen"),
				target: targets.length === 1 ? targets[0] : `${translate("onecBases")}: ${targets.length}`,
				total: targets.length, scope: { bases: targets },
			});
			const warnings: string[] = [];
			const failed: string[] = [];
			let firstError: unknown = null;
			for (const key of targets) {
				try {
					const out = lockOutcome(await setSessionsLock(key, enabled), enabled);
					if (out.tone === "warning") warnings.push(targets.length > 1 ? `${key}: ${out.text}` : out.text);
				} catch (e) { failed.push(key); firstError ??= e; }
			}
			if (failed.length === targets.length) {
				finishOp(op, { failed: failed.length, note: firstError instanceof Error ? firstError.message : String(firstError), error: firstError });
				throw firstError;
			}
			finishOp(op, {
				...(failed.length ? { failed: failed.length } : {}),
				...(warnings.length ? { warning: warnings.join(". ") } : {}),
			});
			return { done: targets.length - failed.length, failed, warnings };
		},
		onSuccess: ({ done, failed, warnings }, { enabled }) => {
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
			const ok = translate(enabled ? "onecLockEnabled" : "onecLockDisabled");
			notify({
				severity: failed.length || warnings.length ? "warning" : "success", source: translate("onecSessionsLockState"),
				text: [
					done > 1 || failed.length ? `${ok}: ${done}` : (warnings[0] ?? ok),
					...(done > 1 || failed.length ? warnings : []),
					failed.length ? `${translate("onecBatchNotQueued")}: ${failed.length} (${failed[0]})` : "",
				].filter(Boolean).join(" · "),
			});
		},
		onError: (e) => reportError(e, { source: translate("onecSessionsLockState") }),
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
	/*
	 * Скрывают и возвращают только базу, которая есть в кластере: у базы без регистрации одна команда — удалить её
	 * запись (С45). Скрыть можно рабочую, вернуть — скрытую.
	 */
	const inCluster = chosenBases.filter((b) => (b.clusterStatus ?? b.status) !== "MISSING");
	const visibilityTargets: Record<string, string[]> = {
		[HIDE]: inCluster.filter((b) => !b.disabled).map((b) => b.key),
		[UNHIDE]: inCluster.filter((b) => b.disabled).map((b) => b.key),
	};
	/*
	 * Вход закрывают и открывают у базы, с которой кластер работает (как регламентные задания): не скрытой и не
	 * пропавшей. «Уже закрыт» — не цель закрытия, «уже открыт» — не цель открытия; незнание (не читали) — цель обеих.
	 */
	const lockable = chosenBases.filter((b) => isApplicable(b, "cluster"));
	const lockTargets: Record<string, string[]> = {
		[LOCK]: lockable.filter((b) => !b.sessionsClosed).map((b) => b.key),
		[UNLOCK]: lockable.filter((b) => !b.sessionsOpen).map((b) => b.key),
	};

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

	const startSetHidden = async (hidden: boolean) => {
		const targets = visibilityTargets[hidden ? HIDE : UNHIDE];
		if (!targets.length) return;
		// Скрытие уводит базу из списка и групповых команд — спрашиваем; возврат в работу ничего не отнимает.
		if (hidden) {
			const lines = [translate("onecBaseHideHint"), `${translate("onecBatchTargets")}: ${targets.length}`];
			if (!(await confirm(lines.join("\n\n")))) return;
		}
		setHidden.mutate({ targets, hidden });
	};

	const startSetLock = async (enabled: boolean) => {
		const targets = lockTargets[enabled ? LOCK : UNLOCK];
		if (!targets.length) return;
		// Закрытый вход останавливает работу людей в базе, открытый — пускает их посреди работ: спрашиваем оба раза.
		const lines = [translate(enabled ? "onecSessionsLockConfirm" : "onecSessionsUnlockConfirm")];
		if (targets.length > 1) lines.push(`${translate("onecBatchTargets")}: ${targets.length}`);
		if (!(await confirm(lines.join("\n\n")))) return;
		setLock.mutate({ targets, enabled });
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
		// В меню проверка идёт БЕЗ исправления (у задания нет `repair`): «Тестирование и исправление» обещало бы лишнее.
		backup: "onecBackup", checkBase: "onecMaintCheckTestOnly",
	};

	/** Что сделает команда «Операций» — подсказка при наведении на пункт (28.09). */
	const OP_HINT: Partial<Record<GroupOp, string>> = {
		publish: "onecOpHintPublish", unpublish: "onecOpHintUnpublish",
		info: "onecOpHintInfo", denyJobs: "onecOpHintDenyJobs", allowJobs: "onecOpHintAllowJobs",
		dropRegistration: "onecBaseDropRegistrationHint",
		backup: "onecOpHintBackup", checkBase: "onecOpHintCheck",
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

	/*
	 * НЕДОСТУПНЫЙ ПУНКТ ГОВОРИТ ПОЧЕМУ. Одна база (карточка или одна отметка) — её собственная причина; несколько —
	 * общая: «у всех уже так» или «отметьте подходящие». Без отметок в списке команды заданий идут через помощник
	 * и доступны; команды панели и входа без отметок недоступны — выбирать базы им негде.
	 */
	const off = (o: MenuOption, reason: string): MenuOption => ({ ...o, disabled: true, hint: reason });
	const notFor = (reason: string) => `${translate("onecOpNotForBase")}: ${lcFirst(reason)}`;
	const single = chosenBases.length === 1 ? chosenBases[0] : null;

	/*
	 * ПУНКТ — ПО СОСТОЯНИЮ ОТМЕЧЕННЫХ БАЗ. «Запретить регламентные задания» нужен, если хоть у одной отмеченной они
	 * не запрещены; «Разрешить» — если хоть у одной запрещены; отмечены базы в обоих состояниях — доступны оба. Без
	 * отметок доступно всё: базы выбирают в помощнике. Правило то же, по которому помощник отсеивает базы
	 * (splitTargets → fitReason), — меню и помощник не спорят. В «Операциях» (28.09) пункт гаснет и тогда, когда ни
	 * одной отмеченной базе команда неприменима: иначе он обещал бы задание, которое не поставится. Меню
	 * «Пользователи» и «Расширения» ведут в помощник, где пригодность видна по строкам, — там правило прежнее.
	 */
	const opOption = (o: GroupOp, group?: string, strict = true): MenuOption => {
		const spec = GROUP_OPS[o];
		const hint = OP_HINT[o];
		const item: MenuOption = {
			id: o, label: translate(OP_LABEL[o]), icon: OP_ICON[o], ...(hint ? { hint: translate(hint) } : {}), ...(group ? { group } : {}),
		};
		if (!strict) return changesNothing(selected, spec.target) ? off(item, translate("onecOpNothingToChange")) : item;
		if (!keys.length) return item;
		const { targets, skipped } = splitTargets(chosenBases, spec.needs, spec.target);
		if (targets.length) return item;
		if (single && skipped[0]) return off(item, notFor(skipped[0].reason));
		return off(item, translate(changesNothing(selected, spec.target) ? "onecOpNothingToChange" : "onecOpPickApplicable"));
	};

	/** Команда панели или входа: цели посчитаны заранее, причина для одной базы — своя. */
	const targetedOption = (item: MenuOption, targets: string[], reasonForSingle: () => string, pending: boolean): MenuOption => {
		if (!keys.length) return off(item, translate("onecOpPickApplicable"));
		if (!targets.length) return off(item, single ? notFor(reasonForSingle()) : translate("onecOpPickApplicable"));
		return pending ? { ...item, disabled: true } : item;
	};

	/** Меню «Операции»: разделы — в порядке работы с базой, опасное — последним. */
	const operationsOptions = (): MenuOption[] => {
		const sections = GROUPS.operations.sections ?? [];
		const section = (label: string) => sections.find((x) => x.label === label);
		const sectionOptions = (label: string) => (section(label)?.ops ?? []).filter(opAllowed).map((o) => opOption(o, translate(label)));
		const list: MenuOption[] = [
			// Без раздела — сведения о самой базе: оба пункта только читают.
			...GROUPS.operations.ops.filter(opAllowed).map((o) => opOption(o)),
			{
				id: CHECK_DB, label: translate("onecBasesDbCheck"), icon: "search", hint: translate("onecOpHintDbCheck"),
				...(checkDb.isPending || dbChecking ? { disabled: true } : {}),
			},
			...sectionOptions("onecPublication"),
			...sectionOptions("onecScheduledJobs"),
		];
		if (canWrite) {
			const lockGroup = translate("onecSessionsLockState");
			const lockReason = (enabled: boolean) => () => {
				if (!single) return "";
				if (!isApplicable(single, "cluster")) return unreachableReason(single);
				return translate(enabled ? "onecLockAlreadyClosed" : "onecLockAlreadyOpen");
			};
			const lockPending = setLock.isPending || lockRunning;
			list.push(
				targetedOption({ id: LOCK, label: translate("onecSessionsLockClose"), icon: "lock", hint: translate("onecOpHintLockClose"), group: lockGroup },
					lockTargets[LOCK], lockReason(true), lockPending),
				targetedOption({ id: UNLOCK, label: translate("onecSessionsLockOpen"), icon: "unlock", hint: translate("onecOpHintLockOpen"), group: lockGroup },
					lockTargets[UNLOCK], lockReason(false), lockPending),
			);
		}
		list.push(...sectionOptions("onecTabMaintenance"));
		if (canWrite) {
			// Видимость в панели — своим разделом перед опасными: решение обратимо, в 1С ничего не меняет.
			const visGroup = translate("onecBaseVisibility");
			const missing = () => (single ? (single.clusterStatus ?? single.status) === "MISSING" : false);
			list.push(
				targetedOption({ id: HIDE, label: translate("onecBaseHide"), icon: "clear", hint: translate("onecBaseHideHint"), group: visGroup },
					visibilityTargets[HIDE], () => translate(missing() ? "onecOpReasonMissing" : "onecBaseAlreadyHidden"), setHidden.isPending),
				targetedOption({ id: UNHIDE, label: translate("onecBaseUnhide"), icon: "restore", hint: translate("onecBaseUnhideHint"), group: visGroup },
					visibilityTargets[UNHIDE], () => translate(missing() ? "onecOpReasonMissing" : "onecBaseNotHidden"), setHidden.isPending),
			);
			/*
			 * Опасные команды — последним разделом; только полному доступу и только когда среди ОТМЕЧЕННЫХ есть
			 * базы, к которым команда применима (18.09): снятие регистрации — пока она есть, удаление записи
			 * панели — наоборот, когда базы в кластере уже нет. Подсказка прямо в меню: по одной подписи разницу
			 * между кластером и панелью не видно, а цена ошибки разная.
			 */
			const dangerGroup = translate("onecDangerousCommands");
			list.push(
				targetedOption({
					id: "dropRegistration", label: translate(OP_LABEL.dropRegistration), icon: OP_ICON.dropRegistration,
					hint: translate("onecBaseDropRegistrationHint"), group: dangerGroup, danger: true,
				}, dangerTargets.dropRegistration.map((b) => b.key), () => translate("onecOpReasonNoRegistration"), run.isPending),
				targetedOption({
					id: REMOVE_RECORD, label: translate("onecBaseRemoveFromList"), icon: "trash",
					hint: translate("onecBaseRemoveFromListHint"), group: dangerGroup, danger: true,
				}, dangerTargets[REMOVE_RECORD].map((b) => b.key), () => translate("onecOpReasonInCluster"), removeRecords.isPending),
			);
		}
		return list;
	};

	return (
		<>
			{groups.map((g) => {
				const spec = GROUPS[g];
				// Изменения (публикация, пользователи, расширения, выгрузка) — только полному доступу: правом «только
				// просмотр» их не показываем вовсе (F5). Чтения — всем, кому открыта панель.
				const options = g === "operations"
					? operationsOptions()
					: spec.ops.filter(opAllowed).map((o) => opOption(o, undefined, false));
				if (!options.length) return null;
				return (
					<ActionsDropdownButton
						key={g}
						label={translate(spec.label)}
						icon={spec.icon}
						options={options}
						title={card && keys.length === 1
							? translate("onecOpsForBase").replace("{base}", keys[0])
							: keys.length
								? `${translate("onecBatchTargets")}: ${keys.length}`
								: translate("onecWizPickInside")}
						onSelect={(id) => {
							if (id === CHECK_DB) { checkDb.mutate(); return; }
							if (id === REMOVE_RECORD) { void startRemoveRecords(); return; }
							if (id === HIDE || id === UNHIDE) { void startSetHidden(id === HIDE); return; }
							if (id === LOCK || id === UNLOCK) { void startSetLock(id === LOCK); return; }
							void start(id as GroupOp);
						}}
					/>
				);
			})}
		</>
	);
};

export default BaseGroupCommands;
