/**
 * ЧТО ИМЕННО МЕНЯЕМ У ПОЛЬЗОВАТЕЛЯ БАЗЫ — расчёт отдельно от формы.
 *
 * ЗАЧЕМ ОТДЕЛЬНО. Правило простое на словах и легко теряемое в разметке: в команду уходит
 * ТОЛЬКО ИЗМЕНЁННОЕ. Оно уже терялось — и дорого: поле «Показывать в списке выбора» форма
 * не умела прочитать (в ответе `IB_LIST_USERS` его нет), подставляла «включено» как факт и
 * отправляла при каждом «Применить». Правка полного имени молча включала показ в списке
 * тому, у кого он был выключен. Здесь это правило — функция, которую проверяет тест.
 *
 * ТРИ РОДА ПОЛЕЙ, и обращаются с ними по-разному:
 *   известное (полное имя, признак отключения) — сравниваем с тем, что пришло из базы;
 *   непрочитываемое (показ в списке) — трёхзначно: `null` значит «не менять», и в команду
 *     не попадает вовсе;
 *   недоступное (пароль) — уходит только введённое, прочитать его неоткуда.
 */

/** Что панель знает о пользователе в ЭТОЙ базе — из реестра. */
export type UserCurrent = {
	fullName: string;
	disabled: boolean;
	/** `null` — агент не сообщает это значение (см. миграцию 019). */
	showInList: boolean | null;
};

/** Что стоит в полях формы. */
export type UserDraft = {
	/** Имя входа: отличается от текущего — значит, просят переименовать. */
	name: string;
	fullName: string;
	password: string;
	disabled: boolean;
	showInList: boolean | null;
};

/**
 * Тело команды `IB_UPDATE_USER` — или `null`, если менять нечего.
 *
 * `name` всегда остаётся АДРЕСОМ: им команда находит пользователя в базе. Новое имя едет
 * отдельным полем `newName`, иначе правка полного имени выглядела бы как переименование.
 */
/**
 * ДАННЫЕ ИЗ БАЗЫ ОБНОВИЛИСЬ — НЕ ЗАТИРАТЬ ТО, ЧТО ЧЕЛОВЕК УЖЕ ИЗМЕНИЛ.
 *
 * ЖИВОЙ СЛУЧАЙ (14.09). «Показывать в списке выбора» «не сохраняется»: агент признак пишет и
 * читает верно (проверено на `_transition`), но команда уходила без `showInList`. Карточка
 * сбрасывала форму к данным базы при КАЖДОМ перечитывании списка пользователей, а он
 * перечитывается после любой завершённой операции и опросом заданий: человек переключил
 * тумблер, рядом закончилась правка ролей — переключение пропало до «Записать».
 *
 * Правило: поле, которое человек не трогал (равно прежнему значению из базы), берёт новое;
 * изменённое остаётся. Полный сброс — только при смене пользователя или базы (это делает
 * вызывающий).
 */
export function rebaseForm<T extends Record<string, unknown>>(prev: T, next: T, form: T): T {
	const out = { ...form };
	for (const k of Object.keys(next) as (keyof T)[]) {
		if (form[k] === prev[k]) out[k] = next[k];
	}
	return out;
}

export function buildUserUpdate(
	userName: string, current: UserCurrent, draft: UserDraft,
): Record<string, unknown> | null {
	const rename = draft.name.trim() && draft.name.trim() !== userName ? draft.name.trim() : "";
	const fullNameChanged = draft.fullName.trim() !== (current.fullName ?? "").trim();
	const disabledChanged = draft.disabled !== current.disabled;
	const showChanged = draft.showInList !== null && draft.showInList !== current.showInList;

	if (!rename && !fullNameChanged && !draft.password && !disabledChanged && !showChanged) return null;

	return {
		name: userName,
		...(rename ? { newName: rename } : {}),
		...(fullNameChanged ? { fullName: draft.fullName.trim() } : {}),
		...(draft.password ? { password: draft.password } : {}),
		...(disabledChanged ? { disabled: draft.disabled } : {}),
		...(showChanged ? { showInList: draft.showInList } : {}),
	};
}

