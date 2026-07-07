import { useCallback, useRef } from "react";
import { getKeyInfo } from "src/services/ncalayer";
import { useNcaLayerSign } from "src/hooks/useNcaLayerSign";
import { esfAuthTicket, esfCreateSession } from "src/services/esf/api";

/**
 * Сессия ИС ЭСФ через NCALayer (переиспользуемая): getKeyInfo(ИИН) →
 * тикет → подпись(AUTHENTICATION) → createSession. Кэширует sessionId на время
 * жизни хука; clearSession() сбрасывает (напр. при истёкшей сессии).
 */
export function useEsfSession() {
	const { sign } = useNcaLayerSign();
	const sessionRef = useRef<string | null>(null);

	const ensureSession = useCallback(async (): Promise<string> => {
		if (sessionRef.current) return sessionRef.current;
		const info = await getKeyInfo({ keyType: "AUTHENTICATION" });
		if (!info.iin) throw new Error("Не удалось определить ИИН из сертификата NCALayer");
		const { authTicketXml } = await esfAuthTicket(info.iin);
		const signed = await sign(authTicketXml, "AUTHENTICATION");
		const { sessionId } = await esfCreateSession(signed, info.bin || undefined);
		sessionRef.current = sessionId;
		return sessionId;
	}, [sign]);

	const clearSession = useCallback(() => { sessionRef.current = null; }, []);

	return { ensureSession, clearSession };
}

export default useEsfSession;
