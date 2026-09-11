/**
 * Технические сообщения ТАБЛИЦЕЙ: группа — объект, вложенные строки — сами сообщения.
 *
 * ПОЧЕМУ ТАБЛИЦА. Список карточек читался как лента: в нём нельзя было ни отсортировать по
 * времени, ни отобрать поиском, ни сравнить два объекта — а вопросы к техническим
 * сообщениям почти всегда такие: «что последнее», «где именно», «сколько раз». Таблица
 * отвечает на них своими штатными средствами, и ничего изобретать под это не нужно.
 *
 * ГРУППА — ОБЪЕКТ (см. grouping.ts): сообщения одной реализации стоят вместе, а не
 * вперемешку с состоянием агента 1С. Строка группы называет объект и говорит, сколько у
 * него сообщений и сколько из них актуальны; вложенные строки — сами сообщения.
 *
 * ВЛОЖЕННЫЕ СТРОКИ ЗДЕСЬ ПОЯСНЯЮЩИЕ: отмечать в них нечего, выбирают саму группу (см.
 * TableBodyRow — признак различения в том, несут ли потомки `__selected`).
 *
 * `<Notice />` для показа НЕ ИСПОЛЬЗУЕТСЯ (временно, по решению 2026-09-11): область
 * сообщений целиком табличная. Сам компонент остался там, где сообщение — содержимое
 * места: тело модального окна подтверждения (`inline`).
 */
import { FC, useCallback, useMemo, useState } from "react";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { getFormatDate } from "src/utils/datetime";
import { asText } from "src/utils/asText";
import { useAppContext } from "src/app/context";
import { openFormByRef, canOpenByRef } from "src/utils/openFormByRef";
import { dismissMessage, type TechMessage } from "./store";
import { groupMessages } from "./grouping";
import styles from "./TechMessages.module.scss";

/**
 * Колонки одни на группу и на сообщение: вложенные строки рисуются тем же TableBodyRow.
 * «Объект» у потомка показывает текст сообщения, «Состояние» — актуально оно или уже нет.
 */
