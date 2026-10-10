"""校验 docs/01-数据模型设计.md 的建表 SQL、约束与关键查询。不参与产品运行。"""

import sqlite3
import sys

DDL = r"""
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
  start_at         TEXT,
  end_at           TEXT,
  all_day          INTEGER NOT NULL DEFAULT 0,
  location         TEXT,
  note             TEXT,
  done             INTEGER NOT NULL DEFAULT 0,
  priority         INTEGER CHECK (priority IN (1,2,3)),
  due_at           TEXT,
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
  dnd             INTEGER NOT NULL DEFAULT 0,
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
"""

WEEK_VIEW_SQL = """
SELECT c.name, c.short_name, c.color, cs.period_start, cs.period_end,
       COALESCE(cs.room, c.location) AS room
FROM course_schedules cs
JOIN courses c ON c.id = cs.course_id
WHERE c.semester_id = :sid
  AND cs.day_of_week = :dow
  AND (cs.weeks_mask >> (:week - 1)) & 1 = 1
  AND cs.deleted_at IS NULL AND c.deleted_at IS NULL
ORDER BY cs.period_start
"""

DAY_KIND_SQL = """
SELECT type, as_day_of_week, source FROM events
WHERE semester_id = ? AND on_date = ?
  AND type IN ('holiday','makeup','workday') AND deleted_at IS NULL
ORDER BY CASE source WHEN 'manual' THEN 1 WHEN 'from_school' THEN 2 ELSE 3 END
LIMIT 1
"""

results = []


def ok(name, detail=""):
    results.append(("PASS", name, detail))


def fail(name, detail=""):
    results.append(("FAIL", name, detail))


def expect_reject(name, fn):
    try:
        fn()
    except sqlite3.Error as e:
        ok(name, f"按预期被拒绝: {type(e).__name__}")
        return
    fail(name, "本应被拒绝，但成功了")


def mask_of(weeks):
    """周次集合 -> 位图：第 N 周 = 第 (N-1) 位。"""
    return sum(1 << (w - 1) for w in weeks)


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


def add_time_slot(sid, no, st, en, sec):
    con.execute(
        "INSERT INTO time_slots (id,semester_id,period_no,start_time,end_time,label,section,"
        "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (sid, S1, no, st, en, None, sec, NOW, NOW),
    )


def add_course(cid, name, short, teacher, loc, color, credits, note):
    con.execute(
        "INSERT INTO courses (id,semester_id,name,short_name,teacher,location,color,credits,"
        "note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (cid, S1, name, short, teacher, loc, color, credits, note, NOW, NOW),
    )


def add_schedule(sid, course, dow, ps, pe, mask, raw=None, room=None):
    con.execute(
        "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,"
        "weeks_mask,weeks_raw,room,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (sid, course, dow, ps, pe, mask, raw, room, NOW, NOW),
    )


EVENT_COLS = (
    "id,user_id,semester_id,parent_id,type,title,on_date,start_at,end_at,all_day,location,"
    "note,done,priority,due_at,subject,seat_no,ref_schedule_id,action,new_date,"
    "new_period_start,new_period_end,new_room,as_day_of_week,source,created_at,updated_at"
)


def insert_event(**kw):
    vals = {
        "id": "e-x", "user_id": U, "semester_id": S1, "parent_id": None, "type": "temp",
        "title": "t", "on_date": None, "start_at": None, "end_at": None, "all_day": 0,
        "location": None, "note": None, "done": 0, "priority": None, "due_at": None,
        "subject": None, "seat_no": None, "ref_schedule_id": None, "action": None,
        "new_date": None, "new_period_start": None, "new_period_end": None, "new_room": None,
        "as_day_of_week": None, "source": None, "created_at": NOW, "updated_at": NOW,
    }
    vals.update(kw)
    cols = EVENT_COLS.split(",")
    con.execute(
        f"INSERT INTO events ({EVENT_COLS}) VALUES ({','.join(['?'] * len(cols))})",
        tuple(vals[c] for c in cols),
    )


