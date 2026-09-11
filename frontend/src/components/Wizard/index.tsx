/**
 * Помощник — последовательность шагов с общим каркасом.
 *
 * ЗАЧЕМ. Групповая операция — это три разных вопроса: НАД ЧЕМ, ЧТО МЕНЯЕМ и ЧТО ИЗ ЭТОГО
 * ВЫЙДЕТ. Пока они стояли в одном окне, ответ на первый («какие базы») давался галочками в
 * таблице, на второй — полями рядом, а третий не давался вовсе: человек нажимал «Применить»
 * и узнавал результат из отчёта задания. Шаги разделяют вопросы и не дают перейти дальше,
 * пока предыдущий без ответа.
 *
 * КАРКАС ЖЁСТКИЙ: полоса шагов сверху, тело посередине (прокручивается только оно), полоса
 * кнопок снизу. Поэтому переход между шагами не двигает кнопки под курсором.
 *
 * Шаг НЕ ОТКЛЮЧАЕТ кнопку «Далее» молча: `blockedReason` объясняет, чего не хватает, —
 * серая кнопка без объяснения заставляет угадывать.
 */
import { FC, ReactNode, useMemo, useState } from "react";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import styles from "./Wizard.module.scss";

export type WizardStep = {
	id: string;
	title: string;
	/** Короткое пояснение под заголовком шага: что здесь делают. */
	hint?: string;
	body: ReactNode;
	/** Чего не хватает, чтобы уйти дальше. Пусто — можно. */
	blockedReason?: string;
};

export const Wizard: FC<{
	steps: WizardStep[];
	/** Подпись кнопки завершения — она у каждого помощника своя («Применить», «Установить»). */
	finishLabel: string;
	/** Чего не хватает для завершения; пусто — можно применять. */
	finishBlockedReason?: string;
	onFinish: () => void;
	finishing?: boolean;
	onCancel?: () => void;
}> = ({ steps, finishLabel, finishBlockedReason, onFinish, finishing, onCancel }) => {
	const [index, setIndex] = useState(0);
	const step = steps[Math.min(index, steps.length - 1)];
	const isLast = index >= steps.length - 1;

	/** Пройденные шаги открыты для возврата: назад можно всегда, вперёд — по условию. */
	const canGoNext = useMemo(() => !step.blockedReason, [step]);

	return (
		<div className={styles.Wizard}>
			<ol className={styles.Steps}>
				{steps.map((s, i) => (
					<li key={s.id}
						className={[
							styles.Step,
							i === index ? styles.StepCurrent : null,
							i < index ? styles.StepDone : null,
						].filter(Boolean).join(" ")}
					>
						{/* Назад — щелчком по пройденному шагу: это быстрее, чем жать «Назад» трижды. */}
						<button type="button" className={styles.StepButton}
							disabled={i > index}
							onClick={() => setIndex(i)}>
							<span className={styles.StepNumber}>{i + 1}</span>
							<span className={styles.StepTitle}>{s.title}</span>
						</button>
					</li>
				))}
			</ol>

			{step.hint && <div className={styles.Hint}>{step.hint}</div>}

			<div className={styles.Body}>{step.body}</div>

			<div className={styles.Foot}>
				{onCancel && (
					<Button variant="secondary" onClick={onCancel} disabled={finishing}>
						{translate("cancel")}
					</Button>
				)}
				<span className={styles.FootSpacer} />
				<Button variant="secondary" disabled={index === 0 || finishing}
					onClick={() => setIndex((i) => Math.max(0, i - 1))}>
					<span className={styles.CaretBack}><Icon name="caretDown" /></span> {translate("wizardBack")}
				</Button>
				{!isLast && (
					<Button variant="primary" disabled={!canGoNext}
						title={step.blockedReason || translate("wizardNext")}
						onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}>
						{translate("wizardNext")} <span className={styles.CaretNext}><Icon name="caretDown" /></span>
					</Button>
				)}
				{isLast && (
					<Button variant="primary" disabled={!!finishBlockedReason || finishing}
						title={finishBlockedReason || finishLabel}
						onClick={onFinish}>
						<Icon name="save" /> {finishLabel}
					</Button>
				)}
			</div>
		</div>
	);
};

export default Wizard;
