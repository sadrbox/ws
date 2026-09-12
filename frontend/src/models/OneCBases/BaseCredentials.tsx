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
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import main from "src/styles/main.module.scss";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { Icon } from "src/components/IconButton/icons";
import { getFormatDate } from "src/utils/datetime";
import { QueryError, useAgents, useOnecWrite } from "src/models/OneCAdmin/shared";
import { withOp } from "src/models/OneCAdmin/progress";
import {
	clearBaseCredentials, fetchBaseCredentials, hasCapability, saveBaseCredentials,
} from "src/services/onec/api";

export const BaseCredentialsTab: FC<{ baseKey: string }> = ({ baseKey }) => {
	const canWrite = useOnecWrite();
	const qc = useQueryClient();
	const key = ["onec", "base-credentials", baseKey];
	const creds = useQuery({ queryKey: key, queryFn: () => fetchBaseCredentials(baseKey), enabled: !!baseKey });
	// Учётная запись базы работает только с агентом, который умеет её применять: он
	// объявляет это способностью «ib.auth». Сказать об этом надо ДО того, как человек
	// заполнит поля и удивится отказу «проверьте служебного администратора».
	const agents = useAgents();
	const agentReady = hasCapability(agents.data?.items, "ib.auth");

	const [user, setUser] = useState("");
	const [password, setPassword] = useState("");

	// Имя следует за данными базы: карточку могли открыть для другой базы тем же компонентом.
	useEffect(() => { setUser(creds.data?.user ?? ""); setPassword(""); }, [creds.data]);

	const save = useMutation({
		mutationFn: () => withOp(
			{ kind: "update", title: translate("onecCredsTitle"), target: baseKey, scope: { bases: [baseKey] } },
			() => saveBaseCredentials(baseKey, {
				user: user.trim(),
				// Поле пустое — пароль не трогаем вовсе (см. заголовок файла).
				...(password ? { password } : {}),
			}),
		),
		onSuccess: () => {
			showToast(translate("onecCredsSaved"), "success");
			setPassword("");
			void qc.invalidateQueries({ queryKey: key });
		},
		onError: (e) => reportError(e, { source: translate("onecTabAccess") }),
	});

	const drop = useMutation({
		mutationFn: () => withOp(
			{ kind: "delete", title: translate("onecCredsClear"), target: baseKey, scope: { bases: [baseKey] } },
			() => clearBaseCredentials(baseKey),
		),
		onSuccess: () => {
			showToast(translate("onecCredsCleared"), "success");
			setUser(""); setPassword("");
			void qc.invalidateQueries({ queryKey: key });
		},
		onError: (e) => reportError(e, { source: translate("onecTabAccess") }),
	});

	const stored = creds.data;
	const busy = save.isPending || drop.isPending || creds.isLoading;
	const isSet = !!stored?.user;

	return (
		// Каркас — общий для форм приложения (см. SalesForm): поля слева, сообщения
		// справа снизу.
		<div className={main.FormContainer}>
			<div className={main.FormWrapper}>
				<GroupCol className={main.Form}>
					<FormArea title={translate("onecCredsTitle")}>
						<GroupCol>
							<GroupRow>
								<Field name="bc_user" label={translate("onecUserName")} value={user} width={FIELD_WIDTH.wide}
									noAutofill disabled={busy}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUser(e.target.value)} />
								<Field name="bc_pwd" label={translate("onecUserPassword")} type="password" value={password}
									width={FIELD_WIDTH.wide} disabled={busy}
									placeholder={stored?.hasPassword ? translate("onecCredsPasswordKeep") : ""}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
								<Field name="bc_changed" label={translate("onecCredsUpdatedAt")}
									value={stored?.updatedAt ? getFormatDate(stored.updatedAt) : "—"}
									disabled width={FIELD_WIDTH.date} onChange={() => {}} />
							</GroupRow>
							{/* Пара «имя + пароль» — это вход агента в базу: правом «только просмотр»
							    видно, задана ли она и когда менялась, но не переписывают (F5). */}
							{canWrite && (
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
							)}
						</GroupCol>
					</FormArea>
				</GroupCol>

				<GroupCol className={main.FormNotice}>
					<QueryError error={creds.error} />
					<Notice inline items={[
						...(agents.isLoading || agentReady ? [] : [{
							type: "warning" as const,
							text: translate("onecCredsAgentUnsupported"),
						}]),
						{
							// ПОЯСНЕНИЕ, А НЕ СООБЩЕНИЕ: оно верно всё время, пока вкладка открыта, и
							// в общей области висело бы «актуальным» вечно — очистка такие записи не
							// берёт, и список выглядел незакрывающимся. Рисуем на месте.
							type: "info" as const,
							/*
							 * ДВА РАЗНЫХ ПОЛОЖЕНИЯ — ДВА РАЗНЫХ ТЕКСТА. Раньше в обоих стояла одна
							 * подсказка про «эту запись», и когда записи нет, она говорила о том,
							 * чего не существует: «используется администратор агента» и тут же
							 * «берёт эту запись, если тот не подошёл». Пустой вкладке нужно сказать,
							 * кем агент входит сейчас и зачем вообще заполнять поля.
							 */
							text: isSet
								? `${translate("onecCredsHint")} ${stored?.hasPassword ? "" : translate("onecCredsNoPassword")}`.trim()
								: `${translate("onecCredsNotSet")}. ${translate("onecCredsNotSetHint")}`,
						},
					]} />
				</GroupCol>
			</div>
		</div>
	);
};

export default BaseCredentialsTab;
