-- Организации базы 1С, как их прочитал агент (IB_LIST_ORGANIZATIONS, 28.09): вкладка «Организации» карточки базы —
-- полный набор реквизитов, отметка основной организации и связь со справочником «Организации» ERP (по БИН).
--
-- ОТДЕЛЬНО ОТ base_organizations. Та — список БИН, которые база вправе называть в чате (одобрение, миграции 040 и
-- 045); эта — кэш содержимого базы, как base_users и base_extensions: срез агента заменяет её целиком. Смешать их
-- значило бы либо одобрять БИН чтением агента, либо стирать одобрения очередным срезом.
CREATE TABLE IF NOT EXISTS base_ib_organizations (
    id         uuid PRIMARY KEY,
    base_id    uuid NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
    -- Ключ строки: ссылка 1С, иначе БИН, иначе наименование (onec/ibOrganizations.ts).
    org_key    text NOT NULL,
    onec_id    text,
    name       text NOT NULL,
    bin        text,
    -- Основная организация базы: её 1С подставляет по умолчанию. Только показ — меняют её в 1С.
    is_main    boolean NOT NULL DEFAULT false,
    -- Реквизиты в формате заявки на подключение (bases/orgDetails.ts); NULL — агент их не прислал.
    details    jsonb,
    seen_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS base_ib_organizations_key_idx ON base_ib_organizations (base_id, org_key);
CREATE INDEX IF NOT EXISTS base_ib_organizations_bin_idx ON base_ib_organizations (bin);
