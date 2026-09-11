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
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Notice from "src/components/Notice";
import { GroupCol } from "src/components/UI";
import { fetchServers } from "src/services/onec/api";
import ServerParams from "./ServerParams";
import { QueryError } from "./shared";
import main from "src/styles/main.module.scss";

export const SettingsTab: FC = () => {
	const servers = useQuery({ queryKey: ["onec", "servers"], queryFn: fetchServers });
	const items = servers.data?.items ?? [];

	return (
		<div className={main.FormContainer}>
			<QueryError error={servers.error} noticeKey="servers" source={translate("onecTabSettings")} />
			<div className={main.FormWrapper}>
				<GroupCol className={main.Form}>
					{items.map((s) => <ServerParams key={s.id} server={s} />)}
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
