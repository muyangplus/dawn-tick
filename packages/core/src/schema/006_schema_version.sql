-- 006 迁移版本落库：Windows 侧由原生插件执行迁移，需要把版本写进 app_meta，
-- 让三端的 schema_version 口径一致（其余端由 migrate() 写同一个键）。
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_meta (key, value) VALUES ('schema_version', '006_schema_version')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
