/**
 * Выбор ролей пользователя ИБ.
 *
 * ЗАЧЕМ ИМЕННО СПИСОК С ОТМЕТКАМИ. Роль в 1С адресуется точным идентификатором
 * («ПолныеПрава», «ЧтениеДанныхБухгалтерии»); набранное руками имя с опечаткой команда
 * молча не найдёт — пользователь останется без прав, и узнают об этом от него самого.
 * Поэтому роли выбирают из списка, а ручной ввод оставлен только для той, которой в списке
 * ещё нет (новая конфигурация, редкая роль).
 *
 * ОТКУДА СПИСОК. По умолчанию — роли, УЖЕ встречавшиеся в базах: их десяток, они покрывают
 * почти все назначения и берутся из кэша, без обращения к 1С. Полный справочник
 * конфигурации (сотни ролей) запрашивается у выбранной базы кнопкой — это команда агенту.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { showToast } from "src/components/UIToast";
import { fetchRoles } from "src/services/onec/api";
import styles from "./OneCAdmin.module.scss";

export const RolesPicker: FC<{
	value: string[];
	onChange: (roles: string[]) => void;
	/** База, у которой можно спросить полный справочник конфигурации. */
	baseKey?: string;
	disabled?: boolean;
}> = ({ value, onChange, baseKey, disabled }) => {
	const [needle, setNeedle] = useState("");
	const [custom, setCustom] = useState("");
	const [live, setLive] = useState(false);

	// Кэш ролей запрашивается всегда; полный справочник — только по кнопке: это команда
	// агенту и десятки секунд ожидания.
	const roles = useQuery({
		queryKey: ["onec", "roles", live ? baseKey : "", live],
		queryFn: () => fetchRoles(live ? baseKey : undefined, live),
		staleTime: 5 * 60_000,
	});

	const known = roles.data?.items ?? [];
	const shown = useMemo(() => {
		const n = needle.trim().toLowerCase();
		const all = [...new Set([...value, ...known.map((r) => r.name)])];
		return all.filter((r) => !n || r.toLowerCase().includes(n)).sort((a, b) => a.localeCompare(b, "ru"));
	}, [known, value, needle]);

	const toggle = (role: string) => {
		onChange(value.includes(role) ? value.filter((r) => r !== role) : [...value, role]);
	};

	const addCustom = () => {
		const r = custom.trim();
		if (!r) return;
		if (!value.includes(r)) onChange([...value, r]);
		setCustom("");
		showToast(`${translate("roles")}: ${r}`, "info");
	};

	return (
		<div className={styles.Roles}>
			<div className={styles.RolesHead}>
				<Field name="roles_search" value={needle} placeholder={translate("search")} width="220px" noAutofill
					disabled={disabled}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNeedle(e.target.value)} />
				<span className={styles.Hint}>{translate("onecRolesSelected")}: {value.length}</span>
				{baseKey && !live && (
					<Button disabled={disabled || roles.isFetching} onClick={() => setLive(true)}>
						{translate("onecRolesFromBase")}
					</Button>
				)}
				{value.length > 0 && (
					<Button disabled={disabled} onClick={() => onChange([])}>{translate("clearAll")}</Button>
				)}
			</div>

			<div className={styles.RolesList}>
				{shown.map((role) => (
					<label key={role} className={styles.RoleItem}>
						<input type="checkbox" checked={value.includes(role)} disabled={disabled}
							onChange={() => toggle(role)} />
						<span>{role}</span>
					</label>
				))}
				{!shown.length && <div className={styles.Hint}>{translate("onecRolesEmpty")}</div>}
			</div>

			<div className={styles.RolesHead}>
				{/* Ручной ввод — для роли, которой ещё нет в списке: идентификатор должен
				    совпадать с тем, что в конфигурации, посимвольно. */}
				<Field name="roles_custom" value={custom} placeholder={translate("onecRolesCustom")} width="260px" noAutofill
					disabled={disabled}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustom(e.target.value)} />
				<Button disabled={disabled || !custom.trim()} onClick={addCustom}>{translate("add")}</Button>
			</div>
		</div>
	);
};

export default RolesPicker;
