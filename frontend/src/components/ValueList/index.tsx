/**
 * «Подпись — значение»: показ того, что НЕ РЕДАКТИРУЕТСЯ.
 *
 * ЗАЧЕМ. Реестр баз 1С наполняют кластер и агент, и в карточке править нечего. Раньше такие
 * значения показывались выключенными полями ввода: рамка, серый фон и курсор «сюда можно
 * писать» — обещание, которого форма не выполняет. Человек щёлкает по полю, ничего не
 * происходит, и он ищет, где же включается правка, которой нет.
 *
 * СКВОЗНОЕ ВЫРАВНИВАНИЕ. Ширина колонки подписей задаётся ОДНОЙ переменной (`--value-label`)
 * на весь список, поэтому значения стоят по одной линии во всех группах формы — и там, где
 * подпись короткая («Имя»), и там, где длинная («Расширений в базе»). Пока каждая строка
 * меряла себя сама, колонка значений гуляла от группы к группе, и глазу приходилось искать
 * начало значения заново в каждом ряду.
 *
 * ПОЧЕМУ dl. Это и есть список определений: подпись — термин, значение — его описание. Для
 * чтения с экрана связь «что это» ↔ «чему равно» получается бесплатно, без aria-атрибутов.
 */
import { type FC, type ReactNode } from "react";
import styles from "./ValueList.module.scss";

export const ValueList: FC<{
	children: ReactNode;
	/** Ширина колонки подписей: одна на весь список — отсюда и сквозное выравнивание. */
	labelWidth?: string;
	className?: string;
}> = ({ children, labelWidth, className }) => (
	<dl
		className={[styles.List, className].filter(Boolean).join(" ")}
		style={labelWidth ? ({ "--value-label": labelWidth } as React.CSSProperties) : undefined}
	>
		{children}
	</dl>
);

export const ValueRow: FC<{
	label: string;
	/** Значение строкой — либо своя разметка через `children` (ссылка, состояние с подсказкой). */
	value?: ReactNode;
	children?: ReactNode;
	/** Подсказка на всю строку: почему значение такое. */
	title?: string;
}> = ({ label, value, children, title }) => (
	<div className={styles.Row} title={title}>
		<dt className={styles.Label}>{label}</dt>
		{/* «—» вместо пустоты: пустое место читается как «поле не нарисовалось». */}
		<dd className={styles.Value}>{children ?? (value === "" || value == null ? "—" : value)}</dd>
	</div>
);

export default ValueList;
