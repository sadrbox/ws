import { useCallback, useState } from "react";
import { signXml, signXmls, NcaLayerUnavailableError, type NcaKeyType } from "src/services/ncalayer";

interface UseNcaLayerSignResult {
	/** Идёт подпись (ожидание NCALayer/пользователя). */
	signing: boolean;
	/** Последняя ошибка (человекочитаемая) или null. */
	error: string | null;
	/** Подписать один XML. Бросает при ошибке; error также выставляется. */
	sign: (xml: string, keyType?: NcaKeyType) => Promise<string>;
	/** Подписать пакет XML одной сессией NCALayer. */
	signBatch: (xmls: string[], keyType?: NcaKeyType) => Promise<string[]>;
	clearError: () => void;
}

/**
 * Хук браузерной ЭЦП через NCALayer для форм (ЭСФ и др.). Инкапсулирует
 * состояние подписи и понятные сообщения об ошибках (NCALayer не запущен /
 * отмена пользователем).
 */
export function useNcaLayerSign(): UseNcaLayerSignResult {
	const [signing, setSigning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = useCallback(async <T,>(op: () => Promise<T>): Promise<T> => {
		setSigning(true);
		setError(null);
		try {
			return await op();
		} catch (e) {
			const msg = e instanceof NcaLayerUnavailableError
				? e.message
				: (e as { message?: string })?.message || "Ошибка подписи NCALayer";
			setError(msg);
			throw e;
		} finally {
			setSigning(false);
		}
	}, []);

	const sign = useCallback(
		(xml: string, keyType?: NcaKeyType) => run(() => signXml(xml, { keyType })),
		[run],
	);
	const signBatch = useCallback(
		(xmls: string[], keyType?: NcaKeyType) => run(() => signXmls(xmls, { keyType })),
		[run],
	);
	const clearError = useCallback(() => setError(null), []);

	return { signing, error, sign, signBatch, clearError };
}

export default useNcaLayerSign;
