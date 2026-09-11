/**
 * «Технические сообщения» — полноэкранный вид того же списка, что и в правой области.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ПЕЙН. Правая область узкая и стоит рядом с работой: в ней смотрят «что
 * сейчас не так». Здесь — вся история целиком, во всю ширину, когда разбираются «что
 * вообще происходило» и какие объекты это затронуло.
 *
 * ДАННЫЕ ТЕ ЖЕ. Раньше это был «Центр уведомлений» со своим чтением своего журнала в
 * localStorage — то есть второй механизм рядом с уведомлениями панелей и третий рядом с
 * `<Notice />` форм. Теперь хранилище одно (components/TechMessages/store), а этот экран —
 * лишь другой его вид: та же таблица, та же группировка по объекту, те же действия.
 */
import type { TDataItem } from "src/components/Table/types";
import { FC } from "react";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { APP_SCOPE, clearNoticeHistory, useScopedNotices } from "src/components/TechMessages/store";
import MessagesTable from "src/components/TechMessages/MessagesTable";
import main from "src/styles/main.module.scss";
import styles from "./Notifications.module.scss";

interface NotificationsListProps {
	variant?: string;
	onSelectItem?: (item: TDataItem) => void;
}

const NotificationsList: FC<NotificationsListProps> = () => {
	// Всё приложение: экран открывают именно затем, чтобы увидеть картину целиком.
	const messages = useScopedNotices(APP_SCOPE);
	const history = messages.filter((m) => !m.active).length;

	return (
		<div className={main.PaneFill}>
			<div className={styles.JournalHeader}>
				<h3 className={styles.JournalTitle}>{translate("techMessages")}</h3>
				<Button size="sm" variant="secondary" disabled={!history}
					title={history ? translate("techMessagesHistoryClear") : translate("techMessagesHistoryEmpty")}
					onClick={() => clearNoticeHistory(APP_SCOPE)}>
					<Icon name="clear" /> {translate("techMessagesHistoryClear")}
				</Button>
			</div>
			<div className={styles.JournalList}>
				{/* Полный вид — та же таблица, но со своим именем: настройки колонок узкой
				    области и этого экрана не должны спорить друг с другом. */}
				<MessagesTable componentName="TechMessages_full" messages={messages} />
			</div>
		</div>
	);
};

NotificationsList.displayName = "NotificationsList";
export { NotificationsList };
