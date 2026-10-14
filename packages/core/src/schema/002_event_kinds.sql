-- 002：待办类型扩充（作业 / 实验）与逐条开关（开启倒计时 / 需要手动确认完成）、条目性质。
-- 事件表带 CHECK 约束，SQLite 无法直接改约束，因此按「改名 → 建新表 → 拷数据 → 删旧表」重建。
-- 先改名：SQLite 会把引用旧表的定义改指到新名字，避免删旧表时的级联影响新表。

ALTER TABLE events RENAME TO events_legacy_002;

CREATE TABLE events (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semester_id      TEXT REFERENCES semesters(id) ON DELETE SET NULL,
  parent_id        TEXT REFERENCES events(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN (
                     'exam','todo','temp','homework','lab','reschedule','holiday','makeup','workday')),
  title            TEXT NOT NULL,
  on_date          TEXT,
  start_at         INTEGER,
  end_at           INTEGER,
  all_day          INTEGER NOT NULL DEFAULT 0,
  location         TEXT,
  note             TEXT,
  done             INTEGER NOT NULL DEFAULT 0,
  countdown        INTEGER NOT NULL DEFAULT 0 CHECK (countdown IN (0,1)),
  manual_done      INTEGER NOT NULL DEFAULT 0 CHECK (manual_done IN (0,1)),
  nature           TEXT CHECK (nature IN ('course','lab')),
  priority         INTEGER CHECK (priority IN (1,2,3)),
  due_at           INTEGER,
  subject          TEXT,
  seat_no          TEXT,
  period_start     INTEGER CHECK (period_start BETWEEN 1 AND 40),
  period_end       INTEGER CHECK (period_end   BETWEEN 1 AND 40),
  weeks_mask       INTEGER,
  ref_schedule_id  TEXT REFERENCES course_schedules(id) ON DELETE CASCADE,
  action           TEXT CHECK (action IN ('move','cancel','room_change','add')),
  new_date         TEXT,
  new_period_start INTEGER CHECK (new_period_start BETWEEN 1 AND 40),
  new_period_end   INTEGER CHECK (new_period_end   BETWEEN 1 AND 40),
  new_room         TEXT,
  as_day_of_week   INTEGER CHECK (as_day_of_week BETWEEN 1 AND 7),
  source           TEXT CHECK (source IN ('builtin','manual','from_school')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  deleted_at       INTEGER,
  rev              INTEGER NOT NULL DEFAULT 0,
  dirty            INTEGER NOT NULL DEFAULT 0,

  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (priority IS NULL OR type = 'todo'),
  CHECK (due_at   IS NULL OR type IN ('todo','homework')),
  CHECK (subject  IS NULL OR type IN ('exam','todo','homework','lab')),
  CHECK (seat_no  IS NULL OR type = 'exam'),
  CHECK (period_start IS NULL OR type = 'lab'),
  CHECK (period_end   IS NULL OR type = 'lab'),
  CHECK (weeks_mask   IS NULL OR type = 'lab'),
  CHECK (type <> 'lab' OR (on_date IS NOT NULL AND period_start IS NOT NULL)),
  CHECK (type <> 'reschedule' OR (ref_schedule_id IS NOT NULL AND action IS NOT NULL)),
  CHECK (type <> 'reschedule' OR action <> 'move' OR new_date IS NOT NULL),
  CHECK (type NOT IN ('holiday','makeup','workday') OR on_date IS NOT NULL),
  CHECK (type <> 'makeup'      OR as_day_of_week IS NOT NULL),
  CHECK (type <> 'reschedule'  OR (new_period_end IS NULL OR new_period_start IS NOT NULL)),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  CHECK (new_period_end IS NULL OR new_period_start IS NULL OR new_period_end >= new_period_start)
);

INSERT INTO events (
  id, user_id, semester_id, parent_id, type, title, on_date, start_at, end_at, all_day,
  location, note, done, countdown, manual_done, nature, priority, due_at, subject, seat_no,
  period_start, period_end, weeks_mask, ref_schedule_id, action, new_date,
  new_period_start, new_period_end, new_room, as_day_of_week, source,
  created_at, updated_at, deleted_at, rev, dirty
)
SELECT
  id, user_id, semester_id, parent_id, type, title, on_date, start_at, end_at, all_day,
  location, note, done,
  -- 旧数据没有逐条开关：考试按「开启倒计时」的默认值补齐
  CASE WHEN type = 'exam' THEN 1 ELSE 0 END, 0, NULL, priority, due_at, subject, seat_no,
  NULL, NULL, NULL, ref_schedule_id, action, new_date,
  new_period_start, new_period_end, new_room, as_day_of_week, source,
  created_at, updated_at, deleted_at, rev, dirty
FROM events_legacy_002;

DROP TABLE events_legacy_002;

CREATE INDEX ix_events_user_time ON events(user_id, start_at);
CREATE INDEX ix_events_semester  ON events(semester_id);
CREATE INDEX ix_events_type_date ON events(type, on_date);
CREATE INDEX ix_events_parent    ON events(parent_id);
CREATE UNIQUE INDEX ux_events_day_kind
  ON events(semester_id, on_date)
  WHERE type IN ('holiday','makeup','workday') AND deleted_at IS NULL;
