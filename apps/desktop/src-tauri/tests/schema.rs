use dawn_tick_desktop::SCHEMA_SQL;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Row, SqlitePool};

async fn open() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("连接内存库");
    sqlx::raw_sql(SCHEMA_SQL)
        .execute(&pool)
        .await
        .expect("执行建表 SQL");
    pool
}

async fn insert(pool: &SqlitePool, sql: &str) {
    sqlx::raw_sql(sql).execute(pool).await.expect("写入失败");
}

const NOW: i64 = 1759900000000;
const SEMESTER: &str = "sem-1";
const USER: &str = "u1";

async fn seed(pool: &SqlitePool) {
    insert(
        pool,
        &format!("INSERT INTO users (id,nickname,created_at,updated_at) VALUES ('{USER}','我',{NOW},{NOW})"),
    )
    .await;
    insert(
        pool,
        &format!(
            "INSERT INTO semesters (id,user_id,name,start_date,total_weeks,time_zone,is_active,created_at,updated_at)
             VALUES ('{SEMESTER}','{USER}','2026-2027 第一学期','2026-09-07',20,'Asia/Shanghai',1,{NOW},{NOW})"
        ),
    )
    .await;
    for (no, start, end) in [
        (1, "08:00", "08:45"),
        (2, "08:55", "09:40"),
        (3, "10:00", "10:45"),
        (4, "10:55", "11:40"),
        (5, "14:00", "14:45"),
        (6, "14:55", "15:40"),
    ] {
        insert(
            pool,
            &format!(
                "INSERT INTO time_slots (id,semester_id,period_no,start_time,end_time,created_at,updated_at)
                 VALUES ('ts-{no}','{SEMESTER}',{no},'{start}','{end}',{NOW},{NOW})"
            ),
        )
        .await;
    }
    insert(
        pool,
        &format!(
            "INSERT INTO courses (id,semester_id,name,short_name,teacher,location,color,credits,created_at,updated_at)
             VALUES ('c-1','{SEMESTER}','高等数学','高数','张老师','教三-201','#4F8DFD',5.0,{NOW},{NOW})"
        ),
    )
    .await;
    // 第 1-16 周：位图 65535
    insert(
        pool,
        &format!(
            "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,weeks_raw,created_at,updated_at)
             VALUES ('s-1','c-1',1,1,2,65535,'1-16周',{NOW},{NOW})"
        ),
    )
    .await;
}

const WEEK_VIEW: &str = "SELECT c.name AS name, cs.period_start AS period_start
FROM course_schedules cs
JOIN courses c ON c.id = cs.course_id
WHERE c.semester_id = ?1 AND cs.day_of_week = ?2
  AND (cs.weeks_mask >> (?3 - 1)) & 1 = 1
  AND cs.deleted_at IS NULL AND c.deleted_at IS NULL
ORDER BY cs.period_start";

#[tokio::test]
async fn schema_creates_all_tables() {
    let pool = open().await;
    let rows = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(&pool)
    .await
    .expect("查询表名");
    let names: Vec<String> = rows.iter().map(|row| row.get::<String, _>("name")).collect();
    assert_eq!(
        names,
        vec![
            "app_meta",
            "course_schedules",
            "courses",
            "events",
            "reminders",
            "semesters",
            "time_slots",
            "users",
        ]
    );
}

#[tokio::test]
async fn foreign_keys_pragma_is_accepted() {
    let pool = open().await;
    let row = sqlx::query("PRAGMA foreign_keys").fetch_one(&pool).await.expect("查询 PRAGMA");
    let value: i64 = row.get(0);
    assert_eq!(value, 1);
}

#[tokio::test]
async fn bitmap_week_view_matches() {
    let pool = open().await;
    seed(&pool).await;

    let rows = sqlx::query(WEEK_VIEW)
        .bind(SEMESTER)
        .bind(1_i64)
        .bind(3_i64)
        .fetch_all(&pool)
        .await
        .expect("周视图查询");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get::<String, _>("name"), "高等数学");
    assert_eq!(rows[0].get::<i64, _>("period_start"), 1);

    let empty = sqlx::query(WEEK_VIEW)
        .bind(SEMESTER)
        .bind(1_i64)
        .bind(17_i64)
        .fetch_all(&pool)
        .await
        .expect("周视图查询");
    assert!(empty.is_empty());
}

#[tokio::test]
async fn constraints_reject_bad_rows() {
    let pool = open().await;
    seed(&pool).await;

    let inverted = sqlx::raw_sql(
        "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,created_at,updated_at)
         VALUES ('x1','c-1',1,5,3,1,0,0)",
    )
    .execute(&pool)
    .await;
    assert!(inverted.is_err());

    let bad_dow = sqlx::raw_sql(
        "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,created_at,updated_at)
         VALUES ('x2','c-1',8,1,2,1,0,0)",
    )
    .execute(&pool)
    .await;
    assert!(bad_dow.is_err());

    let zero_mask = sqlx::raw_sql(
        "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,created_at,updated_at)
         VALUES ('x3','c-1',1,1,2,0,0,0)",
    )
    .execute(&pool)
    .await;
    assert!(zero_mask.is_err());
}

#[tokio::test]
async fn events_carry_type_specific_columns() {
    let pool = open().await;
    seed(&pool).await;

    insert(
        &pool,
        &format!(
            "INSERT INTO events (id,user_id,semester_id,type,title,on_date,source,created_at,updated_at)
             VALUES ('e-h','{USER}','{SEMESTER}','holiday','国庆节','2026-10-01','builtin',{NOW},{NOW})"
        ),
    )
    .await;
    insert(
        &pool,
        &format!(
            "INSERT INTO events (id,user_id,semester_id,type,title,on_date,ref_schedule_id,action,new_date,created_at,updated_at)
             VALUES ('e-mv','{USER}','{SEMESTER}','reschedule','改期','2026-09-21','s-1','move','2026-09-22',{NOW},{NOW})"
        ),
    )
    .await;

    let stored: i64 = sqlx::query("SELECT COUNT(*) AS n FROM events WHERE deleted_at IS NULL")
        .fetch_one(&pool)
        .await
        .expect("计数")
        .get(0);
    assert_eq!(stored, 2);

    let duplicate = sqlx::raw_sql(&format!(
        "INSERT INTO events (id,user_id,semester_id,type,title,on_date,created_at,updated_at)
         VALUES ('e-h2','{USER}','{SEMESTER}','holiday','重复','2026-10-01',{NOW},{NOW})"
    ))
    .execute(&pool)
    .await;
    assert!(duplicate.is_err());
}

#[tokio::test]
async fn instant_columns_are_integers() {
    let pool = open().await;
    for column in ["start_at", "end_at", "due_at"] {
        let rows = sqlx::query("SELECT type FROM pragma_table_info('events') WHERE name = ?1")
            .bind(column)
            .fetch_all(&pool)
            .await
            .expect("读取列类型");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get::<String, _>("type"), "INTEGER");
    }
    for column in ["on_date", "new_date"] {
        let rows = sqlx::query("SELECT type FROM pragma_table_info('events') WHERE name = ?1")
            .bind(column)
            .fetch_all(&pool)
            .await
            .expect("读取列类型");
        assert_eq!(rows[0].get::<String, _>("type"), "TEXT");
    }
}
