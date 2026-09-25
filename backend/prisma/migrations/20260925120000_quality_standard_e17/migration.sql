-- E17 «СТАНДАРТ КАЧЕСТВА БУХПРОФ» (docs/PLAN_QUALITY_STANDARD_2026-09-25.md).
--
-- ЗАЧЕМ. Стандарт из 40 пунктов: одно подтверждённое нарушение — бонус за месяц не начисляется.
-- ERP ведёт реестр нарушений (ядро), а правила по задачам, проверкам учёта 1С, чек-листам и
-- посещаемости только предлагают кандидатов — подтверждает человек.
--
-- ЧТО МЕНЯЕТСЯ В СУЩЕСТВУЮЩЕМ. Только добавления:
--   * todos — вид, приоритет, SLA, результат, контроль, напоминания, эскалация, оценка клиента;
--   * todo_statuses.isWaiting и два статуса ожидания («ждём клиента/контрагента»);
--   * scheduled_tasks — что создаёт расписание (регламентные задачи, СК1.7).
-- Все новые колонки со значениями по умолчанию: старый код их не видит и не ломается.
--
-- КАК СОБРАНА. Diff двух схем (прежняя schema.prisma → новая), а не полный diff с базой —
-- полный снёс бы trgm- и partial-индексы (см. scripts/check-schema-drift.sh).

-- AlterTable
ALTER TABLE "todo_statuses" ADD COLUMN     "isWaiting" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "todos" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "checkCode" TEXT,
ADD COLUMN     "clientRating" INTEGER,
ADD COLUMN     "clientRatingNote" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "errorTypeUuid" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalationLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "firstResponseAt" TIMESTAMP(3),
ADD COLUMN     "helpRequestedAt" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'task',
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "nextControlAt" TIMESTAMP(3),
ADD COLUMN     "parentTodoUuid" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN     "reactionDueAt" TIMESTAMP(3),
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reportedBy" TEXT,
ADD COLUMN     "result" TEXT,
ADD COLUMN     "returnedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "scheduled_tasks" ADD COLUMN     "deadlineDays" INTEGER,
ADD COLUMN     "executorUuid" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'regulation',
ADD COLUMN     "staffGroupUuid" TEXT;

