// Хелперы LookupField: карты полей/прав по endpoint + клиентский поиск по метке.
// Вынесено из LookupField.tsx (Q9). Чистые данные/функции, без внешних зависимостей.

export const defaultSecondaryFieldsMap: Record<string, string[]> = {
  organizations: ["bin"],
  counterparties: ["bin", "iin"],
  products: ["sku", "brand.name"],
  employees: ["iin", "position"],
  users: ["employee.fullName"],
  // contracts: ["documentNumber"],
  bankaccounts: ["iban"],
  currencies: ["code", "symbol"],
  warehouses: ["code"],
  brands: [],
};

export const ENDPOINT_ACCESS_MODEL: Record<string, string> = {
  organizations: "Organization",
  counterparties: "Counterparty",
  contracts: "Contract",
  products: "Product",
  employees: "Employee",
  warehouses: "Warehouse",
  cashboxes: "Cashbox",
  bankaccounts: "BankAccount",
  contactpersons: "ContactPerson",
  contacts: "Contact",
  taxes: "Tax",
  users: "User",
  "price-types": "PriceType",
  "unit-of-measures": "UnitOfMeasure",
  brands: "Brand",
  currencies: "Currency",
};

// Нормализация для клиентского поиска по метке: нижний регистр + ё→е.
export const normForSearch = (s: string): string => s.toLowerCase().replace(/ё/g, "е");
// Слово-ориентированный матч: ВСЕ слова запроса должны входить в метку (AND),
// порядок и пунктуация между ними не важны. Тогда «Счёт оплату 133», «133 08.03»,
// «оплата 133» одинаково находят «Счёт на оплату: №133 - 08.03.2026».
export const matchesAllWords = (label: string, query: string): boolean => {
  const hay = normForSearch(label);
  const words = normForSearch(query).split(/\s+/).filter(Boolean);
  return words.every((w) => hay.includes(w));
};

