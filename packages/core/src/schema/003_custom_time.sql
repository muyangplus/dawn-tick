-- 003：条目自定义时间（不按节次）。
-- 只新增可空列，不重建表：自定义时间非空时按真实时间展示与定位，
-- 节次仍按重叠关系回填，保证提醒、重叠判定与既有逻辑不变。

ALTER TABLE events ADD COLUMN start_time TEXT;
ALTER TABLE events ADD COLUMN end_time TEXT;
ALTER TABLE course_schedules ADD COLUMN start_time TEXT;
ALTER TABLE course_schedules ADD COLUMN end_time TEXT;
