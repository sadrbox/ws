# Метаданные ЭСФ (InvoiceV2) — справка + план

Авторитетный источник — XSD SDK:
`esf-sdk-280824/Документация ЭСФ SDK/api-wsdl/xsd/Invoice/InvoiceV2.xsd`
(база `AbstractInvoice` — в `InvoiceV1.xsd`, ns `abstractInvoice.esf`).

Буквенно-цифровые коды в описаниях (A 2, B 7, G 18, H 13, K 43 …) = **разделы/ячейки
формы в кабинете ЭСФ**. Именно поэтому «значений так много».

**Текущая архитектура:** ЭСФ формируется из документа **`OutgoingInvoice`**
(Счёт-фактура исходящая) → `services/esf/invoiceMapper.js` `buildInvoiceV2Xml()`
→ `<esf:invoiceContainer><v2:invoice>…`. Маппер заполняет **обязательный минимум**
для `ORDINARY_INVOICE`; остальные секции опускаются (XSD-валидно, `minOccurs=0`).

Легенда покрытия: ✓ заполняем · ~ заглушка/дефолт · ✗ не заполняем.

---

## Базовые поля (AbstractInvoice, раздел A)

| Поле | Тип | Об. | Ячейка | Покрытие |
|---|---|---|---|---|
| date | date (dd.MM.yyyy) | ✔ | A 2 | ✓ |
| invoiceType | InvoiceType | ✔ | — | ✓ (Э4) ORDINARY/FIXED/ADDITIONAL |
| num | string | ✔ | A 1 | ✓ (number) |
| operatorFullname | string | ✔ | — | ~ (username/org) |
| turnoverDate | date | ✔ | A 3 | ~ (=date) |
| relatedInvoice | RelatedInvoice{date,num,registrationNumber} | — | — | ✓ (Э4) для FIXED/ADDITIONAL, из OutgoingInvoice.esfRelatedInvoiceUuid |

## Шапка InvoiceV2 (2.1, F, K)

| Поле | Тип | Об. | Ячейка | Покрытие |
|---|---|---|---|---|
| datePaper | string | — | 2.1 | ✗ (бум. носитель) |
| reasonPaper | PaperReasonType | — | 2.1 | ✗ |
| deliveryDocNum / deliveryDocDate (+ …2) | string | — | F | ✗ |
| addInf | string | — | K 43 | ✓ из комментария документа |

## Поставщик — sellers/seller (раздел B), Seller

| Поле | Об. | Ячейка | Покрытие |
|---|---|---|---|
| name | ✔ | B 7 | ✓ (legalName/name) |
| status[] (SellerType) в `statuses` (опц.) | ✔* | B 10 | ✓ (Э1) OutgoingInvoice.esfSellerType |
| address | — | B 8 | ~ (getLegalAddress) |
| certificateSeries / certificateNum | — | B 9.1/9.2 | ~ (vatSeries/vatNumber) |
| bank / bik / iik / kbe | — | B1 12–15 | ~ (первичный счёт) |
| ndscaBank/Bik/Iik/Kbe | — | B2 (контр. счёт НДС) | ✗ |
| reorganizedTin | — | B 6.1 | ✗ |
| branchTin | — | — | ✗ (филиал за голову) |
| shareParticipation | — | B 7.1 | ✗ |
| isBranchNonResident | — | B 9 | ✗ |
| — (tin в маппере, ОБЯЗ) | ✔ | B 6 | ✓ (bin) |

\* `statuses` — опциональная обёртка, но при наличии `status[]` обязателен; бизнес-правила
кабинета часто требуют категорию (RETAIL/COMMITTENT/…).

## Получатель — customers/customer (раздел C), Customer

| Поле | Об. | Ячейка | Покрытие |
|---|---|---|---|
| countryCode | ✔ | C 18* | ~ (дефолт KZ) |
| name | ✔ | C 17 | ✓ |
| status[] (CustomerType) в `statuses` (опц.) | ✔* | C 20 | ✓ (Э1) OutgoingInvoice.esfCustomerType |
| address | — | C 18 | ~ (getLegalAddress) |
| reorganizedTin | — | C 16.1 | ✗ |
| branchTin / shareParticipation | — | C 17.1 | ✗ |
| tin (в маппере) | ✔ | C 16 | ✓ (bin) |

## Грузоотправитель / грузополучатель — Consignor / Consignee (раздел D)

| Поле | Об. | Ячейка | Покрытие |
|---|---|---|---|
| Consignor.tin / name / address | — | D 25.1–25.3 | ✓ (Э3b) OutgoingInvoice.esfConsignorUuid→Контрагент |
| Consignee.tin / name / address | — | D 26.1–26.3 | ✓ (Э3b) OutgoingInvoice.esfConsigneeUuid→Контрагент |
| Consignee.countryCode | ✔ (в блоке) | D 26.4 | ✓ (Э3b) countryCode контрагента |

## Условия поставки — deliveryTerm (раздел E), DeliveryTerm

