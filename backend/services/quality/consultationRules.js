// Проверка ответа клиенту (E17 СК7, пп. 24–25) — эвристики без модели, чистые функции.
//
// Стандарт: ответ краткий, понятный и предметный — вывод, рекомендация, конкретная статья
// НПА и актуальность нормы на дату консультации; многостраничные тексты законодательства
// вместо консультации недопустимы. Это ПОДСКАЗКА до отправки, а не запрет и не нарушение.
//
// Эвристики ловят форму, а не суть. Разбор по существу — «Проверить моделью» на том же экране (сервис ai,
// POST /v1/quality/review-answer, решено 25.09); верна ли норма и действует ли редакция, не подтверждает и
// модель — для этого нужен источник действующих текстов НПА (ai/src/quality/review.ts).

const has = (re, text) => re.test(text);

const CONCLUSION_RE = /(^|\n|\.\s)(вывод|итог|итого|ответ|таким образом|следовательно|да[,.]|нет[,.]|можно[,.]|нельзя[,.]|обязан[аы]?|не обязан)/iu;
const RECOMMENDATION_RE = /(рекоменд|предлагаем|советуем|необходимо|нужно|следует|надо|просим|сделайте|подайте|оформите|отразите)/iu;
const NPA_ARTICLE_RE = /(стать[яиеюё]|ст\.)\s*\d+|п(ункт|\.)\s*\d+\s*(ст(\.|ать))/iu;
const NPA_ACT_RE = /(налогов\w* кодекс|нк\s*рк|трудов\w* кодекс|тк\s*рк|гражданск\w* кодекс|гк\s*рк|кодекс\w*|закон\w*|приказ\w*|постановлени\w*|правил\w*)/iu;
const ACTUALITY_RE = /(по состоянию на|актуальн\w*|в редакции|действу\w* с|на дату|с\s+1\s+января|\b\d{2}\.\d{2}\.\d{4}\b|\b20\d{2}\s*г)/iu;
/** «Простыня» закона: много «Статья N.» подряд — это копия кодекса, а не консультация. */
const LAW_HEADING_RE = /(^|\n)\s*стать[яи]\s+\d+[.\s]/giu;

/**
 * @param {string} text
 * @param {{maxLength?:number}} opts
 * @returns {{ok:boolean, score:number, checks:object, suggestions:string[], length:number}}
 */
export function reviewConsultation(text, { maxLength = 1500 } = {}) {
	const t = String(text ?? "").trim();
	const lawHeadings = (t.match(LAW_HEADING_RE) || []).length;
	const checks = {
		conclusion: has(CONCLUSION_RE, t),
		recommendation: has(RECOMMENDATION_RE, t),
		npa: has(NPA_ARTICLE_RE, t) && has(NPA_ACT_RE, t),
		actuality: has(ACTUALITY_RE, t),
		length: t.length > 0 && t.length <= maxLength,
		notLawDump: lawHeadings < 3,
	};
	const suggestions = [];
	if (!t) suggestions.push("Ответ пуст.");
	if (!checks.conclusion) suggestions.push("Нет вывода: начните с прямого ответа на вопрос («да, можно…», «нет, обязаны…», «вывод: …»).");
	if (!checks.recommendation) suggestions.push("Нет рекомендации: что клиенту сделать и к какому сроку.");
	if (!checks.npa) suggestions.push("Нет ссылки на конкретную статью НПА: номер статьи и сам акт («ст. … НК РК»).");
	if (!checks.actuality) suggestions.push("Не указана актуальность нормы на дату консультации («в редакции на 25.09.2026»).");
	if (!checks.length) suggestions.push(`Ответ длиннее ${maxLength} знаков: сократите до вывода, рекомендации и ссылки.`);
	if (!checks.notLawDump) suggestions.push("Похоже на текст закона: вместо цитаты статей дайте вывод и ссылку на статью.");
	const passed = Object.values(checks).filter(Boolean).length;
	const score = Math.round((passed / Object.keys(checks).length) * 100);
	return { ok: suggestions.length === 0, score, checks, suggestions, length: t.length };
}

export default { reviewConsultation };
