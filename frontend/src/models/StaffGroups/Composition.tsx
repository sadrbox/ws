/**
 * Состав группы сотрудников: участники и клиенты с ответственными.
 *
 * Добавление — полем выбора: выбрали — строка появилась, поле очистилось для следующего
 * (поле пересоздаётся по ключу: своё введённое значение LookupField держит сам). Пустых строк
 * не бывает, и проверять «клиент не выбран» не приходится.
 */
import { type FC, useState } from "react";
import { translate } from "src/i18";
import LookupField from "src/components/Field/LookupField";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import IconButton from "src/components/IconButton/IconButton";
import { userDisplayName } from "src/models/_quality/people";
import {
	addClient, addMember, removeClient, removeMember, setResponsible, type ClientRow, type MemberRow,
} from "./staffGroups";
import main from "src/styles/main.module.scss";
import styles from "./StaffGroups.module.scss";

interface MembersProps {
	formUid: string;
	members: MemberRow[];
	disabled: boolean;
	onChange: (next: MemberRow[]) => void;
}

export const MembersEditor: FC<MembersProps> = ({ formUid, members, disabled, onChange }) => {
	const [adderKey, setAdderKey] = useState(0);
	return (
		<div className={styles.Editor}>
			{members.length ? (
				<ul className={styles.Rows}>
					{members.map((m) => (
						<li key={m.userUuid} className={styles.Row}>
							<span className={styles.RowName}>{m.userName}</span>
							{!disabled && (
								<IconButton icon="close" size="sm" title={translate("staffGroupRemove")} aria-label={translate("staffGroupRemove")}
									onClick={() => onChange(removeMember(members, m.userUuid))} />
							)}
						</li>
					))}
				</ul>
			) : (
				<div className={main.SettingHint}>{translate("staffGroupNoMembers")}</div>
			)}
			{!disabled && (
				<LookupField key={adderKey} name={`${formUid}_addMember`} endpoint="users" displayField="username"
					secondaryFields={["employee.fullName"]} label={translate("staffGroupAddMember")} value="" displayValue=""
					allowCreate={false} minWidth={FIELD_WIDTH.lg}
					onSelect={(uuid, display, item) => {
						if (!uuid) return;
						onChange(addMember(members, { userUuid: uuid, userName: userDisplayName(item, display) }));
						setAdderKey((k) => k + 1);
					}} />
			)}
		</div>
	);
};

interface ClientsProps {
	formUid: string;
	clients: ClientRow[];
	disabled: boolean;
	onChange: (next: ClientRow[]) => void;
}

export const ClientsEditor: FC<ClientsProps> = ({ formUid, clients, disabled, onChange }) => {
	const [adderKey, setAdderKey] = useState(0);
	return (
		<div className={styles.Editor}>
			{clients.length ? (
				<ul className={styles.Rows}>
					{clients.map((c) => (
						<li key={c.clientOrganizationUuid} className={styles.ClientRow}>
							<span className={styles.RowName}>{c.clientName}</span>
							<LookupField name={`${formUid}_responsible_${c.clientOrganizationUuid}`} endpoint="users" displayField="username"
								secondaryFields={["employee.fullName"]} label={translate("staffGroupResponsible")}
								value={c.responsibleUuid} displayValue={c.responsibleName} disabled={disabled} allowCreate={false}
								minWidth={FIELD_WIDTH.md}
								onSelect={(uuid, display, item) => onChange(setResponsible(clients, c.clientOrganizationUuid, uuid, uuid ? userDisplayName(item, display) : ""))} />
							{!disabled && (
								<IconButton icon="close" size="sm" title={translate("staffGroupRemove")} aria-label={translate("staffGroupRemove")}
									onClick={() => onChange(removeClient(clients, c.clientOrganizationUuid))} />
							)}
						</li>
					))}
				</ul>
			) : (
				<div className={main.SettingHint}>{translate("staffGroupNoClients")}</div>
			)}
			{!disabled && (
				<LookupField key={adderKey} name={`${formUid}_addClient`} endpoint="organizations" label={translate("staffGroupAddClient")}
					value="" displayValue="" allowCreate={false} minWidth={FIELD_WIDTH.lg}
					onSelect={(uuid, display) => {
						if (!uuid) return;
						onChange(addClient(clients, { clientOrganizationUuid: uuid, clientName: display || uuid }));
						setAdderKey((k) => k + 1);
					}} />
			)}
		</div>
	);
};
