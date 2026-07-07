// Секция настроек интеграции eGov (Открытые данные) в «Общих настройках».
// Только для суперадмина: набор данных, версия, базовый URL, apiKey (секрет),
// плюс проверка запроса по БИН. Значения хранятся на сервере (AppSetting).
import { FC, useEffect, useState, useCallback } from "react";
import { translate } from "src/i18";
import { getCurrentUser } from "src/services/auth";
import { showToast } from "src/components/UIToast";
import { getEgovConfig, saveEgovConfig, fetchEgovLegalEntity } from "src/services/egov/api";
import styles from "./GeneralSettings.module.scss";

const EgovSettingsSection: FC = () => {
	const isSuperAdmin = !!getCurrentUser()?.isSuperAdmin;
	const [baseUrl, setBaseUrl] = useState("");
	const [dataset, setDataset] = useState("");
	const [version, setVersion] = useState("v1");
	const [apiKey, setApiKey] = useState("");
	const [hasApiKey, setHasApiKey] = useState(false);
	const [testBin, setTestBin] = useState("");
	const [result, setResult] = useState<{ text: string; err: boolean } | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!isSuperAdmin) return;
		getEgovConfig().then(({ config }) => {
			setBaseUrl(config.baseUrl); setDataset(config.dataset); setVersion(config.version); setHasApiKey(config.hasApiKey);
		}).catch(() => { /* нет доступа/ошибка — секция всё равно скрыта для не-суперадмина */ });
	}, [isSuperAdmin]);

	const save = useCallback(async () => {
		setBusy(true);
		try {
			await saveEgovConfig({ baseUrl, dataset, version, ...(apiKey ? { apiKey } : {}) });
			if (apiKey) { setHasApiKey(true); setApiKey(""); }
			showToast(translate("saved"), "success");
		} catch (e) {
			const a = e as { response?: { data?: { message?: string } }; message?: string };
			showToast(a?.response?.data?.message || "eGov", "error");
		} finally { setBusy(false); }
	}, [baseUrl, dataset, version, apiKey]);

	const test = useCallback(async () => {
		if (!/^\d{12}$/.test(testBin)) { showToast(translate("egovNeedBin"), "error"); return; }
		setBusy(true); setResult(null);
		try {
			const { data } = await fetchEgovLegalEntity(testBin);
			setResult({ err: false, text: [
				`${translate("name")}: ${data.name || "—"}`,
				`${translate("address")}: ${data.address || "—"}`,
				`${translate("egovDirector")}: ${data.director || "—"}`,
				`ОКЭД: ${data.oked || "—"}`,
				`${translate("edoStatus")}: ${data.status || "—"}`,
			].join("\n") });
		} catch (e) {
			const a = e as { response?: { data?: { message?: string } }; message?: string };
			setResult({ err: true, text: a?.response?.data?.message || "eGov" });
		} finally { setBusy(false); }
	}, [testBin]);

	if (!isSuperAdmin) return null;

	return (
		<div className={styles.Section}>
			<div className={styles.Title}>{translate("egovSettings")}</div>
			<div className={styles.Row}>
				<label className={styles.Label}>{translate("egovDataset")}</label>
				<input className={styles.Input} value={dataset} onChange={(e) => setDataset(e.target.value)} placeholder="напр. gbd_ul" />
			</div>
			<div className={styles.Row}>
				<label className={styles.Label}>apiKey</label>
				<input className={styles.Input} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
					placeholder={hasApiKey ? "••••••••• (задан)" : translate("egovApiKeyHint")} />
			</div>
			<div className={styles.Row}>
				<label className={styles.Label}>{translate("egovBaseUrl")}</label>
				<input className={styles.Input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
			</div>
			<div className={styles.Row}>
				<label className={styles.Label}>{translate("egovVersion")}</label>
				<input className={styles.Input} value={version} onChange={(e) => setVersion(e.target.value)} />
			</div>
			<div className={styles.Row}>
				<button className={styles.Btn} disabled={busy} onClick={() => void save()}>{translate("save")}</button>
			</div>
			<div className={styles.Row}>
				<label className={styles.Label}>{translate("egovTest")}</label>
				<input className={styles.Input} value={testBin} onChange={(e) => setTestBin(e.target.value)} placeholder="БИН (12 цифр)" maxLength={12} />
				<button className={styles.Btn} disabled={busy} onClick={() => void test()}>{translate("egovCheck")}</button>
			</div>
			{result && <div className={[styles.Result, result.err ? styles.ResultErr : ""].join(" ")}>{result.text}</div>}
		</div>
	);
};

export default EgovSettingsSection;
