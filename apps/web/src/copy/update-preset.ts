/** 预设更新：快照与索引的校验原因、预设源的网络错误、缓存回退原因。 */
export const presetUpdateCopy = {
  // 缓存（preset-cache.ts）
  cacheMissingContent: (version: string) => `缓存 ${version} 缺少可用正文，改用内置预设`,
  cacheInvalidContent: (version: string, reason: string | null) =>
    `缓存 ${version} 的正文未通过校验（${reason ?? '未知原因'}），继续使用内置预设`,

  // 快照结构（preset-update.ts）
  snapshotNotObject: '预设快照应为对象',
  snapshotMissingVersion: '预设快照缺少 version',
  snapshotSchemaNotInteger: '预设快照的 schemaVersion 应为整数',
  snapshotSchemaTooNew: (schemaVersion: number) =>
    `预设快照使用了更新的格式（schemaVersion ${schemaVersion}），请升级应用`,
  snapshotGeneratedAtNotString: '预设快照的 generatedAt 应为字符串',
  snapshotMissingSources: '预设快照缺少 sources',
  snapshotTimetablesNotArray: '预设快照的 sources.timetables 应为数组',
  snapshotSystemsNotArray: '预设快照的 sources.systems 应为数组',
  snapshotMissingHash: '预设快照缺少 hash',
  snapshotMissingIndex: '预设快照不可用：缺少内嵌索引 index',
  snapshotUnusable: (problem: string) => `预设快照不可用：${problem}`,
  snapshotHashMismatch: '预设快照哈希校验未通过',
  snapshotDownloadFailed: (reason: string) => `预设快照下载失败：${reason}`,
  snapshotOffline: '当前环境无法联网下载预设快照',
  invalidVersion: (version: string) => `预设版本号不合法：${version}`,

  // 预设源（preset-update.ts）
  sourceUnreachable: (message: string) => `无法连接预设源（${message}）`,
  sourceUnreachableBare: '无法连接预设源',
  base64Unsupported: '当前环境不支持 base64 解码',
  base64Invalid: (reason: string) => `预设源返回的 base64 内容无法解码：${reason}`,
  contentsNotObject: '预设源返回的 contents 响应不是对象',
  contentsEncoding: (encoding: string) => `预设源返回的 contents 编码不受支持：${encoding}`,
  contentsMissing: '预设源返回的 contents 缺少 content',
  manifestTimeout: '读取预设清单超时',
  httpStatus: (status: number) => `预设源返回 ${status}`,
  checkOffline: '当前环境无法联网检查预设更新',
  versionManifestInvalid: '预设版本清单格式不正确',
  sourceSchemaTooNew: (schemaVersion: number) =>
    `预设源使用了更新的格式（schemaVersion ${schemaVersion}），请升级应用`,

  // 索引结构（preset-index.ts）
  indexUnusable: (problem: string) => `预设索引不可用：${problem}`,
  indexNotObject: '预设索引应为对象',
  indexNotGenerated: '预设索引缺少 _generated: true（它不是生成物，已拒绝）',
  indexMissingVersion: '预设索引缺少 version',
  indexSchemaNotInteger: '预设索引的 schemaVersion 应为整数',
  indexSchemaTooNew: (schemaVersion: number) =>
    `预设索引使用了更新的格式（schemaVersion ${schemaVersion}），请升级应用`,
  indexSchoolsNotArray: '预设索引的 schools 应为数组',
  indexSystemsNotArray: '预设索引的 systems 应为数组',
  schoolAt: (position: number) => `预设索引的学校 #${position}`,
  school: (id: string) => `预设索引的学校「${id}」`,
  systemAt: (position: number) => `预设索引的系统 #${position}`,
  system: (id: string) => `预设索引的系统「${id}」`,
  field: (where: string, key: string) => `${where} 的 ${key}`,
  item: (where: string, index: number) => `${where}[${index}]`,
  notObject: (where: string) => `${where} 应为对象`,
  missing: (where: string, key: string) => `${where} 缺少 ${key}`,
  duplicateId: (where: string, id: string) => `${where} 的 id 重复：${id}`,
  notNonEmptyText: (where: string) => `${where} 应为非空字符串`,
  notNonEmptyTextOrNull: (where: string) => `${where} 应为非空字符串或 null`,
  notBoolean: (where: string) => `${where} 应为布尔值`,
  notTextArray: (where: string) => `${where} 应为字符串数组`,
  pathNotRelative: (where: string, path: string) => `${where} 应为 POSIX 风格的相对路径：${path}`,
  pathHasDrive: (where: string, path: string) => `${where} 不应带盘符：${path}`,
  pathHasDotDot: (where: string, path: string) => `${where} 不应包含 .. 段：${path}`,
  entryPathNotAbsolute: (where: string, path: string) => `${where} 应以 / 开头：${path}`,
} as const;
