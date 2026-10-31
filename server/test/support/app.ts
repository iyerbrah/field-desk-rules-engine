import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { CrmBootstrap } from '@crm/shared/crm';
import { HttpDesk } from './http-desk.js';

/**
 * Boots the app on a fresh temp database and logs in as an admin.
 * Same steps as the `before` hook in customer-workflows.test.ts, shared so
 * new scenario files don't change that file's pinned outcome count.
 */
export async function startDesk(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), `${prefix}-`));
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = join(directory, 'test.db');
  process.env.JWT_SECRET = 'scenario-test-secret-'.repeat(4);
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  const { AppModule } = await import('../../src/app.module.js');
  const { DatabaseService } =
    await import('../../src/database/database.service.js');
  const { UsersService } = await import('../../src/users/users.service.js');
  const { configureApp } = await import('../../src/configure-app.js');
  const { seedReferenceData } =
    await import('../../src/scripts/seed-reference-data.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken())
    .useValue([{ ttl: 60000, limit: 100000 }])
    .compile();
  const app: INestApplication = module.createNestApplication({
    logger: false,
  });
  configureApp(app);
  migrate(app.get(DatabaseService).db, {
    migrationsFolder: resolve('drizzle'),
  });
  const password = 'scenario-admin-password';
  const admin = await app.get(UsersService).create({
    name: 'Scenario operator',
    email: 'scenario@example.test',
    password,
    role: 'ADMIN',
  });
  seedReferenceData(app.get(DatabaseService), admin);
  await app.init();
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: admin.email, password })
    .expect(200);
  const headers = login.headers['set-cookie'] as unknown as string[];
  const desk = new HttpDesk(app, headers[0]!.split(';')[0]!);
  const catalog = await desk.read<CrmBootstrap>('bootstrap');
  assert.deepEqual(
    catalog.skus.map((sku) => [sku.id, sku.price_paise, sku.points_per_unit]),
    [
      ['sku-a', 10000, 1000],
      ['sku-b', 15000, 1200],
      ['sku-c', 25000, 2000],
    ],
  );
  return { app, desk };
}
