"""一次性校验脚本（非项目代码）：验证 docs/01 草案 DDL 在真实 SQLite 上是否成立。
运行：python tmp/validate_schema.py
"""
import sqlite3
import sys

DDL = r"""
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  nickname    TEXT NOT NULL DEFAULT '我',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE TABLE semesters (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  total_weeks INTEGER NOT NULL DEFAULT 20 CHECK (total_weeks BETWEEN 1 AND 30),
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE UNIQUE INDEX ux_semesters_active
  ON semesters(user_id) WHERE is_active = 1 AND deleted_at IS NULL;

CREATE TABLE time_slots (
  id          TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  period_no   INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 20),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  label       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE UNIQUE INDEX ux_time_slots ON time_slots(semester_id, period_no)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_time_slots_semester ON time_slots(semester_id);

CREATE TABLE courses (
  id          TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  teacher     TEXT,
  location    TEXT,
  color       TEXT NOT NULL DEFAULT '#4F8DFD',
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX ix_courses_semester ON courses(semester_id);

CREATE TABLE course_schedules (
  id           TEXT PRIMARY KEY,
  course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period_start INTEGER NOT NULL CHECK (period_start BETWEEN 1 AND 20),
  period_end   INTEGER NOT NULL CHECK (period_end   BETWEEN 1 AND 20),
  week_start   INTEGER NOT NULL DEFAULT 1  CHECK (week_start BETWEEN 1 AND 30),
  week_end     INTEGER NOT NULL DEFAULT 20 CHECK (week_end   BETWEEN 1 AND 30),
  week_type    TEXT NOT NULL DEFAULT 'all'
                 CHECK (week_type IN ('all','odd','even','custom')),
  weeks        TEXT,
  room         TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  CHECK (period_end >= period_start),
  CHECK (week_end  >= week_start)
);
CREATE INDEX ix_schedules_course ON course_schedules(course_id);
CREATE INDEX ix_schedules_day    ON course_schedules(day_of_week);

CREATE TABLE reminders (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type     TEXT NOT NULL CHECK (target_type IN ('course','schedule','event')),
  target_id       TEXT NOT NULL,
  advance_minutes INTEGER NOT NULL DEFAULT 10 CHECK (advance_minutes BETWEEN 0 AND 1440),
  enabled         INTEGER NOT NULL DEFAULT 1,
  skip_holidays   INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER
);
CREATE INDEX ix_reminders_target ON reminders(target_type, target_id);

CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semester_id TEXT REFERENCES semesters(id) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN ('exam','todo','reschedule','temp')),
  title       TEXT NOT NULL,
  start_at    TEXT,
  end_at      TEXT,
  all_day     INTEGER NOT NULL DEFAULT 0,
  location    TEXT,
  note        TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  remind_at   INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX ix_events_user_time ON events(user_id, start_at);
CREATE INDEX ix_events_semester  ON events(semester_id);
CREATE INDEX ix_events_type      ON events(type);

CREATE TABLE course_adjustments (
  id                TEXT PRIMARY KEY,
  schedule_id       TEXT NOT NULL REFERENCES course_schedules(id) ON DELETE CASCADE,
  original_date     TEXT NOT NULL,
  new_date          TEXT,
  new_period_start  INTEGER,
  new_period_end    INTEGER,
  new_room          TEXT,
  action            TEXT NOT NULL CHECK (action IN ('move','cancel','room_change','add')),
  note              TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER
);
CREATE INDEX ix_adjust_schedule ON course_adjustments(schedule_id);
CREATE INDEX ix_adjust_dates    ON course_adjustments(original_date, new_date);

CREATE TABLE day_overrides (
  id             TEXT PRIMARY KEY,
  semester_id    TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('holiday','makeup','workday')),
  as_day_of_week INTEGER CHECK (as_day_of_week BETWEEN 1 AND 7),
  name           TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER
);
CREATE UNIQUE INDEX ux_day_overrides ON day_overrides(semester_id, date)
  WHERE deleted_at IS NULL;

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""

# 第 N 周某天的课（周视图核心查询）
WEEK_VIEW_SQL = """
SELECT c.name, c.color, s.period_start, s.period_end, COALESCE(s.room, c.location) AS room
FROM course_schedules s
JOIN courses c ON c.id = s.course_id
WHERE c.semester_id = :sid
  AND s.day_of_week = :dow
  AND :week BETWEEN s.week_start AND s.week_end
  AND ( s.week_type = 'all'
     OR (s.week_type = 'odd'  AND :week % 2 = 1)
     OR (s.week_type = 'even' AND :week % 2 = 0)
     OR  s.week_type = 'custom' )
  AND s.deleted_at IS NULL AND c.deleted_at IS NULL
