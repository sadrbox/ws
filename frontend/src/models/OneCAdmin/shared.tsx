/**
 * Общие части вкладок «Администрирования 1С»: таблица баз с отметками и модалка
 * подтверждения групповой операции.
 *
 * Групповые операции идут ПО ВЫБРАННЫМ базам, поэтому таблица баз повторяется на
 * нескольких вкладках — здесь она одна на всех, чтобы колонки и поведение не разошлись.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { VSplitBar, useSplitResize } from "src/components/SplitPane";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { asText } from "src/utils/asText";
import { fetchBases, fetchAgents, hasCapability, type OnecBase } from "src/services/onec/api";
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
const targetColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "110px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "published", type: "string", width: "140px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "extensionsCount", type: "number", width: "140px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Публикация: null — «не проверялась», а не «нет» (см. миграцию 008). */
export const publishLabel = (v: boolean | null | undefined): string =>
	v === true ? translate("onecPublished")
		: v === false ? translate("onecNotPublished")
			: translate("onecPublishUnknown");

export type BaseTargetsApi = {
	/** Ключи отмеченных баз — цель групповой операции. */
	selectedKeys: string[];
	table: React.ReactNode;
	bases: OnecBase[];
	isLoading: boolean;
};

/**
 * Таблица баз с чекбоксами. Клик по строке (не по чекбоксу) отдаёт ключ базы наружу —
 * так вкладка показывает содержимое одной базы, не теряя набор отмеченных.
 */
export function useBaseTargets(opts: {
	componentName: string;
	onOpenBase?: (baseKey: string) => void;
	/** Кнопки тулбара — функция от выбора: они почти всегда зависят от числа отмеченных. */
	extraButtons?: (selectedKeys: string[]) => React.ReactNode;
	/** Отбор целей (напр. только базы без нужного расширения). */
	filter?: (base: OnecBase) => boolean;
	/** Для какой операции выбираются цели: неприменимые базы скрыты (с возможностью показать). */
	applicableFor?: OnecOperation;
}): BaseTargetsApi {
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(targetColumns(), opts.componentName));
	const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
	// Неприменимые базы скрыты по умолчанию, но не спрятаны навсегда: пользователь должен
	// видеть, что список неполон, и уметь посмотреть на отсеянные базы.
	const [showAll, setShowAll] = useState(false);

	const filter = opts.filter;
	const op = opts.applicableFor;
	const applicable = useMemo(
		() => (bases.data?.items ?? []).filter((b) => !op || showAll || isApplicable(b, op)),
		[bases.data, op, showAll],
	);
	const hidden = (bases.data?.items ?? []).length - applicable.length;

	const rowsRaw = useMemo(() => applicable.filter((b) => !filter || filter(b)).map((b, i) => ({
		id: i + 1,
		uuid: b.id,
		baseKey: b.key,
		name: b.name || "",
		status: b.status,
		published: b.published,
		extensionsCount: b.extensionsCount,
	})), [applicable, filter]);

	const sorted = useStaticTableView(rowsRaw, { baseKey: "asc" });
	const rows = useMemo(() => sorted.rows.map((r) => ({
		...r,
		name: r.name || "—",
		// Тот же перевод статуса, что и во вкладке «Базы»: фантомные базы должны быть
		// различимы и там, где выбирают цели групповых операций.
		status: { ONLINE: translate("onecBaseOnline"), MISSING: translate("onecBaseMissing"),
			DISABLED: translate("onecBaseDisabled"), UNKNOWN: translate("onecBaseUnknown") }[r.status] ?? r.status,
		published: publishLabel(r.published),
		extensionsCount: r.extensionsCount ?? translate("onecExtNotChecked"),
	})), [sorted.rows]);

	const onSelectionChange = useCallback((selected: Set<number>, all: TDataItem[]) => {
		setSelectedKeys(all.filter((r) => selected.has(Number(r.id))).map((r) => String(r.baseKey)));
	}, []);

	const onRowClick = useCallback((row: Partial<TDataItem>) => {
		if (opts.onOpenBase) opts.onOpenBase(asText(row.baseKey));
	}, [opts]);

	const table = (
		<Table
			{...buildStaticTableProps({
				componentName: opts.componentName,
				rows, columns, setColumns,
				sorting: sorted.sorting,
				search: sorted.search,
				isLoading: bases.isLoading,
				onReload: () => void bases.refetch(),
				selectable: true,
				onSelectionChange,
				...(opts.onOpenBase ? { onRowClick } : {}),
				extraButtons: (
					<>
						{opts.extraButtons ? opts.extraButtons(selectedKeys) : null}
						{op && (hidden > 0 || showAll) && (
							<Button size="sm" active={showAll} onClick={() => setShowAll((v) => !v)}>
								{translate("onecShowInapplicable")}{hidden > 0 && !showAll ? ` (${hidden})` : ""}
							</Button>
						)}
					</>
				),
			})}
		/>
	);

	return { selectedKeys, table, bases: bases.data?.items ?? [], isLoading: bases.isLoading };
}

/**
 * Предупреждение «этого не может произойти в принципе»: у админ-агента нет способности,
 * без которой команда не будет даже поставлена в очередь. Показывается ДО нажатия кнопки —
 * иначе пользователь узнаёт о препятствии из отчёта «пропущено 110 из 110».
 */
/**
 * Сколько баз проверять одновременно. Значение приходит от сервиса (ONEC_CHECK_PARALLEL):
 * каждое обращение к базе занимает у 1С сеанс и лицензию, и держать это число в двух
 * местах — верный способ их развести.
 */
export function useCheckParallel(): number {
	const agents = useQuery({ queryKey: ["onec", "agents"], queryFn: fetchAgents });
	return agents.data?.limits?.checkParallel ?? 4;
}

export const CapabilityGuard: FC<{ capability: string; children?: React.ReactNode }> = ({ capability }) => {
	const agents = useQuery({ queryKey: ["onec", "agents"], queryFn: fetchAgents });
	if (agents.isLoading || hasCapability(agents.data?.items, capability)) return null;

	const online = (agents.data?.items ?? []).filter((a) => a.role === "admin" && a.online && !a.disabled);
	return (
		<div className={styles.Blocked}>
			{online.length
				? `${translate("onecCapabilityMissing")}: ${capability}`
				: translate("onecNoAdminAgent")}
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
	return <div className={styles.Blocked}>{text}</div>;
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
