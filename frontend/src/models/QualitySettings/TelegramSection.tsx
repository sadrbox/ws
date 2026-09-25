/**
 * Telegram — личные уведомления учёта качества вне ERP (E17 СК0.4): SLA, эскалации, кандидаты в
 * нарушения. Без этого о сроках узнаёт только тот, кто сидит в панели.
 *
 * Привязка: «Подключить» даёт ссылку на бота с одноразовым кодом; человек открывает её в
 * Telegram и нажимает «Start» — бот запоминает его чат. Состояние перечитывается кнопкой.
 *
 * ПРОВЕРИТЬ ПОТОМ: бот работает, только если на сервере заданы TELEGRAM_BOT_TOKEN и
 * TELEGRAM_BOT_NAME и есть исходящий доступ к api.telegram.org; без них экран так и говорит.
 */
import { type FC, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { FormArea, Group, GroupCol } from "src/components/UI";
import Notice, { type NoticeItem } from "src/components/Notice";
import { showToast } from "src/components/UIToast";
import { routeError } from "src/services/errors/route";
import { getFormatDate } from "src/utils/datetime";
import { createTelegramLink, fetchTelegramStatus, unlinkTelegram } from "src/services/quality/api";
import QualityChip from "src/models/_quality/QualityChip";
import { fillTemplate } from "src/models/_quality/text";
import main from "src/styles/main.module.scss";
import styles from "./QualitySettings.module.scss";

const KEY = ["quality", "telegram"] as const;

export const TelegramSection: FC = () => {
	const queryClient = useQueryClient();
	const [link, setLink] = useState<{ url: string | null; code: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	const q = useQuery({ queryKey: KEY, queryFn: fetchTelegramStatus, staleTime: 30_000 });
	const st = q.data;

	const run = useCallback(async (action: () => Promise<void>) => {
		setBusy(true);
		setNotices([]);
		try {
			await action();
		} catch (e) {
			setNotices(routeError(e, { source: translate("qualityTelegramTitle"), fallback: translate("qualityTelegramFailed") }));
		} finally {
			setBusy(false);
		}
	}, []);

	const connect = () => void run(async () => {
		const r = await createTelegramLink();
		setLink({ url: r.url, code: r.code });
	});

	const disconnect = () => void run(async () => {
		await unlinkTelegram();
		setLink(null);
		showToast(translate("qualityTelegramUnlinked"), "success");
		await queryClient.invalidateQueries({ queryKey: KEY });
		void queryClient.invalidateQueries({ queryKey: ["quality", "me"] });
	});

	const recheck = () => void run(async () => {
		const r = await q.refetch();
		if (r.data?.linked) {
			setLink(null);
			showToast(translate("qualityTelegramLinkedDone"), "success");
			void queryClient.invalidateQueries({ queryKey: ["quality", "me"] });
		}
	});

	// Бот не настроен на сервере, либо ссылку не из чего собрать (нет имени бота).
	const notConfigured = (st && !st.enabled) || (link && !link.url);
	const info: NoticeItem[] = notConfigured ? [{ type: "info", text: translate("qualityTelegramNotConfigured") }] : [];

	return (
		<FormArea title={translate("qualityTelegramTitle")}>
			<GroupCol gap={6}>
				<div>
					{q.isLoading ? (
						<span className={main.SettingHint}>{translate("loading")}</span>
					) : st?.linked ? (
						<QualityChip tone="ok">
							{st.linkedAt ? fillTemplate(translate("qualityTelegramLinkedAt"), { date: getFormatDate(st.linkedAt) }) : translate("qualityTelegramLinked")}
						</QualityChip>
					) : (
						<QualityChip tone="muted">{translate("qualityTelegramNotLinked")}</QualityChip>
					)}
				</div>
				<span className={main.SettingHint}>{translate("qualityTelegramHint")}</span>
				{link && (
					link.url ? (
						<div className={styles.TelegramLink}>
							<a href={link.url} target="_blank" rel="noreferrer noopener">{link.url}</a>
							<span className={main.SettingHint}>{translate("qualityTelegramOpenHint")}</span>
						</div>
					) : (
						<span className={main.SettingHint}>{fillTemplate(translate("qualityTelegramCodeHint"), { code: link.code })}</span>
					)
				)}
				<Group>
					{st?.linked ? (
						<Button onClick={disconnect} disabled={busy}>{translate("qualityTelegramUnlink")}</Button>
					) : (
						<Button variant="primary" onClick={connect} disabled={busy || !st?.enabled}
							title={st && !st.enabled ? translate("qualityTelegramNotConfiguredShort") : undefined}>
							{translate("qualityTelegramConnect")}
						</Button>
					)}
					<Button onClick={recheck} disabled={busy}>{translate("qualityTelegramRecheck")}</Button>
				</Group>
			</GroupCol>
			<Notice items={[...info, ...notices]} />
		</FormArea>
	);
};

export default TelegramSection;