ORDER BY s.period_start
"""

results = []


def ok(name, detail=""):
    results.append(("PASS", name, detail))


def fail(name, detail=""):
    results.append(("FAIL", name, detail))


def expect_reject(name, fn):
    """期望这条 SQL 被数据库拒绝"""
    try:
        fn()
    except sqlite3.Error as e:
        ok(name, f"按预期被拒绝: {type(e).__name__}")
        return
    fail(name, "本应被拒绝，但成功了")


con = sqlite3.connect(":memory:")
con.execute("PRAGMA foreign_keys=ON")
try:
    con.executescript(DDL)
    tables = [
        r[0]
        for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    ]
    ok("DDL 建表", f"{len(tables)} 张表: {', '.join(tables)}")
except sqlite3.Error as e:
    fail("DDL 建表", str(e))
    print("DDL 无法执行，后续校验无意义")
    sys.exit(1)

NOW = 1759900000000
U = "user-1"
S1 = "sem-1"
S2 = "sem-2"
C1 = "course-1"

con.execute("INSERT INTO users VALUES (?,?,?,?,NULL)", (U, "我", NOW, NOW))
con.execute(
    "INSERT INTO semesters VALUES (?,?,?,?,?,?,?,?,NULL)",
    (S1, U, "2026-2027 第一学期", "2026-09-07", 20, 1, NOW, NOW),
)
con.execute(
    "INSERT INTO time_slots VALUES (?,?,?,?,?,?,?,?,NULL)",
    ("ts-1", S1, 1, "08:00", "08:45", None, NOW, NOW),
)
con.execute(
    "INSERT INTO courses VALUES (?,?,?,?,?,?,?,?,?,NULL)",
    (C1, S1, "高等数学", "张老师", "教三-201", "#4F8DFD", None, NOW, NOW),
)
# 高数：周一 1-2 节，1-16 周
con.execute(
    "INSERT INTO course_schedules VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
    ("sch-1", C1, 1, 1, 2, 1, 16, "all", None, None, NOW, NOW),
)
# 大学物理：周三 3-4 节，仅双周 2-16 周
con.execute(
    "INSERT INTO courses VALUES (?,?,?,?,?,?,?,?,?,NULL)",
    ("course-2", S1, "大学物理", "李老师", "理科楼-105", "#F2994A", None, NOW, NOW),
)
con.execute(
    "INSERT INTO course_schedules VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
    ("sch-2", "course-2", 3, 3, 4, 2, 16, "even", None, None, NOW, NOW),
)
ok("基础数据写入", "用户/学期/节次/课程/两条排课")

# --- 约束校验 ---
expect_reject(
    "每用户仅一个当前学期（部分唯一索引）",
    lambda: con.execute(
        "INSERT INTO semesters VALUES (?,?,?,?,?,?,?,?,NULL)",
        (S2, U, "2026-2027 第二学期", "2027-02-22", 20, 1, NOW, NOW),
    ),
)
expect_reject(
    "节次区间倒置被 CHECK 拦截",
    lambda: con.execute(
        "INSERT INTO course_schedules VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
        ("sch-bad", C1, 1, 5, 3, 1, 16, "all", None, None, NOW, NOW),
    ),
)
expect_reject(
    "星期越界(8)被拦截",
    lambda: con.execute(
        "INSERT INTO course_schedules VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
        ("sch-bad2", C1, 8, 1, 2, 1, 16, "all", None, None, NOW, NOW),
    ),
)
expect_reject(
    "同学期同节次重复被部分唯一索引拦截",
    lambda: con.execute(
        "INSERT INTO time_slots VALUES (?,?,?,?,?,?,?,?,NULL)",
        ("ts-dup", S1, 1, "09:00", "09:45", None, NOW, NOW),
    ),
)
expect_reject(
    "排课指向不存在的课程被外键拦截",
    lambda: con.execute(
        "INSERT INTO course_schedules VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
        ("sch-fk", "no-such-course", 2, 1, 2, 1, 16, "all", None, None, NOW, NOW),
    ),
)
expect_reject(
    "week_type 非法枚举被拦截",
    lambda: con.execute(
        "INSERT INTO course_schedules VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
        ("sch-bad3", C1, 2, 1, 2, 1, 16, "every-other", None, None, NOW, NOW),
    ),
)
expect_reject(
    "提前分钟越界(1441)被拦截",
    lambda: con.execute(
        "INSERT INTO reminders VALUES (?,?,?,?,?,?,?,?,?,NULL)",
        ("rem-bad", U, "course", C1, 1441, 1, 1, NOW, NOW),
    ),
)

# --- 周视图查询校验（这是模型是否可用的关键） ---
def week_view(week, dow):
    return con.execute(WEEK_VIEW_SQL, {"sid": S1, "dow": dow, "week": week}).fetchall()


r = week_view(3, 1)  # 第 3 周周一 → 应有高数
if len(r) == 1 and r[0][0] == "高等数学":
    ok("周视图：第3周周一命中高数 1-2 节", str(r))
else:
    fail("周视图：第3周周一", str(r))

r = week_view(3, 3)  # 第 3 周周三，单周 → 物理是双周，应无课
if r == []:
    ok("周视图：第3周(单周)周三无双周物理课", "正确")
else:
    fail("周视图：第3周周三本应无课", str(r))

r = week_view(4, 3)  # 第 4 周周三，双周 → 应有物理
if len(r) == 1 and r[0][0] == "大学物理":
    ok("周视图：第4周(双周)周三命中物理", str(r))
else:
    fail("周视图：第4周周三", str(r))

r = week_view(17, 1)  # 第 17 周，超出 1-16 周范围
if r == []:
    ok("周视图：第17周超出周次范围，无课", "正确")
else:
    fail("周视图：第17周本应无课", str(r))

# --- 删除课程是否级联 ---
con.execute("DELETE FROM courses WHERE id=?", ("course-2",))
left = con.execute(
    "SELECT COUNT(*) FROM course_schedules WHERE course_id=?", ("course-2",)
).fetchone()[0]
if left == 0:
    ok("删除课程级联删除其排课", "ON DELETE CASCADE 生效")
else:
    fail("删除课程未级联排课", f"剩余 {left} 条")

# --- 软删除与部分唯一索引的相互作用（风险 R3） ---
con.execute("UPDATE time_slots SET deleted_at=? WHERE id=?", (NOW, "ts-1"))
try:
    con.execute(
        "INSERT INTO time_slots VALUES (?,?,?,?,?,?,?,?,NULL)",
        ("ts-new", S1, 1, "08:00", "08:45", None, NOW, NOW),
    )
    ok("软删除后可在同一节次重建记录", "部分唯一索引按预期放行")
except sqlite3.Error as e:
    fail("软删除后重建记录被拦", str(e))

print("\n=== 数据模型草案 SQLite 校验结果 ===")
for status, name, detail in results:
    print(f"[{status}] {name}" + (f"  — {detail}" if detail else ""))
failed = [r for r in results if r[0] == "FAIL"]
print(f"\n合计 {len(results)} 项，通过 {len(results) - len(failed)} 项，失败 {len(failed)} 项")
sys.exit(1 if failed else 0)
