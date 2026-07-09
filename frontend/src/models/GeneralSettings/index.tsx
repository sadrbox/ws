import { FC } from "react";
import { translate } from "src/i18";
import { useGeneralSettings, UTC_OFFSET_OPTIONS } from "src/hooks/useGeneralSettings";
import EgovSettingsSection from "./EgovSettingsSection";
import TwoFactorSection from "./TwoFactorSection";
import styles from "./GeneralSettings.module.scss";

const GeneralSettings: FC = () => {
  const { settings, update } = useGeneralSettings();

  return (
    <div className={styles.Wrapper}>
      <div className={styles.Section}>
        <div className={styles.Row}>
          <label className={styles.Label} htmlFor="utcOffsetSelect">
            {translate("timezone")}
          </label>
          <select
            id="utcOffsetSelect"
            className={styles.Select}
            value={settings.utcOffset}
            onChange={(e) => update({ utcOffset: Number(e.target.value) })}
          >
            {UTC_OFFSET_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className={styles.Hint}>{translate("timezoneHint")}</span>
        </div>
      </div>
      <TwoFactorSection />
      <EgovSettingsSection />
    </div>
  );
};

GeneralSettings.displayName = "GeneralSettings";
export default GeneralSettings;
