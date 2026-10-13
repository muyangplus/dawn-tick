-- 005：due_at（截止时刻）对所有条目类型开放。
-- 之前限定只有待办与作业能写，实验/考试/日程带关联课程时会被拦住；事件表带 CHECK，SQLite 改约束需重建。
-- 顺序：先改名，再建新表，拷数据，最后删旧表（删除时的级联落在旧表上，不影响新表）。

ALTER TABLE events RENAME TO events_legacy_005;

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
  start_time       TEXT,
  end_time         TEXT,
  show_in_timetable INTEGER NOT NULL DEFAULT 0 CHECK (show_in_timetable IN (0,1)),
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
  period_start, period_end, weeks_mask, start_time, end_time, show_in_timetable,
  ref_schedule_id, action, new_date, new_period_start, new_period_end, new_room,
  as_day_of_week, source, created_at, updated_at, deleted_at, rev, dirty
)
SELECT
  id, user_id, semester_id, parent_id, type, title, on_date, start_at, end_at, all_day,
  location, note, done, countdown, manual_done, nature, priority, due_at, subject, seat_no,
  period_start, period_end, weeks_mask, start_time, end_time, show_in_timetable,
  ref_schedule_id, action, new_date, new_period_start, new_period_end, new_room,
  as_day_of_week, source, created_at, updated_at, deleted_at, rev, dirty
FROM events_legacy_005;

DROP TABLE events_legacy_005;

CREATE INDEX ix_events_user_time ON events(user_id, start_at);
CREATE INDEX ix_events_semester  ON events(semester_id);
CREATE INDEX ix_events_type_date ON events(type, on_date);
CREATE INDEX ix_events_parent    ON events(parent_id);
CREATE UNIQUE INDEX ux_events_day_kind
  ON events(semester_id, on_date)
  WHERE type IN ('holiday','makeup','workday') AND deleted_at IS NULL;
