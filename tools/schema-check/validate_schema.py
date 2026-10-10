"""跨引擎校验 packages/core/src/schema/001_init.sql。不参与产品运行。"""

import sqlite3
import sys
from pathlib import Path

DDL_PATH = Path(__file__).resolve().parents[2] / "packages" / "core" / "src" / "schema" / "001_init.sql"
NOW = 1759900000000
U = "u1"
S1 = "sem-1"
S2 = "sem-2"

results = []


def ok(name, detail=""):
    results.append(("PASS", name, detail))


def fail(name, detail=""):
    results.append(("FAIL", name, detail))


def expect_reject(name, fn):
    try:
        fn()
    except sqlite3.Error as exc:
        ok(name, f"按预期被拒绝: {type(exc).__name__}")
        return
    fail(name, "本应被拒绝，但成功了")


def mask_of(weeks):
    """周次集合 -> 位图：第 N 周 = 第 (N-1) 位。"""
    return sum(1 << (w - 1) for w in weeks)


con = sqlite3.connect(":memory:")
con.execute("PRAGMA foreign_keys=ON")
try:
    con.executescript(DDL_PATH.read_text(encoding="utf-8"))
except sqlite3.Error as exc:
    print(f"DDL 执行失败: {exc}")
    sys.exit(1)

tables = [
    row[0]
    for row in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
]
expected_tables = [
    "app_meta",
    "course_schedules",
    "courses",
    "events",
    "reminders",
    "semesters",
    "time_slots",
    "users",
]
if tables == expected_tables:
    ok("建表", "8 张表")
else:
    fail("建表", str(tables))

int_columns = [("events", "start_at"), ("events", "end_at"), ("events", "due_at")]
text_columns = [
    ("events", "on_date"),
    ("events", "new_date"),
    ("semesters", "start_date"),
    ("time_slots", "start_time"),
]
bad = []
for table, column in int_columns:
    info = [row for row in con.execute(f"PRAGMA table_info({table})").fetchall() if row[1] == column]
    if not info or info[0][2].upper() != "INTEGER":
        bad.append(f"{table}.{column}")
for table, column in text_columns:
    info = [row for row in con.execute(f"PRAGMA table_info({table})").fetchall() if row[1] == column]
    if not info or info[0][2].upper() != "TEXT":
        bad.append(f"{table}.{column}")
if not bad:
    ok("时间列类型", "时刻为 INTEGER，日期与墙钟为 TEXT")
else:
    fail("时间列类型不符", str(bad))

con.execute(
    "INSERT INTO users (id,nickname,created_at,updated_at) VALUES (?,?,?,?)", (U, "我", NOW, NOW)
)
con.execute(
    "INSERT INTO semesters (id,user_id,name,start_date,total_weeks,time_zone,is_active,created_at,updated_at)"
    " VALUES (?,?,?,?,?,?,?,?,?)",
    (S1, U, "2026-2027 第一学期", "2026-09-07", 20, "Asia/Shanghai", 1, NOW, NOW),
)
tz = con.execute("SELECT time_zone FROM semesters WHERE id=?", (S1,)).fetchone()[0]
if tz == "Asia/Shanghai":
    ok("学期时区", tz)
else:
    fail("学期时区", str(tz))

for no, (start, end, section) in enumerate(
    [("08:00", "08:45", "am"), ("08:55", "09:40", "am"), ("10:00", "10:45", "am"),
     ("10:55", "11:40", "am"), ("14:00", "14:45", "pm"), ("14:55", "15:40", "pm")],
    start=1,
):
    con.execute(
        "INSERT INTO time_slots (id,semester_id,period_no,start_time,end_time,section,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (f"ts-{no}", S1, no, start, end, section, NOW, NOW),
    )

for cid, name, short, teacher, room, color, credits in [
    ("c-1", "高等数学", "高数", "张老师", "教三-201", "#4F8DFD", 5.0),
    ("c-2", "大学物理", "大物", "李老师", "理科楼-105", "#F2994A", 3.5),
    ("c-3", "大学英语", "大英", "王老师", "外语楼-302", "#27AE60", 2.0),
]:
    con.execute(
        "INSERT INTO courses (id,semester_id,name,short_name,teacher,location,color,credits,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (cid, S1, name, short, teacher, room, color, credits, NOW, NOW),
    )

