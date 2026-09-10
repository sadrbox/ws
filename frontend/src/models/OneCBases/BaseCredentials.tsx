/**
 * Вкладка «Доступ к базе» карточки базы 1С.
 *
 * ЗАЧЕМ ОНА ЕСТЬ. Агент на сервере знает ОДНОГО администратора баз (у нас — support). К
 * части клиентских баз он не подходит: их заводили до нас, и такого пользователя там нет
 * или у него другой пароль. Выглядело это как отказ «администратор не аутентифицирован», а
 * лечилось правкой настроек агента на сервере — то есть ради одной базы трогали все.
 *
 * ПОРЯДОК ВХОДА НЕ МЕНЯЕТСЯ. Агент по-прежнему сначала пробует своего администратора, и
 * только если тот не прошёл — берёт эту запись. Поэтому заполнять её нужно лишь там, где
 * общий администратор не работает, а не «на всякий случай».
 *
 * ПАРОЛЬ НАЗАД НЕ ЧИТАЕТСЯ. Сервис отдаёт только признак «задан»: показывать пароль в
 * панели незачем, и в истории браузера ему не место. Пустое поле пароля при записи значит
 * «не менять» — иначе правка опечатки в имени однажды стёрла бы рабочий пароль.
 */
import { FC, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { Icon } from "src/components/IconButton/icons";
import { getFormatDate } from "src/utils/datetime";
import { QueryError } from "src/models/OneCAdmin/shared";
import { clearBaseCredentials, fetchBaseCredentials, saveBaseCredentials } from "src/services/onec/api";

export const BaseCredentialsTab: FC<{ baseKey: string }> = ({ baseKey }) => {
	const qc = useQueryClient();
	const key = ["onec", "base-credentials", baseKey];
	const creds = useQuery({ queryKey: key, queryFn: () => fetchBaseCredentials(baseKey), enabled: !!baseKey });

	const [user, setUser] = useState("");
	const [password, setPassword] = useState("");

	// Имя следует за данными базы: карточку могли открыть для другой базы тем же компонентом.
	useEffect(() => { setUser(creds.data?.user ?? ""); setPassword(""); }, [creds.data]);

	const save = useMutation({
		mutationFn: () => saveBaseCredentials(baseKey, {
			user: user.trim(),
			// Поле пустое — пароль не трогаем вовсе (см. заголовок файла).
			...(password ? { password } : {}),
		}),
		onSuccess: () => {
			showToast(translate("onecCredsSaved"), "success");
			setPassword("");
			void qc.invalidateQueries({ queryKey: key });
		},
		onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	const drop = useMutation({
		mutationFn: () => clearBaseCredentials(baseKey),
		onSuccess: () => {
			showToast(translate("onecCredsCleared"), "success");
			setUser(""); setPassword("");
			void qc.invalidateQueries({ queryKey: key });
		},
		onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	const stored = creds.data;
	const busy = save.isPending || drop.isPending || creds.isLoading;
	const isSet = !!stored?.user;

	return (
		<GroupCol>
			<QueryError error={creds.error} />

			<FormArea title={translate("onecCredsTitle")}>
				<GroupCol>
					<GroupRow>
						<Field name="bc_user" label={translate("onecUserName")} value={user} width="220px"
							noAutofill disabled={busy}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUser(e.target.value)} />
						<Field name="bc_pwd" label={translate("onecUserPassword")} type="password" value={password}
							width="220px" disabled={busy}
							placeholder={stored?.hasPassword ? translate("onecCredsPasswordKeep") : ""}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
						<Field name="bc_changed" label={translate("onecCredsUpdatedAt")}
							value={stored?.updatedAt ? getFormatDate(stored.updatedAt) : "—"}
							disabled width="190px" onChange={() => {}} />
					</GroupRow>
					<GroupRow>
						<Button variant="primary" disabled={busy || !user.trim()}
							title={user.trim() ? translate("save") : translate("onecCredsNeedUser")}
							onClick={() => save.mutate()}>
							<Icon name="save" /> {translate("save")}
						</Button>
						<Button variant="secondary" disabled={busy || !isSet}
							title={isSet ? translate("onecCredsClear") : translate("onecCredsNotSet")}
							onClick={() => drop.mutate()}>
							<Icon name="clear" /> {translate("onecCredsClear")}
						</Button>
					</GroupRow>
				</GroupCol>
			</FormArea>

			<Notice items={[{
				type: "info",
				text: isSet
					? `${translate("onecCredsHint")} ${stored?.hasPassword ? "" : translate("onecCredsNoPassword")}`.trim()
					: `${translate("onecCredsNotSet")}. ${translate("onecCredsHint")}`,
			}]} />
		</GroupCol>
	);
};

export default BaseCredentialsTab;