-- CreateTable
CREATE TABLE "todo_events" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "todoUuid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorUuid" TEXT,
    "actorName" TEXT,
    "fromUserUuid" TEXT,
    "toUserUuid" TEXT,
    "channel" TEXT,
    "note" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todo_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todo_watchers" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "todoUuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'transfer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todo_watchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_groups" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "name" TEXT NOT NULL,
    "headUuid" TEXT,
    "managerUuid" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "staff_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_group_members" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "groupUuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_group_clients" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "groupUuid" TEXT NOT NULL,
    "clientOrganizationUuid" TEXT NOT NULL,
    "responsibleUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_group_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_types" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "error_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'employee',
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "standard_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_violations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "userUuid" TEXT NOT NULL,
    "clientOrganizationUuid" TEXT,
    "standardItemUuid" TEXT,
    "itemNumber" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bonusMonth" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "ruleKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "selfDetected" BOOLEAN NOT NULL DEFAULT false,
    "selfDetectedInfo" JSONB,
    "createdByUuid" TEXT,
    "decidedByUuid" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "disputeText" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputeDecidedByUuid" TEXT,
    "disputeDecidedAt" TIMESTAMP(3),
    "disputeDecision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "standard_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violation_measures" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "userUuid" TEXT NOT NULL,
    "violationUuid" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'talk',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdByUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "violation_measures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_months" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedByUuid" TEXT,
    "results" JSONB,

    CONSTRAINT "bonus_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" JSONB,
    "dedupKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_telegram_links" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "chatId" TEXT,
    "linkCode" TEXT,
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_runs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "baseKey" TEXT,
    "checkCode" TEXT NOT NULL,
    "checkVersion" INTEGER,
    "scope" TEXT,
    "status" TEXT NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "total" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "params" JSONB,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "onDate" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "skipReason" TEXT,
    "durationMs" INTEGER,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_findings" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "checkCode" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "factDate" TIMESTAMP(3),
    "amount" DECIMAL(18,2),
    "data" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunUuid" TEXT,
    "todoUuid" TEXT,
    "exceptionReason" TEXT,
    "exceptionByUuid" TEXT,
    "exceptionAt" TIMESTAMP(3),
    "exceptionUntil" TIMESTAMP(3),
    "candidateAt" TIMESTAMP(3),

    CONSTRAINT "check_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_snapshots" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "baseKey" TEXT,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "onDate" TIMESTAMP(3),
    "rows" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kn_statements" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "onDate" TIMESTAMP(3) NOT NULL,
    "rows" JSONB NOT NULL,
    "comparison" JSONB,
    "userUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "kn_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "primary_docs_receipts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "userUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "primary_docs_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "periodicity" TEXT NOT NULL DEFAULT 'month',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "templateUuid" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "checkCode" TEXT,
    "standardItemNumber" INTEGER,

    CONSTRAINT "checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_runs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "clientOrganizationUuid" TEXT NOT NULL,
    "templateUuid" TEXT,
    "name" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "executorUuid" TEXT,
    "reviewerUuid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "checklist_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_run_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "runUuid" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "checkCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "comment" TEXT,
    "confirmedByUuid" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "checklist_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_schedules" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '18:00',
    "workDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_day_marks" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'button',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_day_marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absence_requests" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dateFrom" TEXT NOT NULL,
    "dateTo" TEXT NOT NULL,
    "timeFrom" TEXT,
    "timeTo" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "unforeseen" BOOLEAN NOT NULL DEFAULT false,
    "decidedByUuid" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "absence_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "todo_events_uuid_key" ON "todo_events"("uuid");

-- CreateIndex
CREATE INDEX "todo_events_todoUuid_createdAt_idx" ON "todo_events"("todoUuid", "createdAt");

-- CreateIndex
CREATE INDEX "todo_events_type_createdAt_idx" ON "todo_events"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "todo_watchers_uuid_key" ON "todo_watchers"("uuid");

-- CreateIndex
CREATE INDEX "todo_watchers_userUuid_idx" ON "todo_watchers"("userUuid");

-- CreateIndex
CREATE UNIQUE INDEX "todo_watchers_todoUuid_userUuid_key" ON "todo_watchers"("todoUuid", "userUuid");

-- CreateIndex
CREATE UNIQUE INDEX "staff_groups_uuid_key" ON "staff_groups"("uuid");

-- CreateIndex
CREATE INDEX "staff_groups_organizationUuid_idx" ON "staff_groups"("organizationUuid");

-- CreateIndex
CREATE INDEX "staff_groups_headUuid_idx" ON "staff_groups"("headUuid");

-- CreateIndex
CREATE INDEX "staff_groups_managerUuid_idx" ON "staff_groups"("managerUuid");

-- CreateIndex
CREATE UNIQUE INDEX "staff_group_members_uuid_key" ON "staff_group_members"("uuid");

-- CreateIndex
CREATE INDEX "staff_group_members_userUuid_idx" ON "staff_group_members"("userUuid");

-- CreateIndex
CREATE UNIQUE INDEX "staff_group_members_groupUuid_userUuid_key" ON "staff_group_members"("groupUuid", "userUuid");

-- CreateIndex
CREATE UNIQUE INDEX "staff_group_clients_uuid_key" ON "staff_group_clients"("uuid");

-- CreateIndex
CREATE INDEX "staff_group_clients_clientOrganizationUuid_idx" ON "staff_group_clients"("clientOrganizationUuid");

-- CreateIndex
CREATE INDEX "staff_group_clients_responsibleUuid_idx" ON "staff_group_clients"("responsibleUuid");

