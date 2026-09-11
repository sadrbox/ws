/**
 * Общее для вкладок «Администрирования 1С»: применимость операции к базе, чтение
 * содержимого базы, состояние агентов, сообщения об отказах и разделитель половин.
 *
 * Таблица баз с отметками отсюда убрана: она осталась от прежнего устройства панели и не
 * вызывалась ниоткуда — выбор баз давно живёт там, где базы и показывают.
 */
import { FC, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Notice from "src/components/Notice";
import { VSplitBar, useSplitResize } from "src/components/SplitPane";
import { showToast } from "src/components/UIToast";
import {
	fetchBaseExtensions, fetchBaseUsers, fetchAgents, hasCapability, type OnecBase,
} from "src/services/onec/api";
import { finishOp, progressOp, startOp } from "./progress";
import styles from "./OneCAdmin.module.scss";

/**
 * Применимость операции к базе.
 *
 * ЗАЧЕМ. Половина обращений в поддержку выглядела как «база «X» не найдена в кластере»:
 * команду отправляли в базу, к которой она в принципе неприменима — в пропавшую,
 * отключённую или неопубликованную. Дешевле не показывать такую базу как цель, чем
 * объяснять постфактум, почему сто команд из ста завершились ошибкой.
 *
 * `ib` — операции внутри базы (пользователи — только COM, расширения — ibcmd или COM):
 *        нужна живая база в кластере.
 *        Публикация на веб-сервере здесь НИ ПРИ ЧЁМ: COM-соединение идёт к серверу 1С
 *        напрямую, и неопубликованная база — такая же полноценная цель. Отбирать её было бы
 *        ошибкой: базу как раз и готовят к публикации, заводя в ней пользователей.
 * `http` — операции через расширение buhprof_api: вот им публикация нужна.
 * `publish` / `unpublish` — сама публикация и её снятие: применимы к любой живой базе.
 *        Кэшированное состояние публикации целей НЕ отбирает: оно отстаёт от жизни, и
 *        «уже опубликована» превращалось в тупик, когда публикацию сняли мимо панели —
 *        запрещённой оказывалась ровно та команда, которой это расхождение и лечится.
 *        Обе операции идемпотентны по контракту, поэтому лишний запуск безвреден.
 */
export type OnecOperation = "ib" | "http" | "publish" | "unpublish";

/** Принимает всё, у чего есть эти три поля: строку списка баз или запись реестра. */
export function isApplicable(
	b: Pick<OnecBase, "status" | "disabled" | "published">,
	op: OnecOperation,
): boolean {
	// Базы, которой нет в кластере, нет ни для одной операции.
	if (b.status === "MISSING" || b.disabled) return false;
	// «Не проверялась» (null) публикацию не запрещает: считать незнание отказом значило бы
	// прятать базы, с которыми всё в порядке.
	// http — единственный случай, где состояние публикации означает НЕВОЗМОЖНОСТЬ:
	// у неопубликованной базы HTTP-канала нет физически.
	if (op === "http") return b.published !== false;
	return true;
}

/** Колонки списка баз в режиме выбора цели: только то, что помогает выбрать. */
/** Публикация: null — «не проверялась», а не «нет» (см. миграцию 008). */
export const publishLabel = (v: boolean | null | undefined): string =>
	v === true ? translate("onecPublished")
		: v === false ? translate("onecNotPublished")
			: translate("onecPublishUnknown");

/** Что читаем у базы: её пользователей или её расширения. */
export type BaseContentKind = "users" | "extensions";

/**
 * «Обновить содержимое базы» — ОДИН механизм на все экраны.
 *
 * Кнопка есть и на вкладке «Пользователи баз», и в карточке базы, и раньше они делали
 * разное: панель заводила операцию в реестре прогресса, показывала итог и перечитывала
 * кэш реестра, а карточка просто включала свой запрос — без следа в «Прогрессе запросов
 * и команд», без обновления сводок и без сообщения о том, чем всё кончилось. Одна и та же
 * подпись обязана означать одно и то же действие, поэтому обе кнопки зовут этот хук.
 *
 * ЧТО ОН ДЕЛАЕТ. Читает содержимое базы у самой 1С (команда агенту), кладёт ответ в кэш
 * запроса карточки — чтобы прочитанное показалось без второго обращения, — и обновляет
 * сводки реестра, которые от этих данных считаются.
 */
export function useBaseContentCheck(kind: BaseContentKind = "users"): {
	run: (keys: string[]) => Promise<void>;
	checking: boolean;
} {
	const qc = useQueryClient();
	const parallel = useCheckParallel();
	const [checking, setChecking] = useState(false);
	const isUsers = kind === "users";

	const run = useCallback(async (keys: string[]) => {
		const targets = keys.filter(Boolean);
		if (!targets.length || checking) return;
		setChecking(true);
		const op = startOp({
			kind: "read", title: translate(isUsers ? "onecUsersCheck" : "onecExtCheck"),
			target: targets.length === 1 ? targets[0] : `${translate("onecBases")}: ${targets.length}`,
			total: targets.length,
			// Читаем содержимое этих баз — карточки их пользователей на это время не правятся.
			scope: { bases: targets },
		});
		const r = await checkBases(
			targets,
			async (baseKey) => {
				const data = isUsers ? await fetchBaseUsers(baseKey) : await fetchBaseExtensions(baseKey);
				// Время чтения ставим здесь: у агента его в ответе нет, а карточка показывает
				// возраст данных (колонка «Прочитано»). Без метки только что прочитанное
				// выглядело бы как «неизвестно когда» — ровно наоборот правде.
				const seenAt = new Date().toISOString();
				const stamped = { items: (data.items as { seenAt?: string | null }[]).map((x) => ({ ...x, seenAt })) };
				// Прочитанное сразу становится данными карточки базы: иначе она сделала бы
				// второй такой же вход в базу, чтобы показать то же самое.
				qc.setQueryData(["onec", isUsers ? "base-users" : "base-ext", baseKey], stamped);
				return data;
			},
			parallel,
			(done, failed) => progressOp(op, done, failed),
		);
		finishOp(op, {
			failed: r.failed.length,
			note: r.failed.length ? `${r.failed[0].baseKey}: ${r.failed[0].message}` : "",
		});
		setChecking(false);
		showToast(
			r.failed.length
				? `${translate("onecChecked")}: ${r.ok}/${targets.length}. ${translate("onecCheckFailed")}: ${r.failed[0].baseKey} — ${r.failed[0].message}`
				: `${translate("onecChecked")}: ${r.ok}`,
			r.failed.length ? "warning" : "success",
		);
		// Сводки считаются из того же кэша реестра, что наполняет чтение.
		if (isUsers) {
			void qc.invalidateQueries({ queryKey: ["onec", "user-summary"] });
			void qc.invalidateQueries({ queryKey: ["onec", "base-users-cached"] });
			void qc.invalidateQueries({ queryKey: ["onec", "user-where"] });
		} else {
			void qc.invalidateQueries({ queryKey: ["onec", "ext-summary"] });
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
		}
	}, [qc, parallel, checking, isUsers]);

	return { run, checking };
}

/** Частный случай для читаемости на месте вызова. */
export const useBaseUsersCheck = () => useBaseContentCheck("users");

/**
 * Состояние агентов — ОДИН запрос на всю панель, и он опрашивается.
 *
 * Состояние агента меняется без нашего участия: службу на сервере 1С останавливают,
 * перезапускают, обновляют. Пока панель спрашивала о нём только при открытии вкладки,
 * остановленный агент оставался «на связи» до перезагрузки страницы: человек жал команду
 * и ждал ответа от того, кого уже нет. Раз в 15 секунд — достаточно, чтобы заметить, и
 * дёшево: ответ идёт из базы сервиса, кластер он не трогает.
 */
export function useAgents() {
	return useQuery({
		queryKey: ["onec", "agents"],
		queryFn: fetchAgents,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false,
		staleTime: 0,
	});
}

export function useCheckParallel(): number {
	const agents = useAgents();
	return agents.data?.limits?.checkParallel ?? 4;
}

/**
 * Предупреждение «агент этого не умеет» — В СЛОТЕ ПОСТОЯННОЙ ВЫСОТЫ.
 *
 * Раньше оно рендерилось первым элементом экрана и при появлении опускало вниз всё
 * содержимое: агент терял способность (обновление службы) — и таблица уезжала под
 * курсором, теряя позицию прокрутки. Слот занимает своё место всегда, пустой он или нет.
 */
export const CapabilityGuard: FC<{ capability: string; children?: React.ReactNode }> = ({ capability }) => {
	const agents = useAgents();
	const ok = agents.isLoading || hasCapability(agents.data?.items, capability);
	if (ok) return <div className={styles.GuardSlot} aria-hidden />;

	const online = (agents.data?.items ?? []).filter((a) => a.role === "admin" && a.online && !a.disabled);
	// Агент НА СВЯЗИ, но способности нет — почти всегда это его обновление: новая сборка
	// объявила меньше прежней. Сообщение называет, сколько он объявляет сейчас, иначе
	// связь с обновлением агента приходится угадывать.
	const declared = online[0]?.capabilities.length ?? 0;
	// Агент НА СВЯЗИ, но без способности — предупреждение: часть экрана работает.
	// Агента нет вовсе — внимание: не выполнится ни одна команда.
	return (
		<div className={styles.GuardSlot}>
			<Notice wide items={[online.length
			? {
				type: "warning",
				text: `${translate("onecCapabilityMissing")}: ${capability}. ${translate("onecCapabilityLostHint")} (${declared})`,
			}
				: { type: "attention", text: translate("onecNoAdminAgent") }]} />
		</div>
	);
};

/**
 * Причина, по которой таблица пуста. Ошибку запроса react-query по умолчанию НИКУДА не
 * показывает: пользователь видел пустой список и ни слова о том, что 1С ответила отказом.
 * Текст приходит от сервиса и написан для человека — выводим как есть.
 */
export const QueryError: FC<{ error: unknown }> = ({ error }) => {
	if (!error) return null;
	// Только Error даёт осмысленный текст; всё прочее — неизвестная ошибка, а не
	// «[object Object]» в лицо пользователю.
	const text = error instanceof Error ? error.message : translate("unknownError");
	// Ошибка предметной области (1С ответила отказом, сервис отверг запрос) — «error»:
	// системные сбои сюда не попадают, для них <UIToast />.
	return <Notice wide items={[{ type: "error", text }]} />;
};

/**
 * Прогон чтения по нескольким базам — прямыми запросами, без задания.
 *
 * Задание (command_batches) существует для ИЗМЕНЯЮЩИХ операций: их результат по каждой
 * базе нужно хранить и к нему возвращаться. Чтение списка — обычный запрос: нажал и увидел,
 * заводить ради него сущность и уходить на другую вкладку незачем.
 *
 * Ограничение одновременности — не из вежливости: каждое обращение к базе занимает у 1С
 * сеанс и лицензию, а агент и так исполняет команды пачками по `max_parallel`.
 */
export async function checkBases(
	keys: string[],
	read: (baseKey: string) => Promise<unknown>,
	limit = 4,
	/** Сколько баз уже обработано — для вкладки прогресса: проверка сотни баз идёт минутами. */
	onProgress?: (done: number, failed: number) => void,
): Promise<{ ok: number; failed: { baseKey: string; message: string }[] }> {
	const queue = [...keys];
	let ok = 0;
	const failed: { baseKey: string; message: string }[] = [];

	const worker = async () => {
		for (;;) {
			const key = queue.shift();
			if (!key) return;
			try {
				await read(key);
				ok += 1;
			} catch (e) {
				failed.push({ baseKey: key, message: e instanceof Error ? e.message : String(e) });
			}
			onProgress?.(ok + failed.length, failed.length);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, keys.length) }, worker));
	return { ok, failed };
}

