/**
 * «Проверка ответа клиенту» перед отправкой (E17 СК7.1, пп. 24–25 стандарта).
 *
 * Вставили ответ — «Проверить» — видно, есть ли в нём вывод, рекомендация, статья НПА и дата
 * актуальности нормы, не слишком ли он длинный и не копия ли это текста закона. Это ПОДСКАЗКА,
 * а не запрет: ответ можно отправить и без правок, нарушением сама проверка ничего не делает.
 *
 * Две проверки. Эвристики сервера — мгновенно и всегда: ловят форму ответа. «Проверить моделью» (сервис
 * ai, решено 25.09) — по кнопке, разбор по сути: прямой ли вывод, что рекомендовано, какие статьи названы,
 * уверенный ли тон; модель может предложить краткий вариант ответа. Верна ли норма и действует ли редакция,
 * модель не утверждает — только просит сверить: проверить это она не может, а уверенная ошибка хуже честного
 * «сверьте».
 */
import { type FC, useCallback, useState } from "react";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { FieldDate, FieldTextarea } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { showToast } from "src/components/UIToast";
import { FormArea, GroupCol } from "src/components/UI";
import Notice, { type NoticeItem } from "src/components/Notice";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import { routeError } from "src/services/errors/route";
import { reviewConsultation, reviewConsultationByModel, type ConsultationReview, type ModelReview } from "src/services/quality/api";
import { getAppUtcOffset } from "src/utils/datetime";
import { localYmd } from "src/models/_quality/month";
import QualityChip from "src/models/_quality/QualityChip";
import { fillTemplate } from "src/models/_quality/text";
import { modelChecklist, modelErrorNotice, modelVerdictTone, reviewChecklist, scoreTone } from "./consultation";
import main from "src/styles/main.module.scss";
import styles from "./ConsultationCheck.module.scss";

const COMPONENT = "ConsultationCheckView";

