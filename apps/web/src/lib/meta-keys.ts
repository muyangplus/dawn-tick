import {
  LEGACY_SQLX_BASELINE_KEY,
  SCHEMA_VERSION_KEY,
  SETTING_META_KEYS,
  SYNC_CURSOR_KEY,
  WAL_META_KEY,
  WEEKS_RAW_BACKFILL_KEY,
} from '@dawn-tick/core';

/**
 * `app_meta` 键清单：一个键只属于一个模块，存量键名一律不改（改名等于丢数据）。
 * 这里只做归属登记，不承载读写；序列化与容错见 `lib/meta.ts`。
 *
 * 命名约定（历史遗留，保持原样）：
 * - 老的通用键用 snake_case（`app_log`、`seen_notices`）；
 * - 结构会随版本升级的缓存带 `_v1` 后缀（`ui_layout_v1`、`presets_snapshot_v1`）；
 * - `backup:` 前缀下是快照正文，键随时间增长，只有前缀登记在这里。
 * - 设置项（`time_zone`…`webdav_history`）由 core 的 `settings.ts` 集中声明，本文件只引用不重写。
 */

/** 外壳：渠道提示已读（id 数组）与首次启动时区对齐标记。 */
export const SEEN_NOTICES_META_KEY = 'seen_notices';
export const TIME_ZONE_ALIGNED_META_KEY = 'time_zone_aligned';

/** 应用日志：最近 300 条日志的 JSON 数组。 */
export const LOG_META_KEY = 'app_log';

/** 通知：是否申请过系统通知权限（`'1'` 表示问过）。 */
export const NOTIFY_ASKED_META_KEY = 'notify_permission_asked';

/** 学校：上次选择的学校 `{ id, name }`。 */
export const RECENT_SCHOOL_META_KEY = 'recent_school';

/** 卡片布局：`{ [cardId]: { visible?, order?, zone? } }`。 */
export const LAYOUT_META_KEY = 'ui_layout_v1';

/** 预设缓存：下载得到的快照与正文；schemaVersion 语义见 `preset-update.ts`。 */
export const PRESET_SNAPSHOT_META_KEY = 'presets_snapshot_v1';
export const PRESET_CONTENT_META_KEY = 'presets_content_v1';

/** 更新运营：用户点了「忽略此版本」后记住的版本号（只忽略这一个版本）。 */
export const IGNORED_UPDATE_VERSION_META_KEY = 'ignored_update_version';

/** Android 主屏小组件读取的课表快照。 */
export const WIDGET_SNAPSHOT_META_KEY = 'widget_snapshot';

/** WebDAV 同步：上次上传时间（毫秒）与上次自动同步日期。 */
export const WEBDAV_LAST_UPLOAD_META_KEY = 'webdav_last_upload';
export const WEBDAV_LAST_SYNC_META_KEY = 'webdav_last_sync';

/** 局域网同步：客户端已配对设备（含长期令牌）与服务端可信令牌（只含哈希）。 */
export const LAN_PAIRINGS_META_KEY = 'lan_pairings_v1';
export const LAN_TRUSTED_TOKENS_META_KEY = 'lan_trusted_tokens_v1';

/** 库内 JSON 快照：正文键为 `backup:<createdAt>`，列表索引见下。 */
export const SNAPSHOT_META_PREFIX = 'backup:';
/** 快照列表的轻量索引 `{ id, createdAt, bytes }[]`：列表只读它，不再读快照正文。 */
export const SNAPSHOT_INDEX_META_KEY = 'backup_index';

/** core 侧键：迁移与同步游标等，统一登记后备份/清理可以按清单核对。 */
export const CORE_META_KEYS = {
  schemaVersion: SCHEMA_VERSION_KEY,
  legacySqlxBaseline: LEGACY_SQLX_BASELINE_KEY,
  syncCursor: SYNC_CURSOR_KEY,
  weeksRawBackfill: WEEKS_RAW_BACKFILL_KEY,
  walMode: WAL_META_KEY,
} as const;

/** 全部固定键（不含 `backup:` 前缀下的正文键），用于文档与一致性测试。 */
export const APP_META_KEYS: readonly string[] = [
  ...new Set([
    ...SETTING_META_KEYS,
    ...Object.values(CORE_META_KEYS),
    SEEN_NOTICES_META_KEY,
    TIME_ZONE_ALIGNED_META_KEY,
    LOG_META_KEY,
    NOTIFY_ASKED_META_KEY,
    RECENT_SCHOOL_META_KEY,
    LAYOUT_META_KEY,
    PRESET_SNAPSHOT_META_KEY,
    PRESET_CONTENT_META_KEY,
    IGNORED_UPDATE_VERSION_META_KEY,
    WIDGET_SNAPSHOT_META_KEY,
    WEBDAV_LAST_UPLOAD_META_KEY,
    WEBDAV_LAST_SYNC_META_KEY,
    LAN_PAIRINGS_META_KEY,
    LAN_TRUSTED_TOKENS_META_KEY,
    SNAPSHOT_INDEX_META_KEY,
  ]),
];

/** 动态键前缀：键名由运行时生成，逐个登记没有意义。 */
export const APP_META_KEY_PREFIXES: readonly string[] = [SNAPSHOT_META_PREFIX];

/** 判断一个键是否已被清单登记（固定键或登记过的前缀）。 */
export function isKnownMetaKey(key: string): boolean {
  return APP_META_KEYS.includes(key) || APP_META_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}
