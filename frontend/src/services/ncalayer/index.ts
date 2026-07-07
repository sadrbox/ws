// ─────────────────────────────────────────────────────────────────────────────
// NCALayer — клиент браузерной ЭЦП (НУЦ РК). Подпись выполняется ключом
// пользователя локально; приватный ключ НЕ покидает машину клиента.
//
// NCALayer слушает локальный WebSocket wss://127.0.0.1:13579. Здесь реализован
// «классический» модуль kz.gov.pki.knca.commonUtils (метод signXml) — им
// подписывается XML ЭСФ (XMLDSIG) перед отправкой в ИС ЭСФ (UploadInvoiceService.
// syncInvoice), а также, при необходимости, данные сессии (SessionService).
//
// Требование: у пользователя установлен и запущен NCALayer. Если недоступен —
// возвращаем понятную ошибку (NcaLayerUnavailableError).
// ─────────────────────────────────────────────────────────────────────────────

const NCALAYER_URL = "wss://127.0.0.1:13579";
const CONNECT_TIMEOUT_MS = 8000;
const RESPONSE_TIMEOUT_MS = 120_000; // ожидание действия пользователя (выбор ключа/PIN)

/** Тип ключа: подпись документов или аутентификация (для сессии). */
export type NcaKeyType = "SIGNATURE" | "AUTHENTICATION";

/** Тип хранилища ключей NCALayer. */
export type NcaStorageType = "PKCS12" | "AKKZakenca" | "AKKaspitoken" | "AKEtoken";

export class NcaLayerUnavailableError extends Error {
	constructor(message = "NCALayer недоступен. Запустите NCALayer и повторите.") {
		super(message);
		this.name = "NcaLayerUnavailableError";
	}
}

export class NcaLayerSignError extends Error {
	/** Код/сообщение из ответа NCALayer (например отмена пользователем). */
	constructor(message: string) {
		super(message);
		this.name = "NcaLayerSignError";
	}
}

interface NcaResponse {
	result?: unknown;
	// Разные версии NCALayer отдают код по-разному: code/responseCode ("200"/"500").
	code?: string;
	responseCode?: string;
	message?: string;
	errorCode?: string;
}

/** Открывает WS-соединение с NCALayer (с таймаутом). */
function connect(): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let ws: WebSocket;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			try { ws?.close(); } catch { /* ignore */ }
			reject(new NcaLayerUnavailableError());
		}, CONNECT_TIMEOUT_MS);

		try {
			ws = new WebSocket(NCALAYER_URL);
		} catch {
			clearTimeout(timer);
			reject(new NcaLayerUnavailableError());
			return;
		}
		ws.onopen = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(ws);
		};
		ws.onerror = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(new NcaLayerUnavailableError());
		};
	});
}

/** Отправляет один запрос в NCALayer и ждёт единственный ответ. */
function request(ws: WebSocket, payload: unknown): Promise<NcaResponse> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new NcaLayerSignError("Истекло время ожидания ответа NCALayer"));
		}, RESPONSE_TIMEOUT_MS);

		ws.onmessage = (ev) => {
			clearTimeout(timer);
			try {
				resolve(JSON.parse(ev.data as string) as NcaResponse);
			} catch {
				reject(new NcaLayerSignError("Некорректный ответ NCALayer"));
			}
		};
		ws.onerror = () => {
			clearTimeout(timer);
			reject(new NcaLayerUnavailableError());
		};
		ws.send(JSON.stringify(payload));
	});
}

/** Успешен ли ответ NCALayer (код 200 в любом из полей). */
function isOk(resp: NcaResponse): boolean {
	const code = resp.code ?? resp.responseCode;
	return code === "200" || code === undefined && typeof resp.result === "string";
}

/**
 * Подписывает XML через NCALayer (XMLDSIG, модуль commonUtils.signXml).
 * @returns подписанный XML (с элементом <ds:Signature>).
 * @throws NcaLayerUnavailableError — NCALayer не запущен;
 *         NcaLayerSignError — отмена пользователем / ошибка подписи.
 */
