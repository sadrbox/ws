// ─────────────────────────────────────────────────────────────────────────────
// Парсер банковских выписок (T8.1). Два формата:
//   • «1CClientBankExchange» — де-факто стандарт обмена банк↔учётная система в
//     РК/РФ (текст key=value, секции СекцияДокумент…КонецДокумента);
//   • CSV — с шапкой-заголовком (маппинг колонок по именам).
//
// Парсер ЧИСТЫЙ (без БД/сети) — тестируется headless. Возвращает нормализованные
// движения; направление (приход/расход) и резолв контрагента — уже в сервисе
// импорта (нужен счёт организации и БД).
// ─────────────────────────────────────────────────────────────────────────────

/** «DD.MM.YYYY» → ISO-строка (полночь UTC) или null. */
function parseRuDate(s) {
	const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((s || "").trim());
	if (!m) return null;
	const [, d, mo, y] = m;
	return `${y}-${mo}-${d}T00:00:00.000Z`;
}

/** Сумма «1 000,50» / «1000.50» → number. */
function parseAmount(s) {
	if (s == null) return 0;
	const n = Number(String(s).replace(/\s/g, "").replace(",", "."));
	return Number.isFinite(n) ? n : 0;
}

/** Нормализация счёта/IBAN: без пробелов, в верхнем регистре. */
export function normalizeAccount(s) {
	return (s || "").replace(/\s/g, "").toUpperCase();
}

/**
 * Разобрать формат 1CClientBankExchange.
 * @returns {{ format:"1c", ownerAccount:string|null, movements:object[] }}
 */
export function parse1C(text) {
	const lines = String(text).split(/\r?\n/);
	let ownerAccount = null;
	const movements = [];
	let cur = null; // текущий документ (внутри СекцияДокумент…КонецДокумента)

	// key=value (значение может содержать «=», поэтому split по первому «=»).
	const kv = (line) => {
		const i = line.indexOf("=");
		return i < 0 ? [line.trim(), ""] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
	};

	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;
		const [key, val] = kv(line);

		if (cur === null) {
			// Вне документа: ловим счёт владельца выписки.
			if (key === "РасчСчет" && val && !ownerAccount) ownerAccount = val;
			if (key === "СекцияДокумент") cur = {};
			continue;
		}
		// Внутри документа.
		if (key === "КонецДокумента") {
			movements.push(finalize1C(cur));
			cur = null;
			continue;
		}
		cur[key] = val;
	}
	return { format: "1c", ownerAccount: ownerAccount ? normalizeAccount(ownerAccount) : null, movements };
}

/** Поля документа 1С → нормализованное движение. */
function finalize1C(d) {
	// ИНН/БИН и наименование бывают под разными ключами в разных выгрузках.
	const pick = (...keys) => { for (const k of keys) if (d[k]) return d[k]; return ""; };
	return {
		number: pick("Номер") || null,
		date: parseRuDate(pick("Дата")),
		amount: parseAmount(pick("Сумма")),
		payerAccount: normalizeAccount(pick("ПлательщикСчет", "ПлательщикРасчСчет")),
		payerName: pick("Плательщик", "ПлательщикНаименование", "Плательщик1"),
		payerBin: pick("ПлательщикБИН", "ПлательщикИНН"),
		payeeAccount: normalizeAccount(pick("ПолучательСчет", "ПолучательРасчСчет")),
		payeeName: pick("Получатель", "ПолучательНаименование", "Получатель1"),
		payeeBin: pick("ПолучательБИН", "ПолучательИНН"),
		purpose: pick("НазначениеПлатежа", "Назначение"),
	};
}

