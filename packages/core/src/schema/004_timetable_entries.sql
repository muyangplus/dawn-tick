-- 004：条目是否显示在课表上。
-- 日程/作业/考试默认不占课表格子；实验沿用既有行为，回填为显示。

ALTER TABLE events ADD COLUMN show_in_timetable INTEGER NOT NULL DEFAULT 0;
UPDATE events SET show_in_timetable = 1 WHERE type = 'lab';