export async function signXml(
	xml: string,
	opts?: { keyType?: NcaKeyType; storageType?: NcaStorageType },
): Promise<string> {
	const keyType = opts?.keyType ?? "SIGNATURE";
	const storageType = opts?.storageType ?? "PKCS12";
	const ws = await connect();
	try {
		const resp = await request(ws, {
			module: "kz.gov.pki.knca.commonUtils",
			method: "signXml",
			// [storageType, keyType, xmlToSign, callBack, tokenPath] — последние 2 пустые.
			args: [storageType, keyType, xml, "", ""],
		});
		if (!isOk(resp) || typeof resp.result !== "string") {
			throw new NcaLayerSignError(resp.message || "Подпись не выполнена (NCALayer)");
		}
		return resp.result;
	} finally {
		try { ws.close(); } catch { /* ignore */ }
	}
}

/** Информация о выбранном ключе NCALayer. */
export interface NcaKeyInfo {
	/** ИИН владельца ключа (из subjectDN), если удалось извлечь. */
	iin: string | null;
	/** БИН организации (из subjectDN), если есть. */
	bin: string | null;
	/** PEM/Base64 X.509 сертификата, если вернул NCALayer. */
	certificate: string | null;
	/** Полный subjectDN. */
	subjectDn: string | null;
}

/** Извлекает 12-значный ИИН/БИН из subjectDN (форматы IIN…/BIN…/SERIALNUMBER=IIN…). */
function extractId(subjectDn: string | undefined, prefix: "IIN" | "BIN"): string | null {
	if (!subjectDn) return null;
	const m = subjectDn.match(new RegExp(`${prefix}\\s*=?\\s*(\\d{12})`, "i"))
		|| subjectDn.match(new RegExp(`${prefix}(\\d{12})`, "i"));
	return m ? m[1] : null;
}

/**
 * Возвращает информацию о ключе (в т.ч. ИИН владельца) без подписи данных.
 * Нужна, чтобы построить тикет аутентификации ЭСФ с корректным ИИН.
 */
export async function getKeyInfo(
	opts?: { keyType?: NcaKeyType; storageType?: NcaStorageType },
): Promise<NcaKeyInfo> {
	const keyType = opts?.keyType ?? "AUTHENTICATION";
	const storageType = opts?.storageType ?? "PKCS12";
	const ws = await connect();
	try {
		const resp = await request(ws, {
			module: "kz.gov.pki.knca.commonUtils",
			method: "getKeyInfo",
			args: [storageType],
		});
		if (!isOk(resp)) {
			throw new NcaLayerSignError(resp.message || "Не удалось получить данные ключа");
		}
		const r = (resp.result ?? {}) as Record<string, unknown>;
		const subjectDn = (r.subjectDn as string) ?? (r.subjectDN as string) ?? null;
		return {
			iin: (r.iin as string) ?? extractId(subjectDn ?? undefined, "IIN"),
			bin: (r.bin as string) ?? extractId(subjectDn ?? undefined, "BIN"),
			certificate: (r.pem as string) ?? (r.cert as string) ?? (r.certificate as string) ?? null,
			subjectDn,
		};
	} finally {
		try { ws.close(); } catch { /* ignore */ }
	}
	// keyType намеренно не передаётся в getKeyInfo (NCALayer принимает только storageType).
	void keyType;
}

/**
 * Подписывает несколько XML одной сессией NCALayer (одно соединение) —
 * например пакетная отправка ЭСФ. Сохраняет порядок.
 */
export async function signXmls(
	xmls: string[],
	opts?: { keyType?: NcaKeyType; storageType?: NcaStorageType },
): Promise<string[]> {
	const keyType = opts?.keyType ?? "SIGNATURE";
	const storageType = opts?.storageType ?? "PKCS12";
	const ws = await connect();
	const out: string[] = [];
	try {
		for (const xml of xmls) {
			const resp = await request(ws, {
				module: "kz.gov.pki.knca.commonUtils",
				method: "signXml",
				args: [storageType, keyType, xml, "", ""],
			});
			if (!isOk(resp) || typeof resp.result !== "string") {
				throw new NcaLayerSignError(resp.message || "Подпись не выполнена (NCALayer)");
			}
			out.push(resp.result);
		}
		return out;
	} finally {
		try { ws.close(); } catch { /* ignore */ }
	}
}
