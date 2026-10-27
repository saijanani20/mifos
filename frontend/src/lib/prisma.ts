/**
 * Prisma ORM Client & Data Layer
 * 
 * Configured with Prisma 8 (@prisma/orm-postgres) and full schema mapping
 * for Mifos Pawning & Microfinance System.
 * 
 * Usage examples:
 * 
 * 1. Using the typed ORM client:
 *    import { orm } from '@/lib/prisma';
 *    const clients = await orm.Client.where({ branchId: 'PAN' }).all();
 *    const pawn = await orm.Pawn.where({ billNo: 'PAN-2026-001' }).first();
 * 
 * 2. Using the root db client:
 *    import { db } from '@/lib/prisma';
 *    const branches = await db.orm.public.Branch.all();
 * 
 * 3. Using typed SQL builder:
 *    import { sql } from '@/lib/prisma';
 *    const loans = await sql.pawns.where({ status: 'ACTIVE' }).execute();
 */

export { db, orm, sql, contract, default } from '../prisma/db';
export type { Contract } from '../prisma/contract.d';