| Поле | Об. | Ячейка | Покрытие |
|---|---|---|---|
| hasContract | ✔ (в блоке) | E 27.1/27.2 | ✓ (Э3) true если привязан договор |
| contractNum / contractDate | — | — | ✓ (Э3) Contract.contractNumber/startDate |
| term | — | E 28 | ✗ |
| transportTypeCode | — | E 29 (справочник) | ✗ |
| warrant / warrantDate | — | E 30 | ✗ |
| destination / deliveryConditionCode | — | E 31/31.1 (справочник) | ✗ |
| accountNumber | — | — | ✗ |

## Госучреждение — publicOffice (раздел F/C1), PublicOffice

| Поле | Об. | Ячейка | Покрытие |
|---|---|---|---|
| bik | ✔ (в блоке) | C1 24 | ✓ (Э5) esfPoBik |
| iik / payPurpose / productCode | — | C1 21–23 | ✓ (Э5) esfPoIik/PayPurpose/ProductCode |

## Получатель/Поставщик УСД — customerParticipants / sellerParticipants → Participant → ProductShare (раздел H)

Совместная деятельность/доли по каждой ТРУ. ✗ ОТЛОЖЕНО (Э5-УСД) — редкий кейс, требует
под-таблицы участников × позиций (доли по каждой ТРУ). Реализовать при реальной потребности.
Поля ProductShare: productNumber(✔), priceWithoutTax(✔), ndsAmount(✔), priceWithTax(✔),
turnoverSize(✔), ndsRate, quantity, quantitativeQuantity, exciseAmount, productNumberInSnt(H 1),
additional(H 19), additionalUnitNomenclature(H 20).

## Поверенный/оператор — sellerAgent* (I 35–38), customerAgent* (J 39–42)

`*Tin/*Name/*Address/*DocNum/*DocDate`. ✓ (Э5) — поля OutgoingInvoice.esf{Customer,Seller}Agent*.

## Товары — productSet (раздел G) + product

**ProductSet:** currencyCode(✓, G 33.1), currencyRate(✗, G 33.2), ndsRateType(✗, «Без НДС – не РК»),
итоги total{Excise,Nds,PriceWithTax,PriceWithoutTax,TurnoverSize}(✓).

**Product (позиция, раздел G):**

| Поле | Об. | Ячейка | Покрытие | Источник |
|---|---|---|---|---|
| catalogTruId | ✔ | G 18 | ~ дефолт «1» | каталог ТРУ ИС ЭСФ |
| truOriginCode | ✔ | G 2 | ✓ (Э2) | Product.truOriginCode |
| ndsAmount | ✔ | G 13 | ✓ | |
| priceWithTax | ✔ | G 15 | ✓ | |
| priceWithoutTax | ✔ | G 8 | ✓ | |
| turnoverSize | ✔ | G 14 | ✓ | |
| description | — | G 3 | ✓ | |
| ndsRate | — | G 12 | ✓ | |
| quantity / quantitativeQuantity | — | G 6 / 6.2 | ✓ / ✗ | |
| unitCode | — | G 4 | ✓ (Э2) | Product.tnvedCode (ТН ВЭД, было: ошибочно код ед.изм) |
| unitNomenclature / quantitativeUnitNomenclature | — | G 5 / 5.1 | ✓ / ✗ | МКЕИ |
| unitPrice | — | G 7 | ✓ | |
| gtinCode | — | G 17.1 | ✓ (Э2) | Product.barcode (валидный GTIN 8/12/13/14) |
| kpvedCode | — | — | ✗ | classifier gsvs (КПВЭД!) |
| tnvedName | — | G 3.1 | ✓ | Product.tnvedCode → classifier tnved (lookup) |
| exciseRate / exciseAmount | — | G 9 / 10 | ✓ | из позиции (item.excise*) |
| productDeclaration / productNumberInDeclaration | — | ГТД/СТ-1 | ✗ | |
| productNumberInSnt | — | G 1 | ✗ | связка со СНТ |
| turnoverCode / turnoverAdjustment | — | G 14 / 11.1 | ✗ | справочник |
| additional / additionalUnitNomenclature | — | G 19 / 20 | ✗ | |

---

## Справочники-enum (авторитетно из XSD → `services/esf/dictionaries.js`)

- **InvoiceType**: ORDINARY_INVOICE, FIXED_INVOICE, ADDITIONAL_INVOICE
- **SellerType**: COMMITTENT, BROKER, FORWARDER, LESSOR, JOINT_ACTIVITY_PARTICIPANT,
  SHARING_AGREEMENT_PARTICIPANT, EXPORTER, TRANSPORTER, PRINCIPAL, LAWYER, BAILIFF, MEDIATOR, NOTARY
- **CustomerType**: COMMITTENT, BROKER, LESSEE, JOINT_ACTIVITY_PARTICIPANT, PUBLIC_OFFICE,
  NONRESIDENT, SHARING_AGREEMENT_PARTICIPANT, PRINCIPAL, RETAIL, INDIVIDUAL, LAWYER, BAILIFF, MEDIATOR, NOTARY