// ── CSV ──────────────────────────────────────────────────────────────────────
// Синонимы заголовков колонок (нижний регистр, без пробелов) → каноническое поле.
const CSV_ALIASES = {
	number: ["номер", "number", "no", "№", "докномер"],
	date: ["дата", "date", "датаоперации"],
	amount: ["сумма", "amount", "sum"],
	payeraccount: ["плательщиксчет", "payeraccount", "счетплательщика"],
	payername: ["плательщик", "payername", "плательщикнаименование"],
	payerbin: ["плательщикбин", "плательщикинн", "payerbin", "бинплательщика"],
	payeeaccount: ["получательсчет", "payeeaccount", "счетполучателя"],
	payeename: ["получатель", "payeename", "получательнаименование"],
	payeebin: ["получательбин", "получательинн", "payeebin", "бинполучателя"],
	purpose: ["назначениеплатежа", "назначение", "purpose", "комментарий"],
	direction: ["направление", "тип", "direction", "дебеткредит"],
};

/** Разбить строку CSV на ячейки (разделитель «;» или «,», кавычки). */
function splitCsvLine(line, sep) {
	const out = [];
	let cell = "", inQ = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (inQ) {
			if (c === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
			else cell += c;
		} else if (c === '"') inQ = true;
		else if (c === sep) { out.push(cell); cell = ""; }
		else cell += c;
	}
	out.push(cell);
	return out.map((s) => s.trim());
}

/**
 * Разобрать CSV с шапкой. Разделитель определяется по первой строке (;/,).
 * @returns {{ format:"csv", ownerAccount:null, movements:object[] }}
 */
export function parseCsv(text) {
	const rows = String(text).split(/\r?\n/).filter((l) => l.trim());
	if (!rows.length) return { format: "csv", ownerAccount: null, movements: [] };
	const sep = (rows[0].match(/;/g)?.length ?? 0) >= (rows[0].match(/,/g)?.length ?? 0) ? ";" : ",";
	const header = splitCsvLine(rows[0], sep).map((h) => h.toLowerCase().replace(/\s|_/g, ""));
	// Индекс колонки для каждого канонического поля.
	const colOf = {};
	for (const [field, aliases] of Object.entries(CSV_ALIASES)) {
		const idx = header.findIndex((h) => aliases.includes(h));
		if (idx >= 0) colOf[field] = idx;
	}
	const at = (cells, field) => (colOf[field] != null ? cells[colOf[field]] ?? "" : "");
	const movements = [];
	for (let r = 1; r < rows.length; r++) {
		const cells = splitCsvLine(rows[r], sep);
		const dir = at(cells, "direction").toLowerCase();
		movements.push({
			number: at(cells, "number") || null,
			date: parseRuDate(at(cells, "date")) || isoOrNull(at(cells, "date")),
			amount: parseAmount(at(cells, "amount")),
			payerAccount: normalizeAccount(at(cells, "payeraccount")),
			payerName: at(cells, "payername"),
			payerBin: at(cells, "payerbin"),
			payeeAccount: normalizeAccount(at(cells, "payeeaccount")),
			payeeName: at(cells, "payeename"),
			payeeBin: at(cells, "payeebin"),
			purpose: at(cells, "purpose"),
			// Явное направление из CSV (если колонка есть): расход/дебет vs приход/кредит.
			explicitDirection: dir ? (/расход|дебет|out|списан/.test(dir) ? "out" : /приход|кредит|in|поступл/.test(dir) ? "in" : null) : null,
		});
	}
	return { format: "csv", ownerAccount: null, movements };
}

// ── MT940 (SWIFT) ─────────────────────────────────────────────────────────────
// Выписка тегами `:NN:значение` (значение может продолжаться на следующих строках
// до нового тега). Ключевые теги: :25: счёт владельца, :61: строка операции
// (дата, признак D/C, сумма, ссылка), :86: назначение/реквизиты (свободный формат,
// банк-специфичный). Направление берём из D/C-признака (от лица владельца счёта).

