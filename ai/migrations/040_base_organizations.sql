-- Организации базы 1С (задачи и заметки в чате 1С, план PLAN_1C_TASKS_NOTES_2026-09-22).
--
-- ЗАЧЕМ. Токен базы несёт ОДНУ организацию ERP, а база 1С бывает многофирменной: задачи и
-- заметки запрашиваются по БИН организации, выбранной в форме. Без этого списка сервис не мог
-- бы отличить «своя организация базы» от произвольного БИН, присланного в запросе, — и по
-- чужому БИН отдал бы чужие задачи.
--
-- Список заполняется из заявки на регистрацию базы (в ней организации уже приходят) и
-- пополняется самой базой: в 1С могут завести новую организацию после регистрации.
CREATE TABLE IF NOT EXISTS base_organizations (
	base_id    text        NOT NULL,
	bin        text        NOT NULL,
	name       text,
	onec_id    text,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (base_id, bin)
);

CREATE INDEX IF NOT EXISTS base_organizations_bin_idx ON base_organizations (bin);
