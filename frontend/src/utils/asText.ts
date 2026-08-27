/**
 * asText — безопасное превращение произвольного значения в строку для показа/поиска.
 *
 * Значения в системе часто типизированы широко (`unknown`, `Record<string, unknown>`,
 * данные ячеек таблиц и записей), и прямой `String(v)` / `` `${v}` `` даёт для
 * объектов бесполезное «[object Object]» (и справедливо ловится ESLint-правилом
 * `no-base-to-string`). Этот помощник:
 *   • примитивы (string/number/boolean/bigint) отдаёт как строку;
 *   • Date — как ISO (совместимо с getFormatDate*, которые принимают строку);
 *   • null/undefined — как "";
 *   • объекты/массивы — как "" (а не «[object Object]»).
 *
 * Используйте его вместо `String(x)` / `x + ""` / `` `${x}` `` там, где `x`
 * ожидается примитивом, но типизирован шире.
 */
export function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  if (v instanceof Date) return v.toISOString();
  return "";
}
