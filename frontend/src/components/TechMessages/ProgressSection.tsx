/**
 * «Прогресс запросов и команд» — В ОБЛАСТИ СООБЩЕНИЙ.
 *
 * ЗАЧЕМ ЗДЕСЬ. Область сообщений отвечает на вопрос «что происходит», и до сих пор она
 * отвечала только про уже случившееся: отказ, предупреждение, итог. А половина ответа —
 * это то, что происходит ПРЯМО СЕЙЧАС: проверка сотни баз, запись прав, публикация. Раньше
 * это было видно только на вкладке «Прогресс запросов и команд» экрана «Пользователи баз»:
 * ушёл с экрана — и работа стала невидимой, хотя она никуда не делась (реестр операций
 * живёт в модуле и переживает закрытие пейна). Теперь идущая работа и её итог стоят в одном
 * списке, в одном месте и в одной сетке.
 *
 * ЧТО ПОКАЗЫВАЕТ ХОД РАБОТЫ. Полоса от 0 до 100 % — там, где известно, из скольких частей
 * работа состоит (баз, команд): тогда видно не только «идёт», но и «сколько осталось».
 * Где объём неизвестен (одиночная команда, ожидание ответа сервера), процента не
 * существует, и рисовать «0 %» значило бы врать: там крутится спиннер — честное «идёт».
 * Это же правило держит `opPercent` (progress.ts), и второго ответа на этот вопрос нет.
 *
 * ФОНОВЫЕ ЗАПРОСЫ — отдельная строка и только когда ожидание ЗАМЕТНО (дольше секунды).
 * Панель опрашивает сервис раз в три секунды, и строка, загорающаяся на каждый такой
 * запрос, превратила бы список в мигалку — а сообщать «идёт обычная жизнь» незачем.
 * Пропадает строка тоже не сразу: мелькнувшее на 200 мс не читается, а раздражает.
 *
 * ОТКУДА ДАННЫЕ. Реестр длительной работы — `./operations`, общий для приложения (M13):
 * панель 1С подключается к нему адаптером, остальная долгая работа — через `withOp`. Эта
 * секция его только показывает — и подчиняется тем же командам списка, что и сообщения:
 * поиску, «Только ошибкам» и срезу «Текущая форма».
 */
import { FC, useEffect, useState, useSyncExternalStore } from "react";
import { useAppContext } from "src/app/context";
import { canOpenByRef, openFormByRef } from "src/utils/openFormByRef";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { queryClient } from "src/app/queryClient";
import { getFormatDateOnly, getFormatTimeOnly } from "src/utils/datetime";
import { humanErrorText } from "src/utils/errorText";
import { showToast } from "src/components/UIToast";
import {
	abandonOp, cancelOp, opDuration, opKindLabel, opPercent, opStateLabel, opSucceeded,
	useOps, type Op,
} from "./operations";
import type { GroupMode } from "./grouping";
import { waitingSummary, type QueryLike } from "./fetchLabels";
import styles from "./TechMessages.module.scss";

/** Сколько ждать, прежде чем назвать ожидание заметным, и сколько держать строку после. */
const SLOW_MS = 1000;
const LINGER_MS = 600;

/**
 * Сколько запросов панель ждёт прямо сейчас.
 *
 * Читаем кэш запросов НАПРЯМУЮ, а не через `useIsFetching()`: тот берёт клиента из
 * контекста React, а область сообщений живёт и там, где провайдера над ней нет (её
 * показывают и в проверках, и в полноэкранном виде). Клиент в приложении один и тот же
 * модуль — тот же, которым пользуется реестр операций.
 */
const useWaitingKey = (): string => useSyncExternalStore(
	(cb) => queryClient.getQueryCache().subscribe(cb),
	// Строка, а не объект: снимок обязан быть стабильным между вызовами без изменений.
	() => {
		const w = waitingSummary(
			queryClient.getQueryCache().findAll({ fetchStatus: "fetching" }) as unknown as QueryLike[],
		);
		return w.count ? `${w.count}\u0000${w.names.join("\u0000")}` : "";
	},
	() => "",
);

/**
 * Заметное ожидание: число запросов, если ждём дольше SLOW_MS, иначе ноль.
 * Возвращает и момент, с которого ждём, — строке нужно время начала, как и операции.
 */
