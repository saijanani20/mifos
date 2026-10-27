import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local' });
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

// Next.js hot-reload singleton cache for Prisma connection
const globalForPrisma = globalThis as unknown as {
  prismaDb?: ReturnType<typeof postgres<Contract>>;
};

export const db =
  globalForPrisma.prismaDb ??
  postgres({
    contract,
    url:
      process.env['DATABASE_URL'] ||
      process.env['POSTGRES_URL'] ||
      'postgresql://postgres:postgres@localhost:5432/postgres',
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaDb = db;
}

// Convenience export for public schema ORM operations
export const orm = db.orm.public;
export const sql = db.sql.public;

export default db;