const columns = (): TColumn[] => ([
	{ identifier: "subject", type: "string", width: "320px", minWidth: "160px", alignment: "left", visible: true, inlist: true },
	{ identifier: "msgState", type: "string", width: "130px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "msgSource", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "msgWhen", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Палитра сообщения словами: цвет — подспорье, а читают текст. */
const TYPE_LABEL: Record<TechMessage["type"], string> = {
	error: "techMsgError",
	attention: "techMsgAttention",
	warning: "techMsgWarning",
	success: "techMsgSuccess",
	info: "techMsgInfo",
};

export const MessagesTable: FC<{
	messages: TechMessage[];
	/** Своё имя у каждого места показа: настройки колонок узкой области и полного вида — разные. */
	componentName: string;
	extraButtons?: React.ReactNode;
}> = ({ messages, componentName, extraButtons }) => {
	const { addPane } = useAppContext().windows;
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), componentName));
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const groups = useMemo(() => groupMessages(messages), [messages]);

	const rows = useMemo(() => groups.map((g, i) => ({
		id: i + 1, uuid: g.id, subject: g.title,
		// У группы «состояние» — счёт: сколько сообщений и сколько из них горит сейчас.
		msgState: g.active ? `${translate("techMsgActive")}: ${g.active} / ${g.items.length}` : String(g.items.length),
		msgSource: "",
		msgWhen: getFormatDate(new Date(Math.max(...g.items.map((m) => m.lastAt))).toISOString()),
		__groupId: g.id,
	})), [groups]);
	const view = useStaticTableView(rows, {});

	const childRows = useCallback((r: TDataItem): TDataItem[] => {
		const g = groups.find((x) => x.id === asText(r.__groupId));
		if (!g) return [];
		return g.items.map((m, i) => ({
			// Отрицательные идентификаторы: пространство строк у потомков своё и не должно
			// пересечься с идентификаторами групп.
			id: -(i + 1), uuid: m.id,
			subject: m.text,
			msgState: translate(m.active ? "techMsgActive" : "techMsgPast"),
			msgSource: m.source || "—",
			msgWhen: getFormatDate(new Date(m.firstAt).toISOString()),
			__type: m.type,
			__id: m.id,
			__ref: m.ref ? JSON.stringify(m.ref) : "",
			__actions: m.actions?.length ?? 0,
			__resolved: m.resolved === true,
		}));
	}, [groups]);

	/** Выбранная строка: по ней работают кнопки, действующие на одно сообщение. */
	const [active, setActive] = useState<TDataItem | null>(null);
	const activeRef = useMemo(() => {
		const raw = asText(active?.__ref);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as { endpoint: string; uuid: string; label?: string };
		} catch { return null; }
	}, [active]);
	const activeMessage = useMemo(
		() => messages.find((m) => m.id === asText(active?.__id)) ?? null,
		[messages, active],
	);

	return (
		<Table {...buildStaticTableProps({
			componentName, rows: view.rows, columns: cols, setColumns: setCols,
			sorting: view.sorting, search: view.search,
			isLoading: false,
			/*
			 * ПЕРЕНОС ТЕКСТА. Сообщение — предложение, а не значение: «ibcmd extension list
			 * по базе «almaz67» не ответил за 180 с — процесс снят» в одну строку не
			 * помещается ни при какой ширине, а обрезанное многоточием прячет ровно то,
			 * ради чего в список и смотрят. Ячейка тянется до восьми строк.
			 *
			 * Виртуализация при этом выключается (см. Table): она верит, что все строки
			 * одной высоты. Здесь это ничего не стоит — записей не больше двухсот (LIMIT
			 * в store), список короткий и читаемый, а не листаемый.
			 */
			wrapCells: true,
			// Строка группы — это объект, а не запись: подсвечивать её как «текущую» нечего,
			// зато вложенную строку выбирают, чтобы действовать по сообщению.
			onActiveRowChange: (r) => setActive(r ?? null),
			expandedRowIds: expanded,
			onToggleExpand: (r) => setExpanded((prev) => {
				const key = asText(r.uuid);
				const next = new Set(prev);
				if (!next.delete(key)) next.add(key);
				return next;
			}),
			childRows,
			// Цвет — по типу сообщения, и только у самого сообщения: у группы типов может
			// быть несколько, и красить её в один из них значило бы выбрать за человека.
			renderCell: (row, col) => {
				if (col.identifier !== "subject" || !row.__type) return undefined;
				const type = row.__type as TechMessage["type"];
				return (
					<span className={styles.MsgText} data-type={type}
						title={`${translate(TYPE_LABEL[type])}: ${asText(row.subject)}`}>
						{asText(row.subject)}
					</span>
				);
			},
			extraButtons: (
				<>
					{/* Переход к объекту — когда сообщение знает, о чём оно. */}
					{activeRef && canOpenByRef(activeRef.endpoint) && (
						<Button variant="secondary"
							title={`${translate("open")}: ${activeRef.label ?? ""}`.trim()}
							onClick={() => void openFormByRef(activeRef, addPane, asText(active?.msgSource))}>
							<Icon name="open" /> {activeRef.label || translate("open")}
						</Button>
					)}
					{/* Действия сообщения («Повторить»): гаснут, когда повод исчерпан. */}
					{activeMessage?.actions?.map((a, i) => (
						<Button key={i} variant="secondary" disabled={activeMessage.resolved}
							title={activeMessage.resolved ? translate("techMessagesResolved") : a.label}
							onClick={() => { void a.onClick(); dismissMessage(activeMessage.id); }}>
							{a.label}
						</Button>
					))}
					<Button variant="secondary" disabled={!activeMessage}
						title={activeMessage ? translate("hide") : translate("techMsgPickFirst")}
						onClick={() => activeMessage && dismissMessage(activeMessage.id)}>
						<Icon name="clear" /> {translate("hide")}
					</Button>
					{extraButtons}
				</>
			),
		})} />
	);
};

export default MessagesTable;