-- CreateIndex
CREATE UNIQUE INDEX "staff_group_clients_groupUuid_clientOrganizationUuid_key" ON "staff_group_clients"("groupUuid", "clientOrganizationUuid");

-- CreateIndex
CREATE UNIQUE INDEX "error_types_uuid_key" ON "error_types"("uuid");

-- CreateIndex
CREATE INDEX "error_types_organizationUuid_idx" ON "error_types"("organizationUuid");

-- CreateIndex
CREATE UNIQUE INDEX "standard_items_uuid_key" ON "standard_items"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "standard_items_organizationUuid_number_key" ON "standard_items"("organizationUuid", "number");

-- CreateIndex
CREATE UNIQUE INDEX "standard_violations_uuid_key" ON "standard_violations"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "standard_violations_ruleKey_key" ON "standard_violations"("ruleKey");

-- CreateIndex
CREATE INDEX "standard_violations_organizationUuid_bonusMonth_idx" ON "standard_violations"("organizationUuid", "bonusMonth");

-- CreateIndex
CREATE INDEX "standard_violations_userUuid_status_idx" ON "standard_violations"("userUuid", "status");

-- CreateIndex
CREATE INDEX "standard_violations_clientOrganizationUuid_idx" ON "standard_violations"("clientOrganizationUuid");

-- CreateIndex
CREATE INDEX "standard_violations_status_idx" ON "standard_violations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "violation_measures_uuid_key" ON "violation_measures"("uuid");

-- CreateIndex
CREATE INDEX "violation_measures_organizationUuid_userUuid_idx" ON "violation_measures"("organizationUuid", "userUuid");

-- CreateIndex
CREATE UNIQUE INDEX "bonus_months_uuid_key" ON "bonus_months"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "bonus_months_organizationUuid_month_key" ON "bonus_months"("organizationUuid", "month");

-- CreateIndex
CREATE UNIQUE INDEX "user_notifications_uuid_key" ON "user_notifications"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "user_notifications_dedupKey_key" ON "user_notifications"("dedupKey");

-- CreateIndex
CREATE INDEX "user_notifications_userUuid_readAt_idx" ON "user_notifications"("userUuid", "readAt");

-- CreateIndex
CREATE INDEX "user_notifications_createdAt_idx" ON "user_notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_telegram_links_uuid_key" ON "user_telegram_links"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "user_telegram_links_userUuid_key" ON "user_telegram_links"("userUuid");

-- CreateIndex
CREATE UNIQUE INDEX "user_telegram_links_linkCode_key" ON "user_telegram_links"("linkCode");

-- CreateIndex
CREATE UNIQUE INDEX "check_runs_uuid_key" ON "check_runs"("uuid");

-- CreateIndex
CREATE INDEX "check_runs_organizationUuid_checkCode_createdAt_idx" ON "check_runs"("organizationUuid", "checkCode", "createdAt");

-- CreateIndex
CREATE INDEX "check_runs_createdAt_idx" ON "check_runs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "check_findings_uuid_key" ON "check_findings"("uuid");

-- CreateIndex
CREATE INDEX "check_findings_organizationUuid_checkCode_resolvedAt_idx" ON "check_findings"("organizationUuid", "checkCode", "resolvedAt");