function useSlowFetching(): { count: number; names: string[]; since: number } | null {
	const key = useWaitingKey();
	const [countText, ...names] = key ? key.split("\u0000") : ["0"];
	const count = Number(countText) || 0;
	const [slow, setSlow] = useState<{ count: number; names: string[]; since: number; key: string } | null>(null);

	useEffect(() => {
		if (count > 0) {
			// Уже показываем — только обновляем число и имена, не сдвигая начало ожидания.
			if (slow) {
				if (slow.key !== key) setSlow({ ...slow, count, names, key });
				return;
			}
			const t = window.setTimeout(() => setSlow({ count, names, since: Date.now(), key }), SLOW_MS);
			return () => window.clearTimeout(t);
		}
		if (!slow) return;
		const t = window.setTimeout(() => setSlow(null), LINGER_MS);
		return () => window.clearTimeout(t);
	// eslint-disable-next-line react-hooks/exhaustive-deps -- names выводятся из key
	}, [count, key, slow]);

	return slow;
}

/** Раз в секунду — пока есть что считать: «идёт уже 40 с» меняется, и это видно. */
function useTick(active: boolean): void {
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!active) return;
		const t = window.setInterval(() => setTick((v) => v + 1), 1000);
		return () => window.clearInterval(t);
	}, [active]);
}

/**
 * Ход работы одной строкой: полоса с процентом либо спиннер.
 *
 * `percent === null` значит «объём неизвестен» — тогда и полосы нет: неопределённый
 * индикатор честнее полосы, застывшей на нуле.
 */
const Progress: FC<{ percent: number | null; state?: Op["state"]; value?: string }> = ({
	percent, state = "running", value,
}) => (
	<div className={styles.Bar} data-state={state}>
		{percent === null ? (
			<span className={styles.Spinner} aria-hidden="true" />
		) : (
			<span className={styles.BarTrack}
				role="progressbar"
				aria-valuenow={percent}
				aria-valuemin={0}
				aria-valuemax={100}
			>
				<span className={styles.BarFill} style={{ width: `${percent}%` }} />
			</span>
		)}
		<span className={styles.BarValue}>
			{value}{percent !== null && value ? " · " : ""}{percent !== null ? `${percent}%` : ""}
		</span>
	</div>
);

