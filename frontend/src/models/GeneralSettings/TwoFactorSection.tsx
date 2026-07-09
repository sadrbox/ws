// Настройка двухфакторной аутентификации (TOTP). Ключ показывается для ручного
// ввода в приложение-аутентификатор (без QR-зависимостей). Подтверждение — кодом.
import { FC, useEffect, useState, useCallback } from "react";
import { translate } from "src/i18";
import { showToast } from "src/components/UIToast";
import { Button } from "src/components/Button";
import { twoFactorStatus, twoFactorSetup, twoFactorEnable, twoFactorDisable } from "src/services/auth";
import styles from "./GeneralSettings.module.scss";

const errText = (e: unknown) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message || "Ошибка";

const TwoFactorSection: FC = () => {
	const [enabled, setEnabled] = useState<boolean | null>(null);
	const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => { twoFactorStatus().then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false)); }, []);

	const startSetup = useCallback(async () => {
		setBusy(true);
		try { const r = await twoFactorSetup(); setSetup({ secret: r.secret, otpauthUrl: r.otpauthUrl }); setCode(""); }
		catch (e) { showToast(errText(e), "error"); }
		finally { setBusy(false); }
	}, []);

	const confirmEnable = useCallback(async () => {
		setBusy(true);
		try { const r = await twoFactorEnable(code); showToast(r.message, "success"); setEnabled(true); setSetup(null); setCode(""); }
		catch (e) { showToast(errText(e), "error"); }
		finally { setBusy(false); }
	}, [code]);

	const disable = useCallback(async () => {
		setBusy(true);
		try { const r = await twoFactorDisable(code); showToast(r.message, "success"); setEnabled(false); setCode(""); }
		catch (e) { showToast(errText(e), "error"); }
		finally { setBusy(false); }
	}, [code]);

	const codeInput = (
		<input className={styles.Input} inputMode="numeric" maxLength={6} value={code}
			onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder={translate("twoFaCodePlaceholder")} />
	);

	return (
		<div className={styles.Section}>
			<div className={styles.Title}>{translate("twoFaTitle")}</div>
			{enabled === null ? (
				<span className={styles.Hint}>…</span>
			) : enabled ? (
				<>
					<span className={styles.Hint}>{translate("twoFaHintOn")}</span>
					<div className={styles.Row}>
						{codeInput}
						<Button variant="danger" onClick={disable} disabled={busy || code.length !== 6}>{translate("twoFaDisable")}</Button>
					</div>
				</>
			) : setup ? (
				<>
					<span className={styles.Hint}>{translate("twoFaSetupHint1")}</span>
					<div className={styles.Row}><span className={styles.Label}>{translate("twoFaKey")}:</span> <code>{setup.secret}</code></div>
					<span className={styles.Hint}>{translate("twoFaSetupHint2")}</span>
					<div className={styles.Row}>
						{codeInput}
						<Button variant="primary" onClick={confirmEnable} disabled={busy || code.length !== 6}>{translate("twoFaConfirm")}</Button>
					</div>
				</>
			) : (
				<>
					<span className={styles.Hint}>{translate("twoFaHintOff")}</span>
					<div className={styles.Row}><Button variant="primary" onClick={startSetup} disabled={busy}>{translate("twoFaEnable")}</Button></div>
				</>
			)}
		</div>
	);
};

TwoFactorSection.displayName = "TwoFactorSection";
export default TwoFactorSection;
