import { useCallback, useRef, useState } from "react";
import { getKeyInfo, NcaLayerUnavailableError } from "src/services/ncalayer";
import { useNcaLayerSign } from "src/hooks/useNcaLayerSign";
import {
	requestAuthTicket, createSession, buildInvoiceXml,
	syncInvoice, refreshStatus, getInvoiceErrors,
	type EsfSyncResult, type EsfStatusResult, type EsfError,
} from "src/services/esf/api";

interface EsfInvoiceState {
	/** Идёт операция ЭСФ (подпись/обмен). */
	busy: boolean;
	/** Последняя ошибка (человекочитаемая) или null. */
	error: string | null;
	/** Детальные ошибки ИС ЭСФ по документу (queryInvoiceErrorById). */
	errors: EsfError[];
}

/** Достаёт понятный текст ошибки из ответа axios/Error. */
function errMessage(e: unknown): string {
	if (e instanceof NcaLayerUnavailableError) return e.message;
	const anyE = e as { response?: { data?: { message?: string } }; message?: string };
	return anyE?.response?.data?.message || anyE?.message || "Ошибка ЭСФ";
}

/**
 * Оркестрация отправки исходящего счёта-фактуры в ИС ЭСФ по схеме NCALayer
 * (ENVELOPED): подпись тикета и XML выполняется на клиенте, приватный ключ не
 * покидает машину. Сессия ИС ЭСФ кэшируется на время жизни хука.
 */
export function useEsfInvoice() {
	const { sign } = useNcaLayerSign();
	const [state, setState] = useState<EsfInvoiceState>({ busy: false, error: null, errors: [] });
	const sessionRef = useRef<string | null>(null);
	const certRef = useRef<string | null>(null);

	/** Гарантирует активную сессию ИС ЭСФ (создаёт при отсутствии). */
	const ensureSession = useCallback(async (): Promise<string> => {
		if (sessionRef.current) return sessionRef.current;
		// 1. ИИН/БИН/сертификат из выбранного ключа NCALayer.
		const info = await getKeyInfo({ keyType: "AUTHENTICATION" });
		if (!info.iin) throw new Error("Не удалось определить ИИН из сертификата NCALayer");
		certRef.current = info.certificate;
		// 2. Тикет → подпись (AUTHENTICATION) → сессия.
		const { authTicketXml } = await requestAuthTicket(info.iin);
		const signedTicket = await sign(authTicketXml, "AUTHENTICATION");
		const { sessionId } = await createSession(signedTicket, info.bin || undefined);
		sessionRef.current = sessionId;
		return sessionId;
	}, [sign]);

	const clearSession = useCallback(() => { sessionRef.current = null; }, []);

	/** Подписать и отправить счёт-фактуру в ИС ЭСФ. */
	const sendToEsf = useCallback(async (uuid: string): Promise<EsfSyncResult> => {
		setState({ busy: true, error: null, errors: [] });
		try {
			const sessionId = await ensureSession();
			const { xml } = await buildInvoiceXml(uuid);
			const signedXml = await sign(xml, "SIGNATURE");
			const result = await syncInvoice(uuid, sessionId, signedXml, certRef.current || undefined);
			const err = result.success ? null : (result.esfErrorText || result.message || "ЭСФ отклонена");
			setState({ busy: false, error: err, errors: [] });
			return result;
		} catch (e) {
			// Истёкшая сессия — сбрасываем кэш, чтобы следующая попытка пересоздала её.
			clearSession();
			const msg = errMessage(e);
			setState({ busy: false, error: msg, errors: [] });
			throw new Error(msg);
		}
	}, [ensureSession, sign, clearSession]);

	/** Обновить статус ЭСФ из ИС ЭСФ. */
	const refresh = useCallback(async (uuid: string): Promise<EsfStatusResult> => {
		setState((s) => ({ ...s, busy: true, error: null }));
		try {
			const sessionId = await ensureSession();
			const result = await refreshStatus(uuid, sessionId);
			setState((s) => ({ ...s, busy: false, error: null }));
			return result;
		} catch (e) {
			clearSession();
			const msg = errMessage(e);
			setState((s) => ({ ...s, busy: false, error: msg }));
			throw new Error(msg);
		}
	}, [ensureSession, clearSession]);

	/** Загрузить детальные ошибки ИС ЭСФ по документу (для статуса FAILED). */
	const loadErrors = useCallback(async (uuid: string): Promise<EsfError[]> => {
		setState((s) => ({ ...s, busy: true, error: null }));
		try {
			const sessionId = await ensureSession();
			const { errors } = await getInvoiceErrors(uuid, sessionId);
			setState((s) => ({ ...s, busy: false, errors: errors || [] }));
			return errors || [];
		} catch (e) {
			clearSession();
			const msg = errMessage(e);
			setState((s) => ({ ...s, busy: false, error: msg }));
			throw new Error(msg);
		}
	}, [ensureSession, clearSession]);

	const clearError = useCallback(() => setState((s) => ({ ...s, error: null, errors: [] })), []);

	return { busy: state.busy, error: state.error, errors: state.errors, sendToEsf, refresh, loadErrors, clearError };
}

export default useEsfInvoice;