/** Одна операция реестра — в той же сетке, что и сообщение: время, шкала, тело. */
const OpRow: FC<{ op: Op; withDate: boolean }> = ({ op, withDate }) => {
	const { addPane } = useAppContext().windows;
	const at = new Date(op.startedAt).toISOString();
	const percent = opPercent(op);
	const running = op.state === "running";
	const type = op.state === "failed" ? "error" : op.state === "done" ? "success" : "info";

	const cancel = async (): Promise<void> => {
		const n = await cancelOp(op.id);
		showToast(n
			? `${translate("onecOpCanceled")}: ${n}`
			: translate("onecOpCancelTooLate"), n ? "success" : "warning");
	};

	return (
		<article className={styles.Row} data-type={type} data-run={running || undefined}
			data-past={!running || undefined} id={`op-${op.id}`} tabIndex={-1}>
			{/* Вид работы — под временем, там же, где у сообщения стоит его род: левая
			    колонка отвечает на вопрос «что это», а тело — «о чём». */}
			<div className={styles.RowTime}>
				{withDate && <span className={styles.RowDay}>{getFormatDateOnly(at)}</span>}
				<span>{getFormatTimeOnly(at)}</span>
				<span className={styles.MsgType}>{opKindLabel(op.kind)}</span>
			</div>

			<div className={styles.RowRail} aria-hidden="true">
				<span className={styles.RowDot} />
			</div>

			<div className={styles.RowBody}>
				{/*
				  * ЧТО ДЕЛАЕМ — строкой, НАД ЧЕМ — в подстрочнике. Раньше это была одна склейка
				  * через тире: «Изменить пользователя — Оператор бухгалтер — _transition», где
				  * три разные вещи разделены одинаково и не разобрать, где кончается действие и
				  * начинается объект.
				  */}
				<div className={styles.MsgText}>{op.title}</div>

				{/*
				  * ПОЛОСА — У ЛЮБОЙ РАБОТЫ, ОБЪЁМ КОТОРОЙ ИЗВЕСТЕН, в том числе по одной базе.
				  * Спиннер вместо неё пробовали: он отвечает только «идёт», а полоса отвечает
				  * ещё и «сколько сделано» — и делает это одинаково для одной базы и для ста,
				  * так что взглядом не приходится различать два разных индикатора в одном
				  * списке. Неопределённый индикатор остаётся там, где доли действительно нет
				  * (`percent === null`): у работы без объёма и у медленного запроса ниже.
				  */}
				{/* Счёт — по УДАВШЕМУСЯ, как и полоса: «1 из 1» у провалившейся команды спорило
				    с «Не выполнено» в той же строке. */}
				<Progress percent={percent} state={op.state}
					value={op.total > 0 ? `${opSucceeded(op)} ${translate("onecOpOutOf")} ${op.total}` : ""} />


				<div className={styles.MsgActions}>
					{/*
					  * Отмена — только того, что ещё не начато: команду, которую агент забрал,
					  * останавливает он сам на сервере 1С. Поэтому кнопка есть ровно тогда,
					  * когда отменять есть что, и говорит, сколько именно.
					  */}
					{running && op.cancelable > 0 && (
						<Button icon="close" size="sm" variant="secondary"
							title={`${translate("onecOpCancel")}: ${op.cancelable}`}
							onClick={() => void cancel()}>
							{translate("onecOpCancel")} ({op.cancelable})
						</Button>
					)}
				</div>


				<div className={styles.MsgMeta}>
					{/* Над чем работа — ссылкой, если объект один и его можно открыть (база, пользователь). */}
					{op.target && (op.ref && canOpenByRef(op.ref.endpoint) ? (
						<button type="button" className={styles.MsgLink}
							title={`${translate("open")}: ${op.target}`}
							onClick={() => void openFormByRef(op.ref!, addPane, op.target)}>
							{op.target}
						</button>
					) : <span>{op.target}</span>)}
					{/*
					  * У работы по одной базе число отказов не добавляет ничего: «Не удалось: 1»
					  * при единственной команде — это просто «Не выполнено». Счёт нужен там, где
					  * баз много и важно, сколько именно не прошло.
					  */}
					<span>
						{op.failed > 0
							? (op.total > 1
								? `${translate("onecOpFailedCount")}: ${op.failed}`
								: translate("onecOpFinishedFailed"))
							: opStateLabel(op)}
					</span>
					{/* «12 с» само по себе не говорит, что это: подписываем. */}
					<span>{translate("onecOpElapsed")}: {opDuration(op)}</span>
					{/* Причина — человеческими словами: «Failed to fetch» не объясняет ничего. */}
					{op.note && <span>{humanErrorText(op.note)}</span>}
				</div>
			</div>

			{/*
			  * «Скрыть» убирает запись с экрана и НИЧЕГО не останавливает — то же, что
			  * «Прекратить наблюдение» на вкладке. У завершённой это просто уборка, у
			  * зависшей — способ вернуть форме право на правку. Стоит в том же углу, что и
			  * у сообщения: список один, и уборка строки в нём делается одним жестом.
			  */}
			<div className={styles.RowClose}>
				<IconButton size="sm"
					title={running ? translate("onecOpAbandonHint") : translate("hide")}
					aria-label={translate("hide")}
					onClick={() => abandonOp(op.id)}>
					<Icon name="clear" />
				</IconButton>
			</div>
		</article>
	);
};

/**
 * Секция целиком: заголовок со счётчиком работающих и строки под ним.
 *
 * Молчит, когда работы нет: пустая секция «операций: 0» занимала бы место у сообщений и
 * сообщала бы то, что и так видно. Сворачивается, как группа сообщений, — и по той же
 * причине: заголовок целиком кнопка, попадать курсором в стрелку 10×10 — работа.
 */