# 基础数据
con.execute(
    "INSERT INTO users (id,nickname,created_at,updated_at) VALUES (?,?,?,?)",
    (U, "我", NOW, NOW),
)
con.execute(
    "INSERT INTO semesters (id,user_id,name,start_date,total_weeks,is_active,created_at,updated_at)"
    " VALUES (?,?,?,?,?,?,?,?)",
    (S1, U, "2026-2027 第一学期", "2026-09-07", 20, 1, NOW, NOW),
)

for no, (st, en, sec) in enumerate(
    [("08:00", "08:45", "am"), ("08:55", "09:40", "am"), ("10:00", "10:45", "am"),
     ("10:55", "11:40", "am"), ("14:00", "14:45", "pm"), ("14:55", "15:40", "pm")],
    start=1,
):
    add_time_slot(f"ts-{no}", no, st, en, sec)

add_course("c-1", "高等数学", "高数", "张老师", "教三-201", "#4F8DFD", 5.0, None)
add_course("c-2", "大学物理", "大物", "李老师", "理科楼-105", "#F2994A", 3.5, "需带计算器")
add_course("c-3", "大学英语", "大英", "王老师", "外语楼-302", "#27AE60", 2.0, None)

add_schedule("s-1", "c-1", 1, 1, 2, mask_of(range(1, 17)), "1-16周")
add_schedule("s-2", "c-2", 3, 3, 4, mask_of(range(2, 17, 2)), "2-16周(双)")
add_schedule("s-3", "c-3", 5, 5, 6, mask_of([1, 3, 5, 7]), "1,3,5,7周")
ok("基础数据写入", "1 用户 / 1 学期 / 6 节次 / 3 课程 / 3 排课（连续·双周·碎片）")

# 同步预留字段
row = con.execute("SELECT rev, dirty FROM courses WHERE id='c-1'").fetchone()
if row == (0, 0):
    ok("同步预留字段默认值为 0", f"rev={row[0]}, dirty={row[1]}")
else:
    fail("同步预留字段默认值", str(row))

con.execute("UPDATE courses SET dirty=1, rev=rev+1 WHERE id='c-1'")
row = con.execute("SELECT rev, dirty FROM courses WHERE id='c-1'").fetchone()
if row == (1, 1):
    ok("同步预留字段可写入", f"rev={row[0]}, dirty={row[1]}")
else:
    fail("同步预留字段可写入", str(row))

meta_cols = [r[1] for r in con.execute("PRAGMA table_info(app_meta)").fetchall()]
if "rev" not in meta_cols and "dirty" not in meta_cols:
    ok("app_meta 不含同步字段", "本地键值表不参与同步")
else:
    fail("app_meta 不该有同步字段", str(meta_cols))

# 位图编码
for label, weeks, want in [
    ("第1-16周 = 65535", range(1, 17), 65535),
    ("第1/3/5/7周 = 85", [1, 3, 5, 7], 85),
    ("双周2-16 = 43690", range(2, 17, 2), 43690),
]:
    got = mask_of(weeks)
    if got == want:
        ok(f"位图：{label}", "与手算一致")
    else:
        fail(f"位图：{label}", f"得到 {got}，期望 {want}")

# 约束
expect_reject(
    "每用户仅一个当前学期（部分唯一索引）",
    lambda: con.execute(
        "INSERT INTO semesters (id,user_id,name,start_date,total_weeks,is_active,created_at,"
        "updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (S2, U, "2026-2027 第二学期", "2027-02-22", 20, 1, NOW, NOW),
    ),
)
expect_reject("节次区间倒置被 CHECK 拦截", lambda: add_schedule("x1", "c-1", 1, 5, 3, 1))
expect_reject("星期越界(8)被拦截", lambda: add_schedule("x2", "c-1", 8, 1, 2, 1))
expect_reject("空周次位图(0)被拦截", lambda: add_schedule("x3", "c-1", 2, 1, 2, 0))
expect_reject("节次上限 41 被拦截", lambda: add_time_slot("ts-x", 41, "22:00", "22:45", None))
expect_reject(
    "同学期同节次重复被部分唯一索引拦截",
    lambda: add_time_slot("ts-dup", 1, "09:00", "09:45", None),
)
expect_reject("排课指向不存在的课程被外键拦截", lambda: add_schedule("x4", "nope", 2, 1, 2, 1))
expect_reject(
    "学分负数被拦截",
    lambda: add_course("c-x", "坏课", None, None, None, "#000000", -1.0, None),
)
expect_reject(
    "提前分钟越界(1441)被拦截",
    lambda: con.execute(
        "INSERT INTO reminders (id,user_id,target_type,target_id,advance_minutes,enabled,"
        "skip_holidays,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        ("r-x", U, "course", "c-1", 1441, 1, 1, NOW, NOW),
    ),
)

