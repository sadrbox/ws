import React, { useState, useCallback, useEffect, useRef } from "react";
import { login, registerOrganization, joinOrganization } from "src/services/auth";
import { translate } from "src/i18";
import styles from "./LoginForm.module.scss";

type AuthMode = "login" | "register" | "join";

interface LoginFormProps {
  onLoginSuccess: () => void;
}

const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [bin, setBin] = useState("");
  const [orgName, setOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [twoFaRequired, setTwoFaRequired] = useState(false);
  const [code, setCode] = useState("");
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, [mode]);

  const resetFields = useCallback(() => {
    setUsername(""); setPassword(""); setEmail(""); setBin(""); setOrgName(""); setInviteCode("");
    setError(null); setInviteResult(null);
  }, []);

  const switchMode = useCallback((m: AuthMode) => {
    resetFields();
    setMode(m);
  }, [resetFields]);

  // ── LOGIN ──
  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    const trimmed = username.trim();
    if (!trimmed) { setError("Введите имя пользователя"); return; }
    setIsLoading(true);
    try {
      const result = await login(trimmed, password || undefined, code || undefined);
      if (result.success) onLoginSuccess();
      else if (result.twoFactorRequired) {
        setTwoFaRequired(true);
        // Ошибку показываем только если код уже вводился (повторная неверная попытка).
        setError(code ? (result.message || "Неверный код") : null);
      } else setError(result.message || "Ошибка авторизации");
    } catch { setError("Ошибка соединения с сервером"); }
    finally { setIsLoading(false); }
  }, [username, password, code, onLoginSuccess]);

  // ── REGISTER ──
  const handleRegister = useCallback(async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    const trimmedBin = bin.trim();
    const trimmedUsername = username.trim();
    if (!trimmedBin || !/^\d{12}$/.test(trimmedBin)) { setError("БИН должен состоять из 12 цифр"); return; }
    if (!trimmedUsername) { setError("Введите имя пользователя"); return; }
    if (!password || password.length < 6) { setError("Пароль — минимум 6 символов"); return; }
    setIsLoading(true);
    try {
      const result = await registerOrganization({
        bin: trimmedBin, name: orgName.trim() || undefined,
        username: trimmedUsername, password, email: email.trim() || undefined,
      });
      if (result.success) {
        if (result.inviteCode) setInviteResult(result.inviteCode);
        onLoginSuccess();
      } else setError(result.message || "Ошибка регистрации");
    } catch { setError("Ошибка соединения с сервером"); }
    finally { setIsLoading(false); }
  }, [bin, orgName, username, password, email, onLoginSuccess]);

  // ── JOIN ──
  const handleJoin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    const trimmedCode = inviteCode.trim();
    const trimmedUsername = username.trim();
    if (!trimmedCode) { setError("Введите код приглашения"); return; }
    if (!trimmedUsername) { setError("Введите имя пользователя"); return; }
    if (!password || password.length < 6) { setError("Пароль — минимум 6 символов"); return; }
    setIsLoading(true);
    try {
      const result = await joinOrganization({
        inviteCode: trimmedCode, username: trimmedUsername, password, email: email.trim() || undefined,
      });
      if (result.success) onLoginSuccess();
      else setError(result.message || "Ошибка присоединения");
    } catch { setError("Ошибка соединения с сервером"); }
    finally { setIsLoading(false); }
  }, [inviteCode, username, password, email, onLoginSuccess]);

  return (
    <div className={styles.LoginOverlay}>
      <form className={styles.LoginForm} onSubmit={mode === "login" ? handleLogin : mode === "register" ? handleRegister : handleJoin}>
        {/* ── Переключатель режимов ── */}
        <div className={styles.modeTabs}>
          <button type="button" className={mode === "login" ? styles.modeActive : ""} onClick={() => switchMode("login")}>{translate("signin")}</button>
          <button type="button" className={mode === "register" ? styles.modeActive : ""} onClick={() => switchMode("register")}>{translate("signup")}</button>
          <button type="button" className={mode === "join" ? styles.modeActive : ""} onClick={() => switchMode("join")}>{translate("byInvite")}</button>
        </div>

        <h2 className={styles.title}>
          {mode === "login" ? translate("loginTitle") : mode === "register" ? translate("registerOrgTitle") : translate("joinOrgTitle")}
        </h2>

        {error && <div className={styles.error}>{error}</div>}
        {inviteResult && <div className={styles.success}>{translate("inviteResultLabel")} <strong>{inviteResult}</strong><br />{translate("inviteResultHint")}</div>}

        {/* ── Регистрация: поля организации ── */}
        {mode === "register" && (
          <>
            <div className={styles.field}>
              <label htmlFor="reg_bin">{translate("orgBin")} *</label>
              <input ref={firstFieldRef} id="reg_bin" type="text" maxLength={12} value={bin}
                onChange={e => setBin(e.target.value)} disabled={isLoading} placeholder={translate("binPlaceholder")} autoComplete="off" />
            </div>
            <div className={styles.field}>
              <label htmlFor="reg_name">{translate("orgName")}</label>
              <input id="reg_name" type="text" value={orgName}
                onChange={e => setOrgName(e.target.value)} disabled={isLoading} placeholder={translate("orgNamePlaceholder")} />
            </div>
          </>
        )}

        {/* ── Присоединение: invite-код ── */}
        {mode === "join" && (
          <div className={styles.field}>
            <label htmlFor="join_code">{translate("inviteCode")} *</label>
            <input ref={firstFieldRef} id="join_code" type="text" value={inviteCode}
              onChange={e => setInviteCode(e.target.value)} disabled={isLoading} placeholder={translate("inviteCodePlaceholder")} autoComplete="off" />
          </div>
        )}

        {/* ── Общие поля: username, password ── */}
        <div className={styles.field}>
          <label htmlFor="auth_username">{translate("username")} {mode !== "login" ? "*" : ""}</label>
          <input ref={mode === "login" ? firstFieldRef : undefined} id="auth_username" type="text" value={username}
            onChange={e => setUsername(e.target.value)} disabled={isLoading}
            placeholder={translate("usernamePlaceholder")} autoComplete="username" />
        </div>

        <div className={styles.field}>
          <label htmlFor="auth_password">{translate("password")} {mode !== "login" ? `* ${translate("passwordMinHint")}` : ""}</label>
          <input id="auth_password" type="password" value={password}
            onChange={e => setPassword(e.target.value)} disabled={isLoading}
            placeholder={mode === "login" ? translate("passwordPlaceholder") : translate("passwordNewPlaceholder")}
            autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </div>

        {/* ── Код 2FA (показывается после запроса сервера) ── */}
        {mode === "login" && twoFaRequired && (
          <div className={styles.field}>
            <label htmlFor="auth_2fa">{translate("twoFactorCode")}</label>
            <input id="auth_2fa" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} disabled={isLoading}
              placeholder={translate("twoFactorCodePlaceholder")} autoFocus />
          </div>
        )}

        {/* ── Email (только при регистрации/присоединении) ── */}
        {mode !== "login" && (
          <div className={styles.field}>
            <label htmlFor="auth_email">{translate("emailOptional")}</label>
            <input id="auth_email" type="email" value={email}
              onChange={e => setEmail(e.target.value)} disabled={isLoading} placeholder="email@example.com" />
          </div>
        )}

        <button type="submit" className={styles.submitBtn} disabled={isLoading}>
          {isLoading ? translate("pleaseWait") : mode === "login" ? translate("login") : mode === "register" ? translate("registerAction") : translate("joinAction")}
        </button>
      </form>
    </div>
  );
};

export default LoginForm;
