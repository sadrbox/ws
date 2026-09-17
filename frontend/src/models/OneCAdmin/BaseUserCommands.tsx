/**
 * Команды над пользователями ОДНОЙ базы: создать, изменить, удалить.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ ГРУППОВЫХ. Групповые команды живут в списке баз и работают по
 * отмеченным базам — это про раскатку одинакового на многие базы. Здесь противоположная
 * задача: открыли карточку базы, увидели её пользователей и правите ИХ. Уходить ради этого
 * в список баз, отмечать там одну строку и вводить имя руками — дольше и опаснее: имя
 * набирается заново, хотя нужный пользователь уже выбран в таблице.
 *
 * РОЛИ ЧИТАЮТСЯ ИЗ ЭТОЙ ЖЕ БАЗЫ. Набор ролей задаёт КОНФИГУРАЦИЯ: у «Бухгалтерии» и
 * «Зарплаты» он разный, и роль из чужой базы команда молча не найдёт — пользователь
 * останется без прав, а узнают об этом от него самого. Поэтому RolesPicker получает ключ
 * базы и умеет спросить у неё полный справочник.
 *
 * УДАЛЕНИЕ ПОДТВЕРЖДАЕТСЯ. Пользователя ИБ удаляют насовсем: ни корзины, ни отмены в 1С
 * нет. Модальное окно называет базу и имя — оба, потому что ошибиться можно и в том, и в
 * другом.
 */
import { FC, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { translate } from "src/i18";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { Icon } from "src/components/IconButton/icons";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { runBatch, type BatchType } from "src/services/onec/api";
import RolesPicker from "./RolesPicker";
import { attachBatch, finishOp, startOp, type OpKind } from "./progress";
import { useOpenBaseUser } from "./BaseUserForm";
import {
	useOnecPermissions,
} from "./shared";
import { sectionAllows } from "./onecPermissions";
import { buildUserCreate } from "./userUpdate";
import styles from "./OneCAdmin.module.scss";

export const BaseUserCommands: FC<{
	baseKey: string;
	/** Пользователь, выбранный в таблице: цель «Изменить» и «Удалить». */
	activeUser: string;
	/** Список прочитан — можно перечитать после команды. */
	onDone?: () => void;
}> = ({ baseKey, activeUser, onDone }) => {
	const perms = useOnecPermissions();
	const canCreateUser = sectionAllows(perms, "baseUsers", "create", 1);
	const canDeleteUser = sectionAllows(perms, "baseUsers", "delete", 1);
	const openCard = useOpenBaseUser();
	const [dialog, setDialog] = useState<null | "create" | "delete">(null);
	const [name, setName] = useState("");
	const [fullName, setFullName] = useState("");
	const [password, setPassword] = useState("");
	const [showInList, setShowInList] = useState(true);
	const [roles, setRoles] = useState<string[]>([]);

	const close = () => {
		setDialog(null); setName(""); setFullName(""); setPassword(""); setRoles([]); setShowInList(true);
	};

	/** Команда по одной базе — с записью в реестр операций, как и всё остальное. */
	const send = async (type: BatchType, kind: OpKind, title: string, user: string, payload: Record<string, unknown>) => {
		const op = startOp({ kind, title, target: `${user} — ${baseKey}`, total: 1, scope: { user, bases: [baseKey] } });
		try {
			const r = await runBatch(type, [baseKey], payload);
			attachBatch(op, r.batchId, r.total, r.skipped.length ? `${translate("onecSkipped")}: ${r.skipped.length}` : "");
			return r;
		} catch (e) {
			finishOp(op, { failed: 1, note: e instanceof Error ? e.message : String(e), error: e });
			throw e;
		}
	};

	const done = () => {
		showToast(translate("onecBatchQueued"), "success");
		// Кэш реестра не сбрасываем сразу после постановки — в нём ещё прежнее: перечитает
		// окончание задания (attachBatch → refreshAfterWork, R7-П1).
		onDone?.();
		close();
	};

	const create = useMutation({
		mutationFn: () => send("IB_CREATE_USER", "create", translate("onecUserCreate"), name.trim(),
			buildUserCreate({ name, fullName, password, roles, showInList })),
		onSuccess: done,
		onError: (e) => reportError(e, { source: translate("onecUser") }),
	});

	const remove = useMutation({
		mutationFn: () => send("IB_DELETE_USER", "delete", translate("onecUserDelete"), activeUser, { name: activeUser }),
		onSuccess: done,
		onError: (e) => reportError(e, { source: translate("onecUser") }),
	});

	const busy = create.isPending || remove.isPending;

	return (
		<>
			{/* Создание и удаление пользователя ИБ — разрушающее (F5). «Изменить» открывает
			    карточку: смотреть права правом «просмотр» можно, записывать — нет. */}
			{canCreateUser && (
				<Button variant="secondary" disabled={!baseKey || busy}
					title={baseKey ? translate("onecUserCreate") : translate("onecPickBaseFirst")}
					onClick={() => setDialog("create")}>
					<Icon name="plus" /> {translate("onecUserCreate")}
				</Button>
			)}
			<Button variant="secondary" disabled={!activeUser || busy}
				title={activeUser ? `${translate("onecOpenCard")}: ${activeUser}` : translate("onecPickUserFirst")}
				onClick={() => openCard(activeUser, baseKey)}>
				<Icon name="open" /> {translate("onecUserEdit")}
			</Button>
			{canDeleteUser && (
				<Button variant="secondary" disabled={!activeUser || busy}
					title={activeUser ? `${translate("onecUserDelete")}: ${activeUser}` : translate("onecPickUserFirst")}
					onClick={() => setDialog("delete")}>
					<Icon name="trash" /> {translate("onecUserDelete")}
				</Button>
			)}

			{dialog === "create" && (
				<Modal title={`${translate("onecUserCreate")}: ${baseKey}`} onClose={close}
					onApply={() => { if (name.trim()) create.mutate(); }}>
					<div className={styles.ModalForm}>
						<Field name="buc_name" label={translate("onecUserName")} value={name} noAutofill
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
						<Field name="buc_full" label={translate("onecUserFullName")} value={fullName} noAutofill
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)} />
						<Field name="buc_pwd" label={translate("onecUserPassword")} type="password" value={password}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
						<FieldToggle name="buc_show" label={translate("onecShowInList")} value={showInList} onChange={setShowInList} />
						{/* Роли — из ЭТОЙ базы: набор задаёт её конфигурация. */}
						<RolesPicker value={roles} onChange={setRoles} baseKey={baseKey} disabled={busy} />
						<Notice inline items={[{
							type: roles.length ? "info" : "warning",
							text: roles.length ? translate("onecUserCreateHere") : translate("onecUserNoRolesWarning"),
						}]} />
					</div>
				</Modal>
			)}

			{dialog === "delete" && (
				<Modal title={translate("onecUserDelete")} onClose={close} onApply={() => remove.mutate()}>
					<div className={styles.ConfirmText}>
						<div>{translate("onecUserDeleteQuestion")}</div>
						<div className={styles.ConfirmDetails}>
							{translate("onecBase")}: {baseKey}<br />
							{translate("onecUserName")}: {activeUser}
						</div>
						<Notice inline items={[{ type: "attention", text: translate("onecUserDeleteHere") }]} />
					</div>
				</Modal>
			)}
		</>
	);
};

export default BaseUserCommands;