# events 七种语义
insert_event(id="e-exam", type="exam", title="高等数学期末",
             start_at="2027-01-10T09:00:00+08:00", subject="高等数学",
             location="教三-201", seat_no="A-12")
insert_event(id="e-todo", type="todo", title="交实验报告", priority=3,
             due_at="2026-10-20T22:00:00+08:00")
insert_event(id="e-temp", type="temp", title="班会", start_at="2026-10-15T19:00:00+08:00")
insert_event(id="e-holiday", type="holiday", title="国庆节", on_date="2026-10-01",
             source="builtin")
insert_event(id="e-makeup", type="makeup", title="国庆调休补课", on_date="2026-10-11",
             as_day_of_week=3, source="from_school")
insert_event(id="e-move", type="reschedule", title="高数改期", on_date="2026-10-12",
             ref_schedule_id="s-1", action="move", new_date="2026-10-14",
             new_period_start=3, new_period_end=4, new_room="教三-305")
insert_event(id="e-cancel", type="reschedule", title="大物停课", on_date="2026-10-14",
             ref_schedule_id="s-2", action="cancel")
ok("events 合法写入", "考试(含科目/考场/座位)/待办(含优先级/截止)/临时/放假/调休补课/调课改期/调课取消")

# 子任务（events 自关联）
insert_event(id="e-sub1", type="todo", parent_id="e-todo", title="写实验一")
insert_event(id="e-sub2", type="todo", parent_id="e-todo", title="写实验二")
subs = con.execute(
    "SELECT COUNT(*) FROM events WHERE parent_id='e-todo' AND deleted_at IS NULL"
).fetchone()[0]
if subs == 2:
    ok("待办子任务写入", f"父任务下有 {subs} 条子任务")
else:
    fail("待办子任务写入", f"子任务数 {subs}")

con.execute("DELETE FROM events WHERE id='e-todo'")
left = con.execute("SELECT COUNT(*) FROM events WHERE parent_id='e-todo'").fetchone()[0]
if left == 0:
    ok("删除父任务级联删除子任务", "ON DELETE CASCADE 生效")
else:
    fail("删除父任务未级联子任务", f"剩余 {left} 条")

