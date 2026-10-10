import initSql from '@dawn-tick/core/schema/001_init.sql?raw';
import type { Migration } from '@dawn-tick/core';

export const MIGRATIONS: Migration[] = [{ id: '001_init', sql: initSql }];