export const ProgressSection: FC<{
	mode: GroupMode;
	/** Поиск списка: по названию, объекту и причине. */
	needle?: string;
	/** «Только ошибки»: остаются упавшие операции. */
	errorsOnly?: boolean;
	/** Срез «Текущая форма»: операции других пейнов скрыты, операции без пейна — видны. */
	pane?: string;
	/**
	 * Показывать завершённые операции. Без «Истории» — только идущие (аудит 14.09, T6):
	 * сообщения закрытых форм уходили в историю сами, а завершённые операции висели до «Очистить».
	 */
	history?: boolean;
}> = ({ mode, needle = "", errorsOnly = false, pane, history = true }) => {
	const ops = useOps();
	const slow = useSlowFetching();
	const [collapsed, setCollapsed] = useState(false);
	/*
	 * ТЕ ЖЕ КОМАНДЫ, ЧТО И У СООБЩЕНИЙ. Раньше поиск и «Только ошибки» отсекали сообщения, а
	 * операции оставались все: человек искал «lock-файл» и видел в ответ десяток чужих
	 * проверок. Операция без пейна (происхождение неизвестно, так запускает панель 1С) видна
	 * в любом срезе — прятать её значило бы потерять из виду работу, которая идёт.
	 */
	const q = needle.trim().toLowerCase();
	const shown = ops.filter((o) => {
		if (pane && o.pane && o.pane !== pane) return false;
		if (!history && o.state !== "running") return false;
		if (errorsOnly && o.state !== "failed") return false;
		if (q && !`${o.title} ${o.target} ${o.note}`.toLowerCase().includes(q)) return false;
		return true;
	});
	// Ожидание сервера — не ошибка и ни на какой поиск не отвечает: при отборе его не показываем.
	const slowShown = slow && !q && !errorsOnly ? slow : null;
	const running = shown.filter((o) => o.state === "running").length;
	useTick(running > 0 || !!slowShown);

	if (!shown.length && !slowShown) return null;

	// Под заголовком дня дата известна и в строке не нужна; в остальных режимах — нужна.
	const withDate = mode !== "date";
	/*
	 * «БЕЗ ГРУППИРОВКИ» — ЗНАЧИТ БЕЗ ЗАГОЛОВКОВ, в том числе у этой секции. Она рисовалась
	 * группой при любом режиме, и в сплошной ленте оставался единственный заголовок — выбор
	 * человека соблюдался везде, кроме неё. Без заголовка сворачивать нечем, поэтому строки
	 * всегда раскрыты — так же, как сообщения в этом режиме.
	 */
	const flat = mode === "none";
	const open = flat || !collapsed;
	const total = shown.length + (slowShown ? 1 : 0);

	return (
		<section className={styles.Group} data-progress="">
			{!flat && (
				<button type="button" className={styles.GroupHead} data-kind="progress"
					aria-expanded={open} onClick={() => setCollapsed(open)}>
					<span className={`${styles.GroupCaret}${open ? ` ${styles.CaretOpen}` : ""}`}>
						<Icon name="caretDown" />
					</span>
					<span className={styles.GroupTitle}>{translate("techMsgProgress")}</span>
					{running > 0 && <span className={styles.GroupRunning}>{running}</span>}
					<span className={styles.GroupTotal}>{total}</span>
				</button>
			)}

			{open && (
				<div className={styles.GroupBody}>
					{/*
					  * Ожидание ответа сервера — одной строкой на все запросы: их бывает
					  * десяток одновременно, и десять одинаковых строк «идёт запрос» не
					  * скажут больше, чем одна с числом.
					  */}
					{slowShown && (
						<article className={styles.Row} data-type="info" data-run="">
							<div className={styles.RowTime}>
								{withDate && (
									<span className={styles.RowDay}>
										{getFormatDateOnly(new Date(slowShown.since).toISOString())}
									</span>
								)}
								<span>{getFormatTimeOnly(new Date(slowShown.since).toISOString())}</span>
								<span className={styles.MsgType}>{translate("techMsgRequestsHint")}</span>
							</div>
							<div className={styles.RowRail} aria-hidden="true">
								<span className={styles.RowDot} />
							</div>
							<div className={styles.RowBody}>
								<div className={styles.MsgText}>
									{translate("techMsgRequests")}: {slowShown.count}
									{/* Чего ждём — разделами: число без имён не говорило ничего. */}
									{slowShown.names.length > 0 && ` — ${slowShown.names.join(", ")}`}
								</div>
								{/* Сколько осталось, сервер не сообщает — значит, спиннер, а не полоса. */}
								<Progress percent={null} />
								<div className={styles.MsgMeta}>
									<span>
										{Math.max(Math.round((Date.now() - slowShown.since) / 1000), 0)} {translate("secShort")}
									</span>
								</div>
							</div>
						</article>
					)}

					{shown.map((op) => <OpRow key={op.id} op={op} withDate={withDate} />)}
				</div>
			)}
		</section>
	);
};

export default ProgressSection;