-- CreateIndex
CREATE INDEX "check_findings_resolvedAt_idx" ON "check_findings"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "check_findings_organizationUuid_fingerprint_key" ON "check_findings"("organizationUuid", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_snapshots_uuid_key" ON "accounting_snapshots"("uuid");

-- CreateIndex
CREATE INDEX "accounting_snapshots_organizationUuid_code_createdAt_idx" ON "accounting_snapshots"("organizationUuid", "code", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "kn_statements_uuid_key" ON "kn_statements"("uuid");

-- CreateIndex
CREATE INDEX "kn_statements_organizationUuid_onDate_idx" ON "kn_statements"("organizationUuid", "onDate");

-- CreateIndex
CREATE UNIQUE INDEX "primary_docs_receipts_uuid_key" ON "primary_docs_receipts"("uuid");

-- CreateIndex
CREATE INDEX "primary_docs_receipts_organizationUuid_month_idx" ON "primary_docs_receipts"("organizationUuid", "month");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_uuid_key" ON "checklist_templates"("uuid");

-- CreateIndex
CREATE INDEX "checklist_templates_organizationUuid_idx" ON "checklist_templates"("organizationUuid");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_template_items_uuid_key" ON "checklist_template_items"("uuid");

-- CreateIndex
CREATE INDEX "checklist_template_items_templateUuid_idx" ON "checklist_template_items"("templateUuid");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_runs_uuid_key" ON "checklist_runs"("uuid");

-- CreateIndex
CREATE INDEX "checklist_runs_organizationUuid_idx" ON "checklist_runs"("organizationUuid");

-- CreateIndex
CREATE INDEX "checklist_runs_clientOrganizationUuid_periodFrom_idx" ON "checklist_runs"("clientOrganizationUuid", "periodFrom");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_run_items_uuid_key" ON "checklist_run_items"("uuid");

-- CreateIndex
CREATE INDEX "checklist_run_items_runUuid_idx" ON "checklist_run_items"("runUuid");

-- CreateIndex
CREATE INDEX "checklist_run_items_checkCode_idx" ON "checklist_run_items"("checkCode");

-- CreateIndex
CREATE UNIQUE INDEX "work_schedules_uuid_key" ON "work_schedules"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "work_schedules_organizationUuid_userUuid_key" ON "work_schedules"("organizationUuid", "userUuid");

-- CreateIndex
CREATE UNIQUE INDEX "work_day_marks_uuid_key" ON "work_day_marks"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "work_day_marks_organizationUuid_userUuid_date_key" ON "work_day_marks"("organizationUuid", "userUuid", "date");

-- CreateIndex
CREATE UNIQUE INDEX "absence_requests_uuid_key" ON "absence_requests"("uuid");

-- CreateIndex
CREATE INDEX "absence_requests_organizationUuid_userUuid_dateFrom_idx" ON "absence_requests"("organizationUuid", "userUuid", "dateFrom");

-- CreateIndex
CREATE INDEX "todos_kind_idx" ON "todos"("kind");

-- CreateIndex
CREATE INDEX "todos_parentTodoUuid_idx" ON "todos"("parentTodoUuid");

-- CreateIndex
CREATE INDEX "todos_organizationUuid_checkCode_idx" ON "todos"("organizationUuid", "checkCode");

-- AddForeignKey
ALTER TABLE "staff_group_members" ADD CONSTRAINT "staff_group_members_groupUuid_fkey" FOREIGN KEY ("groupUuid") REFERENCES "staff_groups"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_group_clients" ADD CONSTRAINT "staff_group_clients_groupUuid_fkey" FOREIGN KEY ("groupUuid") REFERENCES "staff_groups"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_templateUuid_fkey" FOREIGN KEY ("templateUuid") REFERENCES "checklist_templates"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_run_items" ADD CONSTRAINT "checklist_run_items_runUuid_fkey" FOREIGN KEY ("runUuid") REFERENCES "checklist_runs"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;


-- Статусы ожидания: не финальные и требуют даты следующего контроля (СК1.2). Коды новые,
-- поэтому существующие задачи и доска не меняются; ON CONFLICT — на случай, если статус с
-- таким кодом уже завели руками.
INSERT INTO "todo_statuses" ("uuid", "code", "name", "sortOrder", "isFinal", "isWaiting", "updatedAt") VALUES
    (gen_random_uuid(), 'waiting_client', 'Ждём клиента', 24, false, true, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'waiting_counterparty', 'Ждём контрагента', 26, false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
