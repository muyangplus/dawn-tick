// 写入入口：按领域拆在 mutations/ 下，这里只做汇总，外部的按路径导入保持不变。
export { uuidv7, type WriteOptions } from './mutations/base.ts';
export * from './mutations/semesters.ts';
export * from './mutations/courses.ts';
export * from './mutations/events.ts';