for sid, course, dow, ps, pe, mask, raw in [
    ("s-1", "c-1", 1, 1, 2, mask_of(range(1, 17)), "1-16周"),
    ("s-2", "c-2", 3, 3, 4, mask_of(range(2, 17, 2)), "2-16周(双)"),
    ("s-3", "c-3", 5, 5, 6, mask_of([1, 3, 5, 7]), "1,3,5,7周"),
]:
    con.execute(
        "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,weeks_raw,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (sid, course, dow, ps, pe, mask, raw, NOW, NOW),
    )
ok("基础数据写入", "1 用户 / 1 学期 / 6 节次 / 3 课程 / 3 排课")


def event(event_id, **fields):
    """插入一条 events，未给出的字段用默认值。"""
    row = {
        "id": event_id, "user_id": U, "semester_id": S1, "type": "temp", "title": "t",
        "on_date": None, "start_at": None, "end_at": None, "all_day": 0, "location": None,
        "note": None, "done": 0, "priority": None, "due_at": None, "subject": None,
        "seat_no": None, "parent_id": None, "ref_schedule_id": None, "action": None,
        "new_date": None, "new_period_start": None, "new_period_end": None, "new_room": None,
        "as_day_of_week": None, "source": None, "created_at": NOW, "updated_at": NOW,
    }
    row.update(fields)
    columns = list(row.keys())
    con.execute(
        f"INSERT INTO events ({','.join(columns)}) VALUES ({','.join(['?'] * len(columns))})",
        [row[c] for c in columns],
    )


for label, weeks, want in [
    ("第1-16周 = 65535", range(1, 17), 65535),
    ("第1/3/5/7周 = 85", [1, 3, 5, 7], 85),
    ("双周2-16 = 43690", range(2, 17, 2), 43690),
]:
    got = mask_of(weeks)
    if got == want:
        ok(f"位图：{label}", "与手算一致")
    else:
        fail(f"位图：{label}", f"得到 {got}")

WEEK_VIEW = """
SELECT c.name, cs.period_start FROM course_schedules cs
JOIN courses c ON c.id = cs.course_id
WHERE c.semester_id = ? AND cs.day_of_week = ?
  AND (cs.weeks_mask >> (? - 1)) & 1 = 1
  AND cs.deleted_at IS NULL AND c.deleted_at IS NULL
ORDER BY cs.period_start"""

for week, dow, want, label in [
    (3, 1, [("高等数学", 1)], "第3周周一命中高数"),
    (3, 3, [], "第3周(单周)周三无双周大物"),
    (4, 3, [("大学物理", 3)], "第4周(双周)周三命中大物"),
    (17, 1, [], "第17周无课"),
    (5, 5, [("大学英语", 5)], "第5周周五命中碎片周次"),
    (6, 5, [], "第6周周五不在周次集合内"),
]:
    rows = con.execute(WEEK_VIEW, (S1, dow, week)).fetchall()
    if rows == want:
        ok(f"周视图：{label}", str(rows))
    else:
        fail(f"周视图：{label}", f"得到 {rows}，期望 {want}")

expect_reject(
    "每用户仅一个当前学期",
    lambda: con.execute(
        "INSERT INTO semesters (id,user_id,name,start_date,total_weeks,is_active,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (S2, U, "第二学期", "2027-02-22", 20, 1, NOW, NOW),
    ),
)
expect_reject(
    "节次区间倒置",
    lambda: con.execute(
        "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        ("x1", "c-1", 1, 5, 3, 1, NOW, NOW),
    ),
)
expect_reject(
    "星期越界",
    lambda: con.execute(
        "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        ("x2", "c-1", 8, 1, 2, 1, NOW, NOW),
    ),
)
expect_reject(
    "空周次位图",
    lambda: con.execute(
        "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        ("x3", "c-1", 1, 1, 2, 0, NOW, NOW),
    ),
)
expect_reject("非待办带 priority", lambda: event("b1", type="temp", priority=1))
expect_reject("非考试带 subject", lambda: event("b2", type="temp", subject="数学"))
expect_reject("放假缺 on_date", lambda: event("b3", type="holiday"))
expect_reject("调休缺 as_day_of_week", lambda: event("b4", type="makeup", on_date="2026-10-11"))
expect_reject("调课缺 ref_schedule_id", lambda: event("b5", type="reschedule", action="cancel"))
expect_reject("parent_id 指向自己", lambda: event("b6", type="todo", parent_id="b6"))
expect_reject(
    "提前分钟越界",
    lambda: con.execute(
        "INSERT INTO reminders (id,user_id,target_type,target_id,advance_minutes,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?)",
        ("r-x", U, "course", "c-1", 1441, NOW, NOW),
    ),
)

