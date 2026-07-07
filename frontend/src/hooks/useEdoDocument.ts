import { useCallback, useRef, useState } from "react";
import { getKeyInfo, NcaLayerUnavailableError } from "src/services/ncalayer";
import { useNcaLayerSign } from "src/hooks/useNcaLayerSign";
import {
	buildSendXml, sendEdoDocument, buildAcceptXml, acceptEdoDocument,
	rejectEdoDocument, revokeEdoDocument, annulEdoDocument,
} from "src/services/edo/api";

function errMessage(e: unknown): string {
	if (e instanceof NcaLayerUnavailableError) return e.message;
	const a = e as { response?: { data?: { message?: string } }; message?: string };
	return a?.response?.data?.message || a?.message || "Ошибка ЭДО";
}

/**
 * Оркестрация действий над документом ЭДО. Подпись — на клиенте через NCALayer
 * (enveloped, приватный ключ не покидает машину), переиспользует useNcaLayerSign.
 */
export function useEdoDocument() {
	const { sign } = useNcaLayerSign();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const certRef = useRef<string | null>(null);

	const run = useCallback(async <T,>(op: () => Promise<T>): Promise<T> => {
		setBusy(true); setError(null);
		try { return await op(); }
		catch (e) { const m = errMessage(e); setError(m); throw new Error(m); }
		finally { setBusy(false); }
	}, []);

	/** Сертификат выбранного ключа (для передачи на сервер). */
	const ensureCert = useCallback(async () => {
		if (certRef.current) return certRef.current;
		const info = await getKeyInfo({ keyType: "SIGNATURE" });
		certRef.current = info.certificate;
		return info.certificate;
	}, []);

	/** Подписать и отправить (отправитель). */
	const signAndSend = useCallback((uuid: string) => run(async () => {
		const cert = await ensureCert();
		const { xml } = await buildSendXml(uuid);
		const signedXml = await sign(xml, "SIGNATURE");
		return sendEdoDocument(uuid, signedXml, cert || undefined);
	}), [run, ensureCert, sign]);

	/** Принять со встречной подписью (получатель). */
	const signAndAccept = useCallback((uuid: string) => run(async () => {
		const cert = await ensureCert();
		const { xml } = await buildAcceptXml(uuid);
		const signedXml = await sign(xml, "SIGNATURE");
		return acceptEdoDocument(uuid, signedXml, cert || undefined);
	}), [run, ensureCert, sign]);

	/** Принять без подписи (получатель). */
	const accept = useCallback((uuid: string) => run(() => acceptEdoDocument(uuid)), [run]);
	/** Отклонить (получатель). */
	const reject = useCallback((uuid: string, reason: string) => run(() => rejectEdoDocument(uuid, reason)), [run]);
	/** Отозвать (отправитель). */
	const revoke = useCallback((uuid: string, reason?: string) => run(() => revokeEdoDocument(uuid, reason)), [run]);
	/** Аннулировать (любая сторона). */
	const annul = useCallback((uuid: string, reason: string) => run(() => annulEdoDocument(uuid, reason)), [run]);

	const clearError = useCallback(() => setError(null), []);

	return { busy, error, signAndSend, signAndAccept, accept, reject, revoke, annul, clearError };
}

export default useEdoDocument;
