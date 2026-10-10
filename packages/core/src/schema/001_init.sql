-- 晓刻 初始建表。
-- 时刻列 INTEGER，单位 UTC epoch 毫秒；日期列 TEXT 'YYYY-MM-DD'；课表墙钟列 TEXT 'HH:MM'。
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  nickname    TEXT NOT NULL DEFAULT '我',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  rev         INTEGER NOT NULL DEFAULT 0,
  dirty       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE semesters (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  total_weeks INTEGER NOT NULL DEFAULT 20 CHECK (total_weeks BETWEEN 1 AND 30),
  time_zone   TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  rev         INTEGER NOT NULL DEFAULT 0,
  dirty       INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_semesters_active
  ON semesters(user_id) WHERE is_active = 1 AND deleted_at IS NULL;

CREATE TABLE time_slots (
  id          TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  period_no   INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 40),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  label       TEXT,
  section     TEXT CHECK (section IN ('am','pm','night')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  rev         INTEGER NOT NULL DEFAULT 0,
  dirty       INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_time_slots ON time_slots(semester_id, period_no)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_time_slots_semester ON time_slots(semester_id);

CREATE TABLE courses (
  id          TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  short_name  TEXT,
  teacher     TEXT,
  location    TEXT,
  color       TEXT NOT NULL DEFAULT '#4F8DFD',
  credits     REAL CHECK (credits IS NULL OR credits >= 0),
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  rev         INTEGER NOT NULL DEFAULT 0,
  dirty       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_courses_semester ON courses(semester_id);

CREATE TABLE course_schedules (
  id            TEXT PRIMARY KEY,
  course_id     TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period_start  INTEGER NOT NULL CHECK (period_start BETWEEN 1 AND 40),
  period_end    INTEGER NOT NULL CHECK (period_end   BETWEEN 1 AND 40),
  weeks_mask    INTEGER NOT NULL CHECK (weeks_mask > 0),
  weeks_raw     TEXT,
  room          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  rev           INTEGER NOT NULL DEFAULT 0,
  dirty         INTEGER NOT NULL DEFAULT 0,
  CHECK (period_end >= period_start)
);
CREATE INDEX ix_schedules_course ON course_schedules(course_id);
CREATE INDEX ix_schedules_day    ON course_schedules(day_of_week);

CREATE TABLE events (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semester_id      TEXT REFERENCES semesters(id) ON DELETE SET NULL,
  parent_id        TEXT REFERENCES events(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN (
                     'exam','todo','temp','reschedule','holiday','makeup','workday')),
  title            TEXT NOT NULL,
  on_date          TEXT,
  start_at         INTEGER,
  end_at           INTEGER,
  all_day          INTEGER NOT NULL DEFAULT 0,
  location         TEXT,
  note             TEXT,
  done             INTEGER NOT NULL DEFAULT 0,
  priority         INTEGER CHECK (priority IN (1,2,3)),
  due_at           INTEGER,
  subject          TEXT,
  seat_no          TEXT,
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
  CHECK (due_at   IS NULL OR type = 'todo'),
  CHECK (subject  IS NULL OR type = 'exam'),
  CHECK (seat_no  IS NULL OR type = 'exam'),
  CHECK (type <> 'reschedule' OR (ref_schedule_id IS NOT NULL AND action IS NOT NULL)),
  CHECK (type <> 'reschedule' OR action <> 'move' OR new_date IS NOT NULL),
  CHECK (type NOT IN ('holiday','makeup','workday') OR on_date IS NOT NULL),
  CHECK (type <> 'makeup'      OR as_day_of_week IS NOT NULL),
  CHECK (type <> 'reschedule'  OR (new_period_end IS NULL OR new_period_start IS NOT NULL)),
  CHECK (new_period_end IS NULL OR new_period_start IS NULL OR new_period_end >= new_period_start)
);
CREATE INDEX ix_events_user_time ON events(user_id, start_at);
CREATE INDEX ix_events_semester  ON events(semester_id);
CREATE INDEX ix_events_type_date ON events(type, on_date);
CREATE INDEX ix_events_parent    ON events(parent_id);
CREATE UNIQUE INDEX ux_events_day_kind
  ON events(semester_id, on_date)
  WHERE type IN ('holiday','makeup','workday') AND deleted_at IS NULL;

CREATE TABLE reminders (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type     TEXT NOT NULL CHECK (target_type IN ('course','schedule','event')),
  target_id       TEXT NOT NULL,
  advance_minutes INTEGER NOT NULL DEFAULT 10 CHECK (advance_minutes BETWEEN 0 AND 1440),
  enabled         INTEGER NOT NULL DEFAULT 1,
  skip_holidays   INTEGER NOT NULL DEFAULT 1,
  sound           INTEGER NOT NULL DEFAULT 1,
  vibrate         INTEGER NOT NULL DEFAULT 1,
  dnd             INTEGER NOT NULL DEFAULT 0 CHECK (dnd IN (0, 1, 2)),
  snooze_minutes  INTEGER CHECK (snooze_minutes IS NULL OR snooze_minutes BETWEEN 1 AND 120),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  rev             INTEGER NOT NULL DEFAULT 0,
  dirty           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_reminders_target ON reminders(target_type, target_id);

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