expect_reject(
    "非待办类型带 priority 被拦截",
    lambda: insert_event(id="e-bad7", type="temp", title="坏优先级", priority=1),
)
expect_reject(
    "非待办类型带 due_at 被拦截",
    lambda: insert_event(id="e-bad8", type="exam", title="坏截止", due_at="2026-11-01"),
)
expect_reject(
    "非考试类型带 subject 被拦截",
    lambda: insert_event(id="e-bad9", type="temp", title="坏科目", subject="数学"),
)
expect_reject(
    "priority 越界(4)被拦截",
    lambda: insert_event(id="e-bad10", type="todo", title="坏等级", priority=4),
)
expect_reject(
    "events 自引用 parent_id 指向自己被拦截",
    lambda: insert_event(id="e-bad11", type="todo", title="自引用", parent_id="e-bad11"),
)
expect_reject(
    "snooze_minutes 越界(121)被拦截",
    lambda: con.execute(
        "INSERT INTO reminders (id,user_id,target_type,target_id,snooze_minutes,created_at,"
        "updated_at) VALUES (?,?,?,?,?,?,?)",
        ("r-y", U, "event", "e-temp", 121, NOW, NOW),
    ),
)
expect_reject(
    "调课缺 ref_schedule_id 被拦截",
    lambda: insert_event(id="e-bad1", type="reschedule", title="坏调课", action="cancel"),
)
expect_reject(
    "调课 action=move 缺 new_date 被拦截",
    lambda: insert_event(id="e-bad2", type="reschedule", title="坏调课", on_date="2026-10-12",
                         ref_schedule_id="s-1", action="move"),
)
expect_reject(
    "放假缺 on_date 被拦截",
    lambda: insert_event(id="e-bad3", type="holiday", title="坏放假"),
)
expect_reject(
    "调休补课缺 as_day_of_week 被拦截",
    lambda: insert_event(id="e-bad4", type="makeup", title="坏调休", on_date="2026-10-18"),
)
expect_reject(
    "同学期同一天重复定义放假/调休被拦截",
    lambda: insert_event(id="e-bad5", type="holiday", title="重复放假", on_date="2026-10-01"),
)
expect_reject(
    "调课新节次区间倒置被拦截",
    lambda: insert_event(id="e-bad6", type="reschedule", title="坏节次", on_date="2026-10-12",
                         ref_schedule_id="s-1", action="move", new_date="2026-10-13",
                         new_period_start=5, new_period_end=3),
)

# 提醒默认值
con.execute(
    "INSERT INTO reminders (id,user_id,target_type,target_id,created_at,updated_at) "
    "VALUES (?,?,?,?,?,?)",
    ("r-1", U, "course", "c-1", NOW, NOW),
)
row = con.execute(
    "SELECT advance_minutes, enabled, skip_holidays, sound, vibrate, dnd, snooze_minutes "
    "FROM reminders WHERE id='r-1'"
).fetchone()
if row == (10, 1, 1, 1, 1, 0, None):
    ok("提醒默认值", "advance=10, enabled=1, skip_holidays=1, sound=1, vibrate=1, dnd=0, snooze=NULL")
else:
    fail("提醒默认值", str(row))


# 周视图
def week_view(week, dow):
    return con.execute(WEEK_VIEW_SQL, {"sid": S1, "dow": dow, "week": week}).fetchall()


for week, dow, want_name, label in [
    (3, 1, "高等数学", "第3周周一命中高数 1-2 节"),
    (3, 3, None, "第3周(单周)周三无双周大物"),
    (4, 3, "大学物理", "第4周(双周)周三命中大物"),
    (17, 1, None, "第17周超出周次范围，无课"),
    (5, 5, "大学英语", "第5周周五命中碎片周次课程"),
    (6, 5, None, "第6周周五不在周次集合内，无课"),
    (7, 5, "大学英语", "第7周周五命中周次上界"),
]:
    r = week_view(week, dow)
    if want_name is None:
        if r == []:
            ok(f"周视图：{label}", "正确")
        else:
            fail(f"周视图：{label}", str(r))
    else:
        if len(r) == 1 and r[0][0] == want_name:
            ok(f"周视图：{label}", str(r))
        else:
            fail(f"周视图：{label}", str(r))

# 调休与来源优先级
r = con.execute(DAY_KIND_SQL, (S1, "2026-10-11")).fetchall()
if len(r) == 1 and r[0][0] == "makeup" and r[0][1] == 3:
    ok("调休查询：10/11 为补课日且按周三上课", str(r))
else:
    fail("调休查询：10/11", str(r))

POLICY = {"manual": 1, "from_school": 2, "builtin": 3}


def apply_day_kind(ev_id, on_date, kind, source, title):
    """按来源优先级写入某天的放假/调休判定。"""
    cur = con.execute(
        "SELECT id, source FROM events WHERE semester_id=? AND on_date=? "
        "AND type IN ('holiday','makeup','workday') AND deleted_at IS NULL",
        (S1, on_date),
    ).fetchone()
    if cur is None:
        insert_event(id=ev_id, type=kind, title=title, on_date=on_date, source=source)
        return "insert"
    if POLICY[source] < POLICY[cur[1]]:
        con.execute(
            "UPDATE events SET source=?, title=?, updated_at=? WHERE id=?",
            (source, title, NOW, cur[0]),
        )
        return "overwrite"
    return "skip"