export const ConsultationCheckView: FC<{ uniqId?: string }> = ({ uniqId }) => {
	const [text, setText] = useState("");
	const [question, setQuestion] = useState("");
	const [date, setDate] = useState(() => localYmd(getAppUtcOffset() * 60));
	const [result, setResult] = useState<ConsultationReview | null>(null);
	const [model, setModel] = useState<ModelReview | null>(null);
	const [busy, setBusy] = useState(false);
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	const check = useCallback(async () => {
		if (!text.trim()) return;
		setBusy(true);
		setNotices([]);
		try {
			setResult(await reviewConsultation(text));
		} catch (e) {
			setNotices(routeError(e, { source: translate(COMPONENT), fallback: translate("consultationCheckFailed") }));
		} finally {
			setBusy(false);
		}
	}, [text]);

	const checkByModel = useCallback(async () => {
		if (!text.trim()) return;
		setBusy(true);
		setNotices([]);
		try {
			setModel(await reviewConsultationByModel({ text, question: question.trim() || undefined, date: date || undefined }));
		} catch (e) {
			const known = modelErrorNotice(e);
			setNotices(known
				? [{ type: known.type, text: translate(known.key) }]
				: routeError(e, { source: translate(COMPONENT), fallback: translate("consultationModelFailed") }));
		} finally {
			setBusy(false);
		}
	}, [text, question, date]);

	// Ответ изменился — прежние разборы к нему уже не относятся.
	const changeText = useCallback((value: string) => {
		setText(value);
		setResult(null);
		setModel(null);
	}, []);

	const copyRewrite = useCallback(async () => {
		if (!model?.rewrite) return;
		try {
			await navigator.clipboard.writeText(model.rewrite);
			showToast(translate("consultationModelCopied"), "success");
		} catch {
			showToast(translate("consultationModelCopyFailed"), "warning");
		}
	}, [model]);

	const clear = useCallback(() => {
		setText("");
		setQuestion("");
		setResult(null);
		setModel(null);
		setNotices([]);
	}, []);

	const toolbar = usePaneToolbar(uniqId, (
		<>
			<Button variant="primary" onClick={() => void check()} disabled={busy || !text.trim()}>{translate("consultationCheckRun")}</Button>
			<Button onClick={() => void checkByModel()} disabled={busy || !text.trim()} title={translate("consultationModelHint")}>
				{translate("consultationModelRun")}
			</Button>
			<Button onClick={clear} disabled={busy || (!text && !question && !result && !model)}>{translate("consultationCheckClear")}</Button>
		</>
	));

	const rows = reviewChecklist(result);
	const modelRows = modelChecklist(model);
	const info: NoticeItem[] = [
		{ type: "info", text: translate("consultationCheckInfo") },
		{ type: "info", text: translate("consultationModelInfo") },
	];

	return (
		<>
			{toolbar}
			<div className={main.PaneFill}>
				<div className={styles.Body}>
					<FieldTextarea label={translate("consultationModelQuestion")} name="consultation_check_question" value={question}
						onChange={(e) => { setQuestion(e.target.value); setModel(null); }} rows={3} disabled={busy}
						hint={translate("consultationModelQuestionHint")} />
					<FieldTextarea label={translate("consultationCheckText")} name="consultation_check_text" value={text}
						onChange={(e) => changeText(e.target.value)} rows={12} disabled={busy}
						hint={translate("consultationCheckTextHint")} />
					<FieldDate label={translate("consultationModelDate")} name="consultation_check_date" value={date} width={FIELD_WIDTH.date}
						onChange={(e) => { setDate(e.target.value); setModel(null); }} disabled={busy} hint={translate("consultationModelDateHint")} />

					{result && (
						<FormArea title={translate("consultationCheckResult")}>
							<GroupCol gap={12}>
								<div className={styles.Summary}>
									<QualityChip tone={scoreTone(result.score)}>
										{fillTemplate(translate("consultationCheckScore"), { score: result.score })}
									</QualityChip>
									<span className={main.SettingHint}>{fillTemplate(translate("consultationCheckLength"), { n: result.length })}</span>
								</div>
								<ul className={styles.Checklist}>
									{rows.map((r) => (
										<li key={r.key} className={styles.Check}>
											<QualityChip tone={r.passed ? "ok" : "bad"}>
												{translate(r.passed ? "consultationCheckPassed" : "consultationCheckMissing")}
											</QualityChip>
											<span>{translate(r.labelKey)}</span>
										</li>
									))}
								</ul>
								{result.suggestions.length ? (
									<div className={styles.Suggestions}>
										<span className={main.FormSectionTitle}>{translate("consultationCheckSuggestions")}</span>
										<ul className={styles.SuggestionList}>
											{result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
										</ul>
									</div>
								) : (
									<span className={main.SettingHint}>{translate("consultationCheckAllGood")}</span>
								)}
							</GroupCol>
						</FormArea>
					)}

					{model && (
						<FormArea title={translate("consultationModelResult")}>
							<GroupCol gap={12}>
								<div className={styles.Summary}>
									<QualityChip tone={modelVerdictTone(model)}>
										{translate(model.verdict === "ok" ? "consultationModelVerdictOk" : "consultationModelVerdictWork")}
									</QualityChip>
									<span className={main.SettingHint}>{fillTemplate(translate("consultationCheckScore"), { score: model.score })}</span>
									{model.model && <span className={main.SettingHint}>{model.model}</span>}
								</div>
								<ul className={styles.Checklist}>
									{modelRows.map((r) => (
										<li key={r.key} className={styles.Check}>
											<QualityChip tone={r.ok ? "ok" : "bad"}>
												{translate(r.ok ? "consultationCheckPassed" : "consultationCheckMissing")}
											</QualityChip>
											<span className={styles.ModelCheck}>
												<span>{translate(r.labelKey)}</span>
												{r.note && <span className={main.SettingHint}>{r.note}</span>}
											</span>
										</li>
									))}
								</ul>
								{(model.checks.npa?.articles?.length ?? 0) > 0 && (
									<span className={main.SettingHint}>
										{`${translate("consultationModelArticles")}: ${(model.checks.npa.articles ?? []).join("; ")}`}
									</span>
								)}
								{model.suggestions.length > 0 && (
									<div className={styles.Suggestions}>
										<span className={main.FormSectionTitle}>{translate("consultationCheckSuggestions")}</span>
										<ul className={styles.SuggestionList}>
											{model.suggestions.map((s, i) => <li key={i}>{s}</li>)}
										</ul>
									</div>
								)}
								{model.rewrite && (
									<div className={styles.Suggestions}>
										<span className={main.FormSectionTitle}>{translate("consultationModelRewrite")}</span>
										<div className={styles.Rewrite}>{model.rewrite}</div>
										<div className={styles.RewriteActions}>
											<Button onClick={() => void copyRewrite()}>{translate("consultationModelCopy")}</Button>
											<Button onClick={() => changeText(model.rewrite ?? "")}>{translate("consultationModelUseRewrite")}</Button>
										</div>
									</div>
								)}
								<span className={main.SettingHint}>{translate("consultationModelNormWarning")}</span>
							</GroupCol>
						</FormArea>
					)}
				</div>
			</div>
			<Notice items={[...info, ...notices]} />
		</>
	);
};
ConsultationCheckView.displayName = COMPONENT;

export default ConsultationCheckView;
