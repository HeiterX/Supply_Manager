-- CORE-09: additive migration; no reset of historical procurement data.
CREATE TABLE "NextAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "assigneeId" TEXT,
  "dueAt" TIMESTAMP(3),
  "reminderAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NextAction_status_check" CHECK ("status" IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "NextAction_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "NextAction_one_active_per_task" ON "NextAction" ("taskId") WHERE "status" = 'ACTIVE';
CREATE INDEX "NextAction_taskId_status_idx" ON "NextAction" ("taskId","status");
CREATE INDEX "NextAction_assigneeId_status_dueAt_idx" ON "NextAction" ("assigneeId","status","dueAt");
CREATE INDEX "NextAction_status_reminderAt_idx" ON "NextAction" ("status","reminderAt");
CREATE INDEX "NextAction_status_dueAt_idx" ON "NextAction" ("status","dueAt");
ALTER TABLE "NextAction" ADD CONSTRAINT "NextAction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NextAction" ADD CONSTRAINT "NextAction_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "NextActionHistory" (
  "id" TEXT NOT NULL PRIMARY KEY, "actionId" TEXT NOT NULL,
  "actorId" TEXT, "type" TEXT NOT NULL, "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "NextActionHistory_actionId_createdAt_idx" ON "NextActionHistory" ("actionId","createdAt");
ALTER TABLE "NextActionHistory" ADD CONSTRAINT "NextActionHistory_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "NextAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NextActionHistory" ADD CONSTRAINT "NextActionHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "NextActionNotification" (
  "id" TEXT NOT NULL PRIMARY KEY, "actionId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL, "type" TEXT NOT NULL, "title" TEXT NOT NULL, "message" TEXT,
  "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "NextActionNotification_eventKey_userId_key" ON "NextActionNotification" ("eventKey","userId");
CREATE INDEX "NextActionNotification_userId_readAt_createdAt_idx" ON "NextActionNotification" ("userId","readAt","createdAt");
CREATE INDEX "NextActionNotification_actionId_createdAt_idx" ON "NextActionNotification" ("actionId","createdAt");
ALTER TABLE "NextActionNotification" ADD CONSTRAINT "NextActionNotification_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "NextAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NextActionNotification" ADD CONSTRAINT "NextActionNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NextActionScheduleReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY, "actionId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "kind" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "NextActionScheduleReceipt_actionId_version_kind_key" ON "NextActionScheduleReceipt" ("actionId","version","kind");
ALTER TABLE "NextActionScheduleReceipt" ADD CONSTRAINT "NextActionScheduleReceipt_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "NextAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NextActionMutation" (
  "id" TEXT NOT NULL PRIMARY KEY, "actionId" TEXT NOT NULL, "key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL, "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "NextActionMutation_actionId_key_key" ON "NextActionMutation" ("actionId","key");
ALTER TABLE "NextActionMutation" ADD CONSTRAINT "NextActionMutation_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "NextAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Legacy open tasks are visible in an unassigned queue: never fabricate an owner or due date.
INSERT INTO "NextAction" ("id","taskId","title","assigneeId","dueAt","reminderAt","status","version","createdAt","updatedAt")
SELECT gen_random_uuid()::text, "id",
  LEFT(COALESCE(NULLIF(BTRIM("nextAction"),''),'Определить следующий шаг закупки'),500),
  NULL, NULL, "reminderAt", 'ACTIVE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Task"
WHERE "status" NOT IN ('CLOSED','CANCELLED');

INSERT INTO "NextActionHistory" ("id","actionId","actorId","type","comment")
SELECT gen_random_uuid()::text,"id",NULL,'CREATED','Перенесено из открытой закупки без автоматически назначенного ответственного'
FROM "NextAction";
