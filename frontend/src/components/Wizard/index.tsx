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
import { FC, PropsWithChildren, ReactNode, useMemo, useState } from "react";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { GroupCol } from "src/components/UI";
import main from "src/styles/main.module.scss";
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

/**
 * Тело шага-ФОРМЫ — общий каркас на все помощники.
 *
 * Шаги бывают двух видов: таблица (её тело заполняет область целиком) и форма — поля,
 * переключатели, план операции. Пока каждый помощник размечал форму по-своему, шаги
 * различались отступами и шириной колонок внутри одного экрана: первый шаг выглядел как
 * список приложения, второй — как записка. Здесь каркас тот же, что у форм элементов
 * (FormContainer → FormWrapper → колонка полей + колонка сообщений), поэтому шаг помощника
 * не отличить от обычной формы — и правильно, это она и есть.
 */
export const WizardForm: FC<PropsWithChildren<{ aside?: ReactNode }>> = ({ children, aside }) => (
	<div className={main.FormContainer}>
		<div className={main.FormWrapper}>
			<GroupCol className={main.Form}>{children}</GroupCol>
			{/* Колонка сообщений шага: занимает своё место всегда — появление пояснения не
			    двигает поля под курсором, тот же довод, что и в формах элементов. */}
			<GroupCol className={main.FormNotice}>{aside}</GroupCol>
		</div>
	</div>
);

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
					<Button icon="save" variant="primary" disabled={!!finishBlockedReason || finishing}
						title={finishBlockedReason || finishLabel}
						onClick={onFinish}>
						{finishLabel}
					</Button>
				)}
			</div>
		</div>
	);
};

export default Wizard;