/**
 * Вертикальное разделение вкладки: список слева, зависимые строки справа, с перетаскиваемой
 * границей.
 *
 * Механика перетаскивания — общая (`useSplitResize` + `VSplitBar`), та же, что у списка с
 * предпросмотром и у форм отчётов: своя копия с ручным pointermove, клампом и персистом
 * разошлась бы с ними при первой же правке, а разделитель выглядел бы «похожим», но другим.
 *
 * Ширина запоминается по ключу вкладки: у «Расширений» и «Сеансов» разная осмысленная
 * пропорция, и общая настройка заставляла бы подгонять её при каждом переходе.
 *
 * Заголовков разделов здесь нет намеренно: каждая половина — таблица со своей командной
 * панелью, и лишняя строка текста над ней только съедала высоту.
 */
export const VSplit: FC<{
	/** Ключ для запоминания ширины: своя пропорция у каждой вкладки. */
	storageKey: string;
	main: React.ReactNode;
	side: React.ReactNode;
}> = ({ storageKey, main, side }) => {
	// side: "left" — управляем левой (главной) половиной; границы 20–80%: узкая колонка
	// бесполезна, а «схлопнуть» половину случайным движением мыши — потерять таблицу.
	const { percent, containerRef, startResize, reset, nudge } = useSplitResize({
		storageKey: `onec_vsplit_${storageKey}`,
		side: "left",
		defaultPercent: 50,
		min: 20,
		max: 80,
	});

	return (
		<div className={styles.VSplit} ref={containerRef}>
			<div className={styles.VSplitMain} style={{ flexBasis: `${percent}%` }}>{main}</div>
			<VSplitBar onPointerDown={startResize} onDoubleClick={reset} onNudge={nudge} />
			<div className={styles.VSplitSide} style={{ flexBasis: `${100 - percent}%` }}>{side}</div>
		</div>
	);
};
