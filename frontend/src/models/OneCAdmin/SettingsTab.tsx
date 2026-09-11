/**
 * «Настройки» — то, что панель знает о среде, а узнать сама не может.
 *
 * ПУБЛИЧНЫЙ АДРЕС СЕРВЕРА. Агент собирает адрес опубликованной базы из привязки сайта IIS
 * и отдаёт ровно то, что там написано: при привязке без имени узла (`http/*:80:`) это
 * `http://localhost/adinurip`. Ответ честный — с самого сервера ссылка рабочая, — но
 * снаружи по ней не попасть, а имени, под которым сервер виден из сети, агент не знает и
 * знать не обязан.
 *
 * ПОЧЕМУ НЕ ПОДМЕНЯЕМ В ДАННЫХ. `publishUrl` — это ответ агента, и он остаётся нетронутым:
 * если однажды привязка сайта окажется неверной, увидеть это можно будет только по нему.
 * Публичное имя применяется ТОЛЬКО К ПОКАЗУ, отдельным полем (`publishUrlPublic`).
 *
 * НАСТРОЙКА У КАЖДОГО СЕРВЕРА СВОЯ: серверов может быть несколько, и общее значение на
 * установку было бы неверным ровно в тот день, когда появится второй.
 */
import { FC, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Notice from "src/components/Notice";
import { Field } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { fetchServers, setServerPublicHost, type OnecServer } from "src/services/onec/api";
import { QueryError } from "./shared";
import main from "src/styles/main.module.scss";

/** Как будет выглядеть ссылка с этим именем — показываем до сохранения. */
const previewUrl = (host: string): string => {
	const h = host.trim();
	if (!h) return "http://localhost/<база>";
	try {
		const u = new URL(/^[a-z]+:\/\//i.test(h) ? h : `http://${h}`);
		return `${u.protocol}//${u.host}/<база>`;
	} catch {
		return translate("onecSettingsHostInvalid");
	}
};

const ServerRow: FC<{ server: OnecServer }> = ({ server }) => {
	const qc = useQueryClient();
	const [host, setHost] = useState(server.publicHost ?? "");
	// Значение могло измениться на сервере (другая вкладка, другой человек) — подхватываем.
	useEffect(() => { setHost(server.publicHost ?? ""); }, [server.publicHost]);

	const save = useMutation({
		mutationFn: () => setServerPublicHost(server.id, host),
		onSuccess: (d) => {
			qc.setQueryData(["onec", "servers"], d);
			// Ссылки на базы собираются из этого имени — список баз перечитываем.
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
			showToast(translate("saved"), "success");
		},
		onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	const dirty = (server.publicHost ?? "") !== host;

	return (
		<FormArea title={`${server.name} · ${translate("bases")}: ${server.bases}`}>
			<GroupCol>
				<GroupRow>
					<Field name={`srv_${server.id}`} label={translate("onecSettingsPublicHost")}
						value={host} noAutofill width={FIELD_WIDTH.lg}
						placeholder="1c.buhprof.kz"
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHost(e.target.value)} />
					<Field name={`srv_prev_${server.id}`} label={translate("onecSettingsPreview")}
						value={previewUrl(host)} disabled width={FIELD_WIDTH.lg} onChange={() => {}} />
				</GroupRow>
				<GroupRow>
					<Button variant="primary" disabled={!dirty || save.isPending}
						title={dirty ? translate("save") : translate("onecNoChanges")}
						onClick={() => save.mutate()}>
						<Icon name="save" /> {translate("save")}
					</Button>
					{/* Пустое поле — это тоже решение: подмены не будет, ссылки останутся
					    такими, какими их отдаёт агент. */}
					<Button variant="secondary" disabled={!host || save.isPending}
						title={translate("onecSettingsClearHint")}
						onClick={() => setHost("")}>
						<Icon name="clear" /> {translate("clear")}
					</Button>
				</GroupRow>
			</GroupCol>
		</FormArea>
	);
};

export const SettingsTab: FC = () => {
	const servers = useQuery({ queryKey: ["onec", "servers"], queryFn: fetchServers });
	const items = servers.data?.items ?? [];

	return (
		<div className={main.FormContainer}>
			<QueryError error={servers.error} noticeKey="servers" source={translate("onecTabSettings")} />
			<div className={main.FormWrapper}>
				<GroupCol className={main.Form}>
					{items.map((s) => <ServerRow key={s.id} server={s} />)}
					{/*
					  * ПУСТО — НЕ ОДНО И ТО ЖЕ. «Серверов нет» и «не удалось спросить» —
					  * разные ответы, и валить их в один текст значит выдавать незнание за
					  * факт. Живой случай: сервис ещё не перезапущен, ручка отвечает 404, а
					  * вкладка сообщала «серверов в реестре пока нет» — и человек шёл искать
					  * несуществующую проблему в реестре.
					  */}
					{!items.length && !servers.isLoading && (
						<Notice inline items={[servers.error
							? { type: "error", text: translate("onecSettingsUnavailable") }
							: { type: "info", text: translate("onecSettingsNoServers") }]} />
					)}
				</GroupCol>

				<GroupCol className={main.FormNotice}>
					<Notice items={[{ type: "info", text: translate("onecSettingsPublicHostHint") }]} />
				</GroupCol>
			</div>
		</div>
	);
};

export default SettingsTab;
