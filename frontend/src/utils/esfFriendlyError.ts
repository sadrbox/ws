/**
 * friendlyEsfError — понятное сообщение об ошибке интеграции с ИС ЭСФ.
 *
 * Бэкенд отдаёт сырой текст ИС ЭСФ (напр. «Несоответствие типов (параметр номер '1')»)
 * и код лицензии (ESF_LICENSE_NOT_ACTIVE: …) — пользователю это непонятно. Здесь мы
 * маппим ошибку по КАТЕГОРИИ (faultKind из soapClient) и коду в короткое пояснение,
 * а технические детали скрываем. Бизнес-ошибки ИС ЭСФ осмысленны — их показываем как есть.
 */
import { translate } from "src/i18";
import { NcaLayerUnavailableError } from "src/services/ncalayer";

interface ApiErrorShape {
  response?: { data?: { message?: string; faultKind?: string } };
  message?: string;
}

export function friendlyEsfError(e: unknown): string {
  // Ошибки NCALayer уже сформулированы для пользователя — не подменяем.
  if (e instanceof NcaLayerUnavailableError) return e.message;

  const a = e as ApiErrorShape;
  const raw = a?.response?.data?.message ?? a?.message ?? "";
  const kind = a?.response?.data?.faultKind ?? "";

  // Лицензия (сервер лицензий / гейт расширения) — по коду в тексте.
  if (/ESF_LICENSE_NOT_ACTIVE/i.test(raw)) return translate("esfErrLicense");

  switch (kind) {
    case "session": return translate("esfErrSession");
    case "certificate":
    case "ocsp": return translate("esfErrCertificate");
    case "signature": return translate("esfErrSignature");
    case "access": return translate("esfErrAccess");
    case "validation": return translate("esfErrValidation");
    case "transport": return translate("esfErrTransport");
    // Бизнес-ошибки ИС ЭСФ (напр. «ЭСФ уже зарегистрирована») понятны — показываем текст.
    case "business": return raw || translate("esfErrGeneric");
    default: return translate("esfErrGeneric");
  }
}