/** «YYMMDD» → ISO (полночь UTC), век 20xx. */
function parseMtDate(s) {
	const m = /^(\d{2})(\d{2})(\d{2})$/.exec(s || "");
	if (!m) return null;
	return `20${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
}

/** Разобрать значение тега :61: (6!n[4!n]2a15d…). */
function parse61(value) {
	// valueDate(6) [entryDate(4)] mark(C|D|RC|RD) amount(до буквы N/типа операции)
	const m = /^(\d{6})(\d{4})?(RC|RD|C|D)([0-9.,]+)/.exec(value.trim());
	if (!m) return null;
	const [, vdate, , mark, amt] = m;
	// Ссылка: после суммы/типа, часть до «//» — банковская, после — наш номер.
	const refPart = value.split("//")[1] || "";
	const ref = refPart.split(/\r?\n/)[0].trim();
	return {
		date: parseMtDate(vdate),
		mark,
		amount: parseAmount(amt),
		reference: ref || null,
	};
}

/** :61: + :86: → нормализованное движение (сторона — из D/C). */
function finalizeMt(p) {
	// C / RD → приход владельцу; D / RC → расход.
	const dir = (p.mark === "C" || p.mark === "RD") ? "in" : "out";
	// Контрагент из :86: — свободный формат, берём как имя (без БИН).
	const cpName = (p.details || "").trim();
	return {
		number: p.reference || null,
		date: p.date,
		amount: p.amount,
		payerAccount: "", payeeAccount: "",
		// Имя контрагента кладём в обе стороны — сервис возьмёт нужную по направлению.
		payerName: cpName, payeeName: cpName,
		payerBin: "", payeeBin: "",
		purpose: cpName,
		explicitDirection: dir,
	};
}

/**
 * Разобрать MT940. Поддерживает как «голые» теги, так и SWIFT-блок {4:…-}.
 * @returns {{ format:"mt940", ownerAccount:string|null, movements:object[] }}
 */
export function parseMT940(text) {
	const raw = String(text).replace(/\r/g, "");
	const body = /\{4:([\s\S]*?)-?\}/.exec(raw)?.[1] ?? raw;
	// Собираем поля :TAG:value с учётом переноса значения на следующие строки.
	const fields = [];
	let cur = null;
	for (const line of body.split("\n")) {
		const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
		if (m) { if (cur) fields.push(cur); cur = { tag: m[1].replace(/[A-Z]$/, ""), value: m[2] }; }
		else if (cur) cur.value += `\n${line}`;
	}
	if (cur) fields.push(cur);

	let ownerAccount = null;
	const movements = [];
	let pending = null;
	const flush = () => { if (pending) { const mv = finalizeMt(pending); if (mv.date) movements.push(mv); pending = null; } };
	for (const f of fields) {
		if (f.tag === "25") ownerAccount = normalizeAccount((f.value.split("/").pop() || f.value).trim());
		else if (f.tag === "61") { flush(); pending = parse61(f.value); }
		else if (f.tag === "86" && pending) pending.details = f.value.replace(/\n/g, " ").trim();
	}
	flush();
	return { format: "mt940", ownerAccount, movements };
}

/** Если строка уже ISO-подобна — принять, иначе null. */
function isoOrNull(s) {
	const t = (s || "").trim();
	return /^\d{4}-\d{2}-\d{2}/.test(t) ? new Date(t).toISOString() : null;
}

/**
 * Универсальный вход: определить формат по сигнатуре и разобрать.
 * @returns {{ format:string, ownerAccount:string|null, movements:object[] }}
 */
export function parseBankStatement(text) {
	let head = String(text).slice(0, 200);
	if (head.charCodeAt(0) === 0xFEFF) head = head.slice(1); // срезаем BOM
	if (/^\s*1CClientBankExchange/i.test(head)) return parse1C(text);
	// MT940: SWIFT-блок {1:…} или наличие тегов операций :61: (+ :20:/:25:).
	if (/\{1:/.test(head) || /(^|\n):61:/.test(text)) return parseMT940(text);
	return parseCsv(text);
}

export default { parseBankStatement, parse1C, parseCsv, parseMT940, normalizeAccount };
