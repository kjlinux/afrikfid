'use strict';

/**
 * Jest setupFilesAfterFramework — définit DATABASE_URL pour chaque worker.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'afrikfid_test';
const base = process.env.DATABASE_URL || 'postgresql://postgres:@localhost:5432/postgres';
process.env.DATABASE_URL = base.replace(/\/[^/]+$/, `/${TEST_DB}`);
process.env.NODE_ENV = 'test';