/**
 * ПЛАН ЗАПИСИ: база → одна команда со всеми её изменениями.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ ФОРМЫ. Здесь живёт правило «куда команда НЕ уходит», и оно уже
 * сработало не туда. Отсев задумывался для ЧУЖИХ баз: посылать изменение в базу, где
 * человека нет, — гарантированный отказ. Но список «где человек есть» берётся из сводки
 * реестра, а она наполняется отдельно и отстаёт — например, у пользователя, которого
 * только что создали. И отсев съедал СОБСТВЕННУЮ базу карточки: переключение «Отключен»
 * или «Показывать в списке выбора» отвечало двумя сообщениями подряд — «пропущены базы,
 * где этого пользователя нет: _transition» и «задание поставлено: 0», то есть правка
 * молча не применялась (живой случай 12.09).
 *
 * БАЗА КАРТОЧКИ НЕ ОТСЕИВАЕТСЯ НИКОГДА. Карточку открыли ДЛЯ этой пары — из списка
 * пользователей самой базы; она и есть ответ на вопрос «где человек есть», а сводка
 * по всем базам — лишь отставшая копия этого знания. Отсев остаётся для остальных баз.
 */
export function buildSavePlan(input: {
	/** База карточки — та, что выбрана в «Основном». */
	baseKey: string;
	/** Имя входа: адрес пользователя в команде. */
	userName: string;
	/** Изменения реквизитов (buildUserUpdate) — они всегда про базу карточки. */
	profileUpdate: Record<string, unknown> | null;
	/** Изменения ролей по базам: база → что добавить и что снять. */
	rolesByBase: Map<string, { add: string[]; remove: string[] }>;
	/** Базы, в которых человек заведён по сводке реестра (регистр букв не важен). */
	knownBases: string[];
}): {
	/** База → тело команды IB_UPDATE_USER. Порядок: база карточки первой. */
	plan: Map<string, Record<string, unknown>>;
	/** Базы, куда команда не пойдёт: человека там нет. */
	skipped: string[];
} {
	const plan = new Map<string, Record<string, unknown>>();
	const own = input.baseKey.trim();

	if (input.profileUpdate && own) plan.set(own, input.profileUpdate);

	for (const [base, { add, remove }] of input.rolesByBase) {
		// Регистр букв в ключе базы берём из базы карточки, когда речь о ней: черновик
		// ролей хранит ключи в нижнем регистре, а команда адресует базу как она названа.
		const isOwn = !!own && base.toLowerCase() === own.toLowerCase();
		const target = isOwn ? own : base;
		const entry = plan.get(target) ?? { name: input.userName };
		/*
		 * РОЛИ УХОДЯТ ПОПРАВКАМИ. Агент со способностью `ib.roles` применяет `addRoles`/
		 * `removeRoles` в соединении записи и возвращает новое состояние в эхе; сервис сверяет
		 * его с поправками (checkRoleIntent). Полный набор `roles` панель больше не шлёт: его
		 * пришлось бы считать по чтению перед записью — лишний вход в базу и гонка с
		 * конфигуратором (docs/TASK_PANEL_ROLES_WITHOUT_PREREAD.md).
		 */
		if (add.length) entry.addRoles = add;
		if (remove.length) entry.removeRoles = remove;
		plan.set(target, entry);
	}

	const known = new Set(input.knownBases.map((b) => b.toLowerCase()));
	const skipped: string[] = [];
	for (const base of [...plan.keys()]) {
		if (own && base.toLowerCase() === own.toLowerCase()) continue;
		if (known.has(base.toLowerCase())) continue;
		skipped.push(base);
		plan.delete(base);
	}

	return { plan, skipped };
}

/**
 * МАССОВАЯ ПРАВКА РОЛЕЙ — то, что нужно подтвердить словами, прежде чем отправлять.
 *
 * ЖИВОЙ СЛУЧАЙ (12–13.09). Пользователю «Оператор бухгалтер» в базе `_transition` за одну
 * запись выдали ВСЕ 331 роль конфигурации (было 102), а утром одной записью попытались снять
 * все до единой. Оба действия делаются одним щелчком по заголовку таблицы ролей, выглядят в
 * интерфейсе как любая другая правка — и оба меняют права человека целиком. Агент второе не
 * применил, но это случайность сборки, а не защита.
 *
 * Правило: подтверждение просим, когда правка снимает ВСЕ роли или трогает больше
 * MASS_ROLES ролей разом. Мелкая правка («выдать „Кассир“») проходит без вопросов — окно на
 * каждое нажатие приучило бы нажимать «Да» не читая.
 */
export const MASS_ROLES = 20;

/**
 * АДМИНИСТРАТИВНЫЕ РОЛИ — их выдача подтверждается всегда, даже одной.
 *
 * ЖИВОЙ СЛУЧАЙ (12–13.09): оператору в `_transition` записаны наборы из 102 и 331 роли, и в
 * обоих были `ПолныеПрава` и `АдминистраторСистемы` — полный доступ к базе. Окно массовой
 * правки называло только число («добавить 229»), и что среди них права администратора, из
 * числа не видно. Имена — из типовых конфигураций на БСП (сверено со справочником ролей
 * `_transition`); сравнение без учёта регистра, как и везде у ролей 1С.
 */