def day_kind_rows(on_date):
    return con.execute(
        "SELECT source FROM events WHERE semester_id=? AND on_date=? "
        "AND type IN ('holiday','makeup','workday') AND deleted_at IS NULL",
        (S1, on_date),
    ).fetchall()


insert_event(id="e-p1", type="holiday", title="内置放假", on_date="2026-10-03",
             source="builtin")
act1 = apply_day_kind("e-p2", "2026-10-03", "holiday", "from_school", "教务校历")
rows1 = day_kind_rows("2026-10-03")
if act1 == "overwrite" and len(rows1) == 1 and rows1[0][0] == "from_school":
    ok("来源优先级：教务校历覆盖内置，每天仅一条",
       f"action={act1}, source={rows1[0][0]}, 行数={len(rows1)}")
else:
    fail("来源优先级覆盖失败", f"action={act1}, rows={rows1}")

insert_event(id="e-p3", type="holiday", title="手动改判", on_date="2026-10-04",
             source="manual")
act2 = apply_day_kind("e-p4", "2026-10-04", "holiday", "builtin", "内置放假")
rows2 = day_kind_rows("2026-10-04")
if act2 == "skip" and len(rows2) == 1 and rows2[0][0] == "manual":
    ok("来源优先级：内置不覆盖手动", f"action={act2}, source={rows2[0][0]}")
else:
    fail("内置错误覆盖了手动", f"action={act2}, rows={rows2}")

expect_reject(
    "同一天插入第二条放假记录被部分唯一索引拦截",
    lambda: insert_event(id="e-p5", type="holiday", title="重复", on_date="2026-10-03",
                         source="manual"),
)

r = con.execute(
    "SELECT action, new_date, new_period_start, new_period_end, new_room FROM events "
    "WHERE type='reschedule' AND ref_schedule_id=? AND on_date=? AND deleted_at IS NULL",
    ("s-1", "2026-10-12"),
).fetchall()
if len(r) == 1 and r[0][0] == "move" and r[0][1] == "2026-10-14":
    ok("调课查询：10/12 的高数改到 10/14 第3-4节 教三-305", str(r))
else:
    fail("调课查询：s-1 @ 2026-10-12", str(r))

# 级联与软删除
con.execute("DELETE FROM courses WHERE id=?", ("c-2",))
left = con.execute(
    "SELECT COUNT(*) FROM course_schedules WHERE course_id=?", ("c-2",)
).fetchone()[0]
if left == 0:
    ok("删除课程级联删除其排课", "ON DELETE CASCADE 生效")
else:
    fail("删除课程未级联排课", f"剩余 {left} 条")

con.execute("DELETE FROM course_schedules WHERE id=?", ("s-1",))
left = con.execute(
    "SELECT COUNT(*) FROM events WHERE ref_schedule_id=?", ("s-1",)
).fetchone()[0]
if left == 0:
    ok("删除排课级联删除其调课记录", "events.ref_schedule_id 级联生效")
else:
    fail("删除排课未级联调课", f"剩余 {left} 条")

con.execute("UPDATE time_slots SET deleted_at=? WHERE id=?", (NOW, "ts-1"))
try:
    add_time_slot("ts-new", 1, "08:00", "08:45", "am")
    ok("软删除后可在同一节次重建记录", "部分唯一索引按预期放行")
except sqlite3.Error as e:
    fail("软删除后重建记录被拦", str(e))

for status, name, detail in results:
    print(f"[{status}] {name}" + (f"  — {detail}" if detail else ""))
failed = [r for r in results if r[0] == "FAIL"]
print(f"\n合计 {len(results)} 项，通过 {len(results) - len(failed)} 项，失败 {len(failed)} 项")
sys.exit(1 if failed else 0)