- **NdsRateType**: WITHOUT_NDS_NOT_KZ
- **PaperReasonType**: DOWN_TIME, MISSING_REQUIREMENT, UNLAWFUL_REMOVAL_REGISTRATION
- **truOrigin** (G 2): коды 1–6 (уже в dictionaries.js)
- Справочники-классификаторы (уже импортированы): `tnved` (unitCode G4 / tnvedName G3.1),
  `gsvs`=КПВЭД (kpvedCode), `kato` (адреса). deliveryConditionCode/transportTypeCode/turnoverCode —
  отдельные ведомственные справочники (нужны файлы).

---

# ПРОМПТ-ЗАДАЧА: полнота ЭСФ — отдельный документ или расширение текущего СФ

## Решение (Т0) — выбрать архитектуру

**Контекст:** ЭСФ уже формируется из `OutgoingInvoice` (это фактически уже отдельный
документ со своими `esf*`-полями и формой `OutgoingInvoicesList`). Маппер покрывает
обязательный минимум ORDINARY_INVOICE. ~70 полей (D/E/F/H/I/J/K, related, ТН ВЭД/ГТД/акциз)
не заполняются — это XSD-валидно, но недостаточно для FIXED/ADDITIONAL, госзакупа,
совместной деятельности, экспорта, подакцизных, розницы (категория RETAIL) и т.п.

**Варианты:**
- **A. Расширить текущий СФ (OutgoingInvoice).** Добавить недостающие ЭСФ-поля прямо в
  модель/форму OutgoingInvoice, вынести их в сворачиваемую панель «Реквизиты ЭСФ»
  (разделы D/E/F/H/I/J/K показывать по требованию). Плюсы: один документ, нет дублирования,
  суммы/позиции уже есть. Минусы: форма тяжелеет; бухгалтерский СФ смешивается со спецификой
  фискальной формы.
- **B. Отдельный документ «ЭСФ».** Новая сущность `EsfInvoice` (basis → OutgoingInvoice/Sale),
  хранит полную InvoiceV2, форма 1:1 с кабинетом. Плюсы: чистый бух-СФ; естественно ложатся
  FIXED/ADDITIONAL/relatedInvoice и госзакуп. Минусы: дублирование, синхронизация двух документов.

**Рекомендация:** **A (расширять OutgoingInvoice) поэтапно**, т.к. большинство реализаций —
ORDINARY, где текущего минимума достаточно; отдельный документ B оправдан только когда
реально понадобятся корректировочные ЭСФ (FIXED/ADDITIONAL) и полный госзакуп. Ввести B
как эволюцию, если/когда появятся эти сценарии. **Требуется подтверждение пользователя.**

## Этапы реализации (при выборе A)

- **Э1 — Реквизиты продавца/покупателя:** категория SellerType/CustomerType (B10/C20; для
  розницы RETAIL), НДС свид-во, банк/контрольный счёт НДС (ndsca*), reorganizedTin/branchTin.
  Источник — Организация/Контрагент (+ форма). Заполнить в маппере (statuses/status).
- **Э2 — Товарные поля G:** реальный `catalogTruId` (каталог ТРУ ИС ЭСФ), `unitCode` (ТН ВЭД из
  Product.tnvedCode→classifier), `tnvedName`, `kpvedCode` (КПВЭД), gtinCode, exciseRate/Amount,
  productDeclaration/ГТД, turnoverCode. Убрать дефолты «1» где есть данные.
- **Э3 — Условия поставки (E) + грузоотправитель/получатель (D):** deliveryTerm (договор,
  условия, способ отправления/справочники), consignor/consignee. Панель на форме.
- **Э4 — Корректировочные ЭСФ:** invoiceType FIXED/ADDITIONAL + relatedInvoice (связка с
  основным по рег.№). Логика статусов/переходов, отдельная кнопка «Исправить/Дополнить».
- **Э5 — Спецсценарии:** publicOffice (госзакуп F/C1), participants/ProductShare (УСД/доли),
  seller/customerAgent (поверенный I/J), addInf/бумажный носитель (datePaper/reasonPaper).
- **Э6 — Валидация до отправки:** ✅ ЧАСТИЧНО (`services/esf/validateInvoice.js`, вызов в
  `esf.js` build-xml → 400 со списком проблем ДО сборки XML). Правила: БИН/наименование продавца,
  наименование получателя, наличие позиций, FIXED/ADDITIONAL→основной ЭСФ (найден + зарегистрирован),
  нерезидент→страна≠KZ. Юнит-тесты — ✅ `__tests__/esfInvoiceMapper.test.js` (16 тестов: порядок
  xs:sequence, Э1–Э4 секции, валидатор). ОСТАЛОСЬ: ТН ВЭД у подакцизных/прослеживаемых (нужен
  признак на товаре), страна для экспорта.

**Инварианты:** порядок элементов строго по `InvoiceV2.xsd` (xs:sequence) — иначе отказ
валидации; опциональные поля опускать при отсутствии; адреса — через `getLegalAddress`
(Контакты→Юр.адрес); проверять на test3 структурно (fake session → нет unmarshalling-фолта);
сквозной тест — с реальным ЭЦП. i18n RU/KK, без inline-стилей, org-изоляция, блокировка периодов.