STAMP = 1793000000000
event("e-exam", type="exam", title="高数期末", subject="高等数学", seat_no="A-12", start_at=STAMP)
event("e-todo", type="todo", title="交实验报告", priority=3, due_at=STAMP)
event("e-sub", type="todo", title="写实验一", parent_id="e-todo")
children = con.execute("SELECT COUNT(*) FROM events WHERE parent_id='e-todo'").fetchone()[0]
if children == 1:
    ok("待办子任务写入", f"子任务 {children} 条")
else:
    fail("待办子任务写入", str(children))
con.execute("DELETE FROM events WHERE id='e-todo'")
left = con.execute("SELECT COUNT(*) FROM events WHERE parent_id='e-todo'").fetchone()[0]
if left == 0:
    ok("删除父任务级联删除子任务", "ON DELETE CASCADE 生效")
else:
    fail("删除父任务未级联子任务", str(left))

event("e-holiday", type="holiday", title="国庆节", on_date="2026-10-01", source="builtin")
policy = {"manual": 1, "from_school": 2, "builtin": 3}


def apply_day_kind(on_date, source, title):
    """按来源优先级写入某天的假期/调休判定。"""
    current = con.execute(
        "SELECT id, source FROM events WHERE semester_id=? AND on_date=?"
        " AND type IN ('holiday','makeup','workday') AND deleted_at IS NULL",
        (S1, on_date),
    ).fetchone()
    if current is None:
        event(f"e-{on_date}", type="holiday", title=title, on_date=on_date, source=source)
        return "insert"
    if policy[source] < policy[current[1]]:
        con.execute("UPDATE events SET source=?, title=? WHERE id=?", (source, title, current[0]))
        return "overwrite"
    return "skip"


action = apply_day_kind("2026-10-01", "from_school", "教务校历")
source = con.execute(
    "SELECT source FROM events WHERE semester_id=? AND on_date=?", (S1, "2026-10-01")
).fetchone()[0]
if action == "overwrite" and source == "from_school":
    ok("来源优先级：教务覆盖内置", f"action={action}, source={source}")
else:
    fail("来源优先级覆盖失败", f"action={action}, source={source}")

event("e-manual", type="holiday", title="手动改判", on_date="2026-10-02", source="manual")
action = apply_day_kind("2026-10-02", "builtin", "内置放假")
source = con.execute(
    "SELECT source FROM events WHERE semester_id=? AND on_date=?", (S1, "2026-10-02")
).fetchone()[0]
if action == "skip" and source == "manual":
    ok("来源优先级：内置不覆盖手动", f"action={action}, source={source}")
else:
    fail("内置错误覆盖手动", f"action={action}, source={source}")

con.execute(
    "INSERT INTO reminders (id,user_id,target_type,target_id,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    ("r-1", U, "course", "c-1", NOW, NOW),
)
row = con.execute(
    "SELECT advance_minutes, enabled, skip_holidays, sound, vibrate, dnd, snooze_minutes"
    " FROM reminders WHERE id='r-1'"
).fetchone()
if row == (10, 1, 1, 1, 1, 0, None):
    ok("提醒默认值", "advance=10, enabled=1, skip_holidays=1, sound=1, vibrate=1, dnd=0, snooze=NULL")
else:
    fail("提醒默认值", str(row))

con.execute("DELETE FROM courses WHERE id='c-2'")
left = con.execute("SELECT COUNT(*) FROM course_schedules WHERE course_id='c-2'").fetchone()[0]
if left == 0:
    ok("删除课程级联删除排课", "ON DELETE CASCADE 生效")
else:
    fail("删除课程未级联排课", str(left))

for status, name, detail in results:
    print(f"[{status}] {name}" + (f"  — {detail}" if detail else ""))
failed = [row for row in results if row[0] == "FAIL"]
print(f"\n合计 {len(results)} 项，通过 {len(results) - len(failed)} 项，失败 {len(failed)} 项")
sys.exit(1 if failed else 0)
