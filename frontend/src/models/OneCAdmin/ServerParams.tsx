/**
 * Параметры сервера 1С — ОДИН редактор на все места, где их правят.
 *
 * ЕДИНСТВЕННОЕ МЕСТО — вкладка «Параметры» карточки агента: агент и есть то, что связывает
 * панель с этим сервером. Отдельной вкладки «Настройки» у панели больше нет — она держала
 * ровно эти же поля, и два места для одного набора значений рано или поздно расходятся:
 * где-то поле есть, где-то нет, где-то очищается, где-то нет.
 *
 * ЧТО ЗДЕСЬ ВООБЩЕ НАСТРАИВАЕТСЯ — то, чего агент не знает или знает не всегда:
 *
 *   «Имя сервера» — подпись для человека. Идентичность сервера держится на закреплении за
 *      агентом, а не на имени: переименование безопасно (см. renameServer в сервисе).
 *   «Адрес сервера» — под каким именем сервер виден СНАРУЖИ. Агент собирает адрес
 *      публикации из привязки сайта IIS и честно отдаёт `http://localhost/<база>`; имени
 *      в сети он не знает. Подставляется только в показ, ответ агента не портится.
 *   «Адрес RAS» и «Порт RAS» — служба, через которую агент ходит в кластер. Обычно агент
 *      подставляет свои умолчания (localhost:1545); здесь их переопределяют, когда RAS
 *      живёт на другой машине или порту.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Роль агента (админ/бизнес) не правится: это разные службы под
 * разными учётками ОС, и смена роли в панели создала бы видимость разделения там, где его
 * нет. Способности объявляет сам агент — их правка была бы спором с фактом. Токен, включение
 * и удаление живут на «Основном»: это действия над агентом, а не его параметры.
 */
import { FC, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Notice from "src/components/Notice";
import { Field } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { updateServer, type OnecServer } from "src/services/onec/api";

/** Как будет выглядеть ссылка с этим именем — показываем до сохранения. */
export const previewUrl = (host: string): string => {
	const h = host.trim();
	if (!h) return "http://localhost/<база>";
	try {
		const u = new URL(/^[a-z]+:\/\//i.test(h) ? h : `http://${h}`);
		return `${u.protocol}//${u.host}/<база>`;
	} catch {
		return translate("onecSettingsHostInvalid");
	}
};

export const ServerParams: FC<{ server: OnecServer; showName?: boolean }> = ({ server, showName = true }) => {
	const qc = useQueryClient();
	const [name, setName] = useState(server.name);
	const [host, setHost] = useState(server.publicHost ?? "");
	const [rasHost, setRasHost] = useState(server.rasHost ?? "");
	const [rasPort, setRasPort] = useState(server.rasPort == null ? "" : String(server.rasPort));

	// Значения могли измениться на сервере (другая вкладка, другой человек) — подхватываем.
	useEffect(() => {
		setName(server.name);
		setHost(server.publicHost ?? "");
		setRasHost(server.rasHost ?? "");
		setRasPort(server.rasPort == null ? "" : String(server.rasPort));
	}, [server]);

	const portNum = rasPort.trim() === "" ? null : Number(rasPort.trim());
	const portBad = portNum !== null && (!Number.isInteger(portNum) || portNum <= 0 || portNum >= 65536);

	const save = useMutation({
		mutationFn: () => updateServer(server.id, {
			...(showName ? { name } : {}),
			publicHost: host,
			rasHost,
			rasPort: portNum,
		}),
		onSuccess: (d) => {
			qc.setQueryData(["onec", "servers"], d);
			// Ссылки на базы собираются из публичного имени — список баз перечитываем.
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
			showToast(translate("saved"), "success");
		},
		onError: (e) => reportError(e, { source: translate("onecServer") }),
	});

	const dirty = (showName && name !== server.name)
		|| host !== (server.publicHost ?? "")
		|| rasHost !== (server.rasHost ?? "")
		|| rasPort !== (server.rasPort == null ? "" : String(server.rasPort));

	return (
		<GroupCol>
			<FormArea title={translate("onecSettingsPublication")}>
				<GroupCol>
					{showName && (
						<GroupRow>
							<Field name={`srv_name_${server.id}`} label={translate("onecServer")}
								value={name} noAutofill width={FIELD_WIDTH.wide}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
							<Field name={`srv_bases_${server.id}`} label={translate("bases")}
								value={String(server.bases)} disabled width={FIELD_WIDTH.sm} onChange={() => {}} />
						</GroupRow>
					)}
					<GroupRow>
						<Field name={`srv_host_${server.id}`} label={translate("onecSettingsPublicHost")}
							value={host} noAutofill width={FIELD_WIDTH.lg} placeholder="1c.buhprof.kz"
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHost(e.target.value)} />
						<Field name={`srv_prev_${server.id}`} label={translate("onecSettingsPreview")}
							value={previewUrl(host)} disabled width={FIELD_WIDTH.lg} onChange={() => {}} />
					</GroupRow>
				</GroupCol>
			</FormArea>

			<FormArea title={translate("onecSettingsRas")}>
				<GroupRow>
					{/* Пусто — значит «как у агента»: свои умолчания он подставляет сам. */}
					<Field name={`srv_ras_${server.id}`} label={translate("onecSettingsRasHost")}
						value={rasHost} noAutofill width={FIELD_WIDTH.wide} placeholder="localhost"
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRasHost(e.target.value)} />
					<Field name={`srv_rasport_${server.id}`} label={translate("onecSettingsRasPort")}
						value={rasPort} noAutofill width={FIELD_WIDTH.sm} placeholder="1545"
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRasPort(e.target.value)} />
				</GroupRow>
			</FormArea>

			<GroupRow>
				<Button variant="primary" disabled={!dirty || portBad || save.isPending}
					title={portBad ? translate("onecSettingsPortInvalid")
						: dirty ? translate("save") : translate("onecNoChanges")}
					onClick={() => save.mutate()}>
					<Icon name="save" /> {translate("save")}
				</Button>
			</GroupRow>

			{portBad && <Notice inline items={[{ type: "error", text: translate("onecSettingsPortInvalid") }]} />}
		</GroupCol>
	);
};

export default ServerParams;
