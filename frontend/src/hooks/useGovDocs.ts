import { useCallback, useRef, useState } from "react";
import { getKeyInfo, NcaLayerUnavailableError } from "src/services/ncalayer";
import { useNcaLayerSign } from "src/hooks/useNcaLayerSign";
import { useEsfSession } from "src/hooks/useEsfSession";
import {
	buildAwpXml, uploadAwp, refreshAwpStatus,
	buildSntXml, uploadSnt, refreshSntStatus,
	type SntSource, type AwpResult, type SntResult,
} from "src/services/govdocs/api";

function errMsg(e: unknown): string {
	if (e instanceof NcaLayerUnavailableError) return e.message;
	const a = e as { response?: { data?: { message?: string } }; message?: string };
	return a?.response?.data?.message || a?.message || "Ошибка гос-документа";
}

/**
 * Оркестрация выписки гос-документов РК: ЭАВР (акт работ/услуг) и СНТ
 * (сопроводительная накладная). Поток как у ЭСФ: сессия NCALayer → build-xml →
 * подпись (SIGNATURE, enveloped) → upload. Приватный ключ не покидает клиента.
 */
export function useGovDocs() {
	const { sign } = useNcaLayerSign();
	const { ensureSession, clearSession } = useEsfSession();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const certRef = useRef<string | null>(null);

	const ensureCert = useCallback(async () => {
		if (certRef.current) return certRef.current;
		certRef.current = (await getKeyInfo({ keyType: "SIGNATURE" })).certificate;
		return certRef.current;
	}, []);

	const run = useCallback(async <T,>(op: () => Promise<T>): Promise<T> => {
		setBusy(true); setError(null);
		try { return await op(); }
		catch (e) { clearSession(); const m = errMsg(e); setError(m); throw new Error(m); }
		finally { setBusy(false); }
	}, [clearSession]);

	/** Выписать ЭАВР по Реализации: build → подпись → upload. */
	const issueAwp = useCallback((saleUuid: string): Promise<AwpResult> => run(async () => {
		const sessionId = await ensureSession();
		const cert = await ensureCert();
		const { xml } = await buildAwpXml(saleUuid);
		const signed = await sign(xml, "SIGNATURE");
		return uploadAwp(saleUuid, sessionId, signed, cert || undefined);
	}), [run, ensureSession, ensureCert, sign]);

	/** Обновить статус ЭАВР. */
	const refreshAwp = useCallback((saleUuid: string): Promise<AwpResult> => run(async () => {
		const sessionId = await ensureSession();
		return refreshAwpStatus(saleUuid, sessionId);
	}), [run, ensureSession]);

	/** Выписать СНТ по Реализации/Перемещению. */
	const issueSnt = useCallback((source: SntSource, uuid: string): Promise<SntResult> => run(async () => {
		const sessionId = await ensureSession();
		const cert = await ensureCert();
		const { xml } = await buildSntXml(source, uuid);
		const signed = await sign(xml, "SIGNATURE");
		return uploadSnt(source, uuid, sessionId, signed, cert || undefined);
	}), [run, ensureSession, ensureCert, sign]);

	/** Обновить статус СНТ. */
	const refreshSnt = useCallback((source: SntSource, uuid: string): Promise<SntResult> => run(async () => {
		const sessionId = await ensureSession();
		return refreshSntStatus(source, uuid, sessionId);
	}), [run, ensureSession]);

	const clearError = useCallback(() => setError(null), []);

	return { busy, error, issueAwp, refreshAwp, issueSnt, refreshSnt, clearError };
}

export default useGovDocs;