export const PRIVILEGED_ROLES: readonly string[] = [
	"ПолныеПрава", "АдминистраторСистемы", "Администрирование", "ПравоАдминистрирования",
	"ЗапускТолстогоКлиента", "ЗапускВнешнегоСоединения", "ЗапускAutomation",
	"ИнтерактивноеОткрытиеВнешнихОтчетовИОбработок", "ОбновлениеКонфигурацииБазыДанных",
	"УдаленныйДоступАдминистрированиеИБВМоделиСервиса",
];

export type MassRoleChange = {
	/**
	 * removeAll — после правки у пользователя не останется ни одной роли;
	 * many — меняется больше MASS_ROLES ролей; privileged — правка мелкая, но выдаёт
	 * административную роль.
	 */
	kind: "removeAll" | "many" | "privileged";
	/** Выдаваемые административные роли — поимённо, как их назвали в правке. */
	privileged: string[];
	added: number;
	removed: number;
	/** Сколько ролей у пользователя сейчас и сколько станет. */
	before: number;
	after: number;
};

export function massRoleChange(
	current: string[], changes: { add: string[]; remove: string[] },
): MassRoleChange | null {
	const after = applyRoleChanges(current, changes);
	const norm = (s: string) => s.trim().toLowerCase();
	const had = new Set(current.map(norm));
	const now = new Set(after.map(norm));
	const added = [...now].filter((r) => !had.has(r)).length;
	const removed = [...had].filter((r) => !now.has(r)).length;
	const admin = new Set(PRIVILEGED_ROLES.map(norm));
	const privileged: string[] = [];
	for (const r of changes.add) {
		const key = norm(r);
		if (admin.has(key) && !had.has(key) && !privileged.some((x) => norm(x) === key)) privileged.push(r.trim());
	}
	const base = { privileged, added, removed, before: current.length, after: after.length };
	if (current.length > 0 && after.length === 0) return { kind: "removeAll", ...base };
	if (added + removed > MASS_ROLES) return { kind: "many", ...base };
	if (privileged.length) return { kind: "privileged", ...base };
	return null;
}

/**
 * Полный набор ролей после правки: что было в базе, минус снятое, плюс выданное.
 *
 * Порядок сохраняем — сначала прежние роли, затем новые: набор уходит в 1С и попадает в
 * журнал команды, и одинаковая правка не должна выглядеть разной из-за перестановки.
 * Сравнение имён без учёта регистра: 1С отдаёт их как в конфигурации, а поправки приходят
 * из отметок таблицы.
 */
export function applyRoleChanges(
	current: string[], changes: { add: string[]; remove: string[] },
): string[] {
	const norm = (s: string) => s.trim().toLowerCase();
	const drop = new Set(changes.remove.map(norm));
	const out = current.filter((r) => !drop.has(norm(r)));
	const have = new Set(out.map(norm));
	for (const r of changes.add) {
		if (have.has(norm(r))) continue;
		out.push(r);
		have.add(norm(r));
	}
	return out;
}

/**
 * КАКИЕ РОЛИ ВООБЩЕ ПРЕДЛАГАТЬ В КАРТОЧКЕ ОДНОЙ БАЗЫ.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09, 23:43). Карточка предлагала роли из ОБЩЕГО справочника — объединения
 * по всем базам панели, — и запись закончилась отказом агента: «в базе „_transition“ нет
 * ролей: ДобавлениеИзменениеКорректировкаПоступления, …». Набор ролей задаёт КОНФИГУРАЦИЯ:
 * у «Бухгалтерии» и «ERP» он разный, а команда уходит в ОДНУ базу — роли чужой конфигурации
 * в ней не существуют, и вся правка отвергается целиком.
 *
 * Правило: предлагаем справочник ЭТОЙ базы плюс то, что человеку в ней уже выдано (иначе
 * выданную роль нельзя ни увидеть, ни снять — строки для неё не будет).
 */
export function roleCatalog(baseRoles: string[], grantedHere: string[]): string[] {
	// Регистр букв в имени роли 1С не различает, и две строки «Кассир»/«кассир» — одна и та
	// же роль: показать их двумя отметками значит предложить снять одну и оставить другую.
	// Написание берём от выданного (так его называет сама база), поэтому оно идёт первым.
	const seen = new Set<string>();
	const out: string[] = [];
	for (const role of [...grantedHere, ...baseRoles]) {
		const name = (role ?? "").trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(name);
	}
	return out.sort((a, b) => a.localeCompare(b, "ru"));
}
