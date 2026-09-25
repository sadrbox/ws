/**
 * Переключатель из нескольких вариантов, видных сразу (segmented control) — отбор по состоянию, режим показа.
 *
 * Вместо выпадающего списка, когда вариантов немного (2–6) и переключают их часто: все варианты на виду, выбор —
 * одним щелчком, у варианта может стоять число («Ждут решения 2»). С клавиатуры — как группа радиокнопок: фокус
 * на выбранном варианте, стрелки переключают, Home и End — крайние.
 *
 * ВИД — «ЦВЕТНЫЕ СТАТУСЫ» (выбран 26.09 из вариантов): каждый вариант — отдельная плашка; у варианта с тоном
 * (tone) — цветная точка, выбранный окрашивается цветом своего состояния и отмечается галочкой вместо точки. Так
 * отбор читается тем же цветом, каким состояние подкрашено в таблице под ним.
 *
 * РАЗМЕР ПЛАШКИ НЕ МЕНЯЕТСЯ ПРИ ВЫБОРЕ. Иначе соседние плашки сдвигались бы на каждое переключение: галочка шире
 * точки, а жирная подпись — обычной. Поэтому у значка постоянное место (точка или галочка — одинаковой ширины),
 * а ширину подписи заранее держит невидимая жирная копия текста (Label::after). Значок есть у каждой плашки:
 * пустое место у одной из них читалось как пропуск (26.09).
 */
import { type KeyboardEvent, useRef } from "react";
import { cx } from "src/utils/cx";
import styles from "./SegmentedControl.module.scss";

/**
 * Цвет точки у варианта — тот же, каким состояние подкрашено в таблице. `all` — вариант «все состояния»: точка
 * из цветов всех состояний. Вариант без тона получает нейтральное колечко — значок есть у каждой плашки.
 */
export type SegmentTone = "wait" | "ok" | "bad" | "off" | "all";

export interface SegmentOption<T extends string> {
	value: T;
	label: string;
	/** Число рядом с подписью; 0 и пусто не показываются. */
	count?: number | null;
	tone?: SegmentTone;
	title?: string;
}

interface Props<T extends string> {
	/** Имя группы: от него id кнопок. */
	name: string;
	/** Подпись группы для экранного диктора — видимой подписи у переключателя нет. */
	label: string;
	value: T;
	options: readonly SegmentOption<T>[];
	onChange: (value: T) => void;
	disabled?: boolean;
}

const TONE_CLASS: Record<SegmentTone, string> = {
	wait: styles.ToneWait,
	ok: styles.ToneOk,
	bad: styles.ToneBad,
	off: styles.ToneOff,
	all: styles.ToneAll,
};

/** Галочка выбранного варианта — цветом его текста. */
const CheckMark = () => (
	<svg className={styles.Check} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
		strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<polyline points="20 6 9 17 4 12" />
	</svg>
);

export function SegmentedControl<T extends string>({ name, label, value, options, onChange, disabled }: Props<T>) {
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	const current = Math.max(0, options.findIndex((o) => o.value === value));

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (disabled || !options.length) return;
		const last = options.length - 1;
		let next = -1;
		if (e.key === "ArrowRight" || e.key === "ArrowDown") next = current === last ? 0 : current + 1;
		else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = current === 0 ? last : current - 1;
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = last;
		if (next < 0) return;
		e.preventDefault();
		e.stopPropagation();
		onChange(options[next].value);
		buttons.current[next]?.focus();
	};

	return (
		<div role="radiogroup" aria-label={label} className={cx(styles.Segmented, disabled && styles.Disabled)} onKeyDown={onKeyDown}>
			{options.map((o, i) => {
				const checked = o.value === value;
				return (
					<button
						key={o.value || "_"}
						id={`${name}-${o.value || "all"}`}
						ref={(el) => { buttons.current[i] = el; }}
						type="button"
						role="radio"
						aria-checked={checked}
						tabIndex={checked ? 0 : -1}
						className={cx(styles.Segment, o.tone && TONE_CLASS[o.tone])}
						disabled={disabled}
						title={o.title}
						onClick={() => { if (!checked) onChange(o.value); }}
					>
						<span className={styles.Mark} aria-hidden="true">
							{checked ? <CheckMark /> : <span className={cx(styles.Dot, !o.tone && styles.DotEmpty)} />}
						</span>
						<span className={styles.Label} data-label={o.label}>{o.label}</span>
						{!!o.count && <span className={styles.Count}>{o.count}</span>}
					</button>
				);
			})}
		</div>
	);
}

export default SegmentedControl;
