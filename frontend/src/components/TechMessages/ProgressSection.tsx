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
 * ОТКУДА ДАННЫЕ. Реестр операций живёт в `models/OneCAdmin/progress`: он единственный в
 * приложении, кто считает длительную работу, и заводить рядом второй — значит завести два
 * ответа на один вопрос. Эта секция его только показывает.
 */
import { FC, useEffect, useState, useSyncExternalStore } from "react";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { queryClient } from "src/app/queryClient";
import { getFormatDateOnly, getFormatTimeOnly } from "src/utils/datetime";
import { showToast } from "src/components/UIToast";
import {
	abandonOp, cancelOp, opDuration, opKindLabel, opPercent, opStateLabel, useOnecOps, type Op,
} from "src/models/OneCAdmin/progress";
import type { GroupMode } from "./grouping";
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
const useFetchingCount = (): number => useSyncExternalStore(
	(cb) => queryClient.getQueryCache().subscribe(cb),
	() => queryClient.isFetching(),
	() => 0,
);

/**
 * Заметное ожидание: число запросов, если ждём дольше SLOW_MS, иначе ноль.
 * Возвращает и момент, с которого ждём, — строке нужно время начала, как и операции.
 */
function useSlowFetching(): { count: number; since: number } | null {
	const count = useFetchingCount();
	const [slow, setSlow] = useState<{ count: number; since: number } | null>(null);

	useEffect(() => {
		if (count > 0) {
			// Уже показываем — только обновляем число, не сдвигая начало ожидания.
			if (slow) {
				if (slow.count !== count) setSlow({ ...slow, count });
				return;
			}
			const t = window.setTimeout(() => setSlow({ count, since: Date.now() }), SLOW_MS);
			return () => window.clearTimeout(t);
		}
		if (!slow) return;
		const t = window.setTimeout(() => setSlow(null), LINGER_MS);
		return () => window.clearTimeout(t);
	}, [count, slow]);

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
			data-past={!running || undefined}>
			<div className={styles.RowTime}>
				{withDate && <span className={styles.RowDay}>{getFormatDateOnly(at)}</span>}
				<span>{getFormatTimeOnly(at)}</span>
			</div>

			<div className={styles.RowRail} aria-hidden="true">
				<span className={styles.RowDot} />
			</div>

			<div className={styles.RowBody}>
				<div className={styles.MsgText}>{op.title}{op.target ? ` — ${op.target}` : ""}</div>

				<Progress percent={percent} state={op.state}
					value={op.total ? `${op.done} / ${op.total}` : ""} />

				<div className={styles.MsgMeta}>
					<span className={styles.MsgType}>{opKindLabel(op.kind)}</span>
					{/* Сколько отказало — при самом состоянии: «С ошибками» и отдельное
					    «С ошибками: 1» в одной строке повторяли бы друг друга. */}
					<span>{opStateLabel(op)}{op.failed > 0 ? `: ${op.failed}` : ""}</span>
					<span>{opDuration(op)}</span>
					{op.note && <span>{op.note}</span>}
				</div>

				<div className={styles.MsgActions}>
					{/*
					  * Отмена — только того, что ещё не начато: команду, которую агент забрал,
					  * останавливает он сам на сервере 1С. Поэтому кнопка есть ровно тогда,
					  * когда отменять есть что, и говорит, сколько именно.
					  */}
					{running && op.cancelable > 0 && (
						<Button size="sm" variant="secondary"
							title={`${translate("onecOpCancel")}: ${op.cancelable}`}
							onClick={() => void cancel()}>
							<Icon name="close" /> {translate("onecOpCancel")} ({op.cancelable})
						</Button>
					)}
					{/*
					  * «Скрыть» убирает запись с экрана и НИЧЕГО не останавливает — то же, что
					  * «Прекратить наблюдение» на вкладке. У завершённой это просто уборка, у
					  * зависшей — способ вернуть форме право на правку.
					  */}
					<IconButton size="sm"
						title={running ? translate("onecOpAbandonHint") : translate("hide")}
						aria-label={translate("hide")}
						onClick={() => abandonOp(op.id)}>
						<Icon name="clear" />
					</IconButton>
				</div>
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
export const ProgressSection: FC<{ mode: GroupMode }> = ({ mode }) => {
	const ops = useOnecOps();
	const slow = useSlowFetching();
	const [collapsed, setCollapsed] = useState(false);
	const running = ops.filter((o) => o.state === "running").length;
	useTick(running > 0 || !!slow);

	if (!ops.length && !slow) return null;

	// Под заголовком дня дата известна и в строке не нужна; в остальных режимах — нужна.
	const withDate = mode !== "date";
	const open = !collapsed;
	const total = ops.length + (slow ? 1 : 0);

	return (
		<section className={styles.Group} data-progress="">
			<button type="button" className={styles.GroupHead} data-kind="progress"
				aria-expanded={open} onClick={() => setCollapsed(open)}>
				<span className={`${styles.GroupCaret}${open ? ` ${styles.CaretOpen}` : ""}`}>
					<Icon name="caretDown" />
				</span>
				<span className={styles.GroupTitle}>{translate("techMsgProgress")}</span>
				{running > 0 && <span className={styles.GroupRunning}>{running}</span>}
				<span className={styles.GroupTotal}>{total}</span>
			</button>

			{open && (
				<div className={styles.GroupBody}>
					{/*
					  * Ожидание ответа сервера — одной строкой на все запросы: их бывает
					  * десяток одновременно, и десять одинаковых строк «идёт запрос» не
					  * скажут больше, чем одна с числом.
					  */}
					{slow && (
						<article className={styles.Row} data-type="info" data-run="">
							<div className={styles.RowTime}>
								{withDate && (
									<span className={styles.RowDay}>
										{getFormatDateOnly(new Date(slow.since).toISOString())}
									</span>
								)}
								<span>{getFormatTimeOnly(new Date(slow.since).toISOString())}</span>
							</div>
							<div className={styles.RowRail} aria-hidden="true">
								<span className={styles.RowDot} />
							</div>
							<div className={styles.RowBody}>
								<div className={styles.MsgText}>
									{translate("techMsgRequests")}: {slow.count}
								</div>
								{/* Сколько осталось, сервер не сообщает — значит, спиннер, а не полоса. */}
								<Progress percent={null} />
								<div className={styles.MsgMeta}>
									<span className={styles.MsgType}>{translate("techMsgRequestsHint")}</span>
									<span>
										{Math.max(Math.round((Date.now() - slow.since) / 1000), 0)} {translate("secShort")}
									</span>
								</div>
							</div>
						</article>
					)}

					{ops.map((op) => <OpRow key={op.id} op={op} withDate={withDate} />)}
				</div>
			)}
		</section>
	);
};

export default ProgressSection;
