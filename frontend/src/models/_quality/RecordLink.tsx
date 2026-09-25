/**
 * Ссылка на запись ERP (задача, нарушение, находка проверки) — открывает её форму по endpoint
 * и uuid через реестр моделей (openFormByEndpoint).
 *
 * Раздел, которого в реестре нет (ещё не подключён или не входит в сборку), ссылкой не
 * делаем: кнопка, по которой ничего не происходит, хуже простого текста.
 */
import { type FC, type ReactNode, useCallback } from "react";
import { useAppContext } from "src/app/context";
import { translate } from "src/i18";
import { getByEndpoint } from "src/registry/modelRegistry";
import { openFormByEndpoint } from "src/registry/formRegistry";
import styles from "./RecordLink.module.scss";

interface Props {
	endpoint: string;
	uuid: string;
	children: ReactNode;
	/** Что сделать до открытия (например, отметить уведомление прочитанным). */
	onOpen?: () => void;
}

export const RecordLink: FC<Props> = ({ endpoint, uuid, children, onOpen }) => {
	const { addPane } = useAppContext().windows;
	const open = useCallback(() => {
		onOpen?.();
		void openFormByEndpoint(endpoint, uuid, addPane);
	}, [onOpen, endpoint, uuid, addPane]);

	if (!endpoint || !uuid || !getByEndpoint(endpoint)) return <span>{children}</span>;
	return (
		<button type="button" className={styles.Link} onClick={open} title={translate("open")}>
			{children}
		</button>
	);
};

export default RecordLink;
