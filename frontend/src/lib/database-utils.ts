/**
 * database-utils.ts
 * 
 * Strict error handling wrapper for Supabase PostgREST operations.
 * Supabase-js returns { data, error } instead of throwing, which can cause
 * database writes to silently fail while reporting success.
 * 
 * Wrapping calls with must() guarantees that any database error throws an
 * explicit exception that stops execution and triggers rollback/HTTP 500.
 */

export async function must<T>(
  queryPromise: PromiseLike<{ data: T | null; error: { message: string; details?: string; hint?: string } | null }>,
  operationLabel: string
): Promise<T | null> {
  const { data, error } = await queryPromise;
  if (error) {
    const errorDetails = error.details ? ` (${error.details})` : '';
    throw new Error(`[Database Failure: ${operationLabel}] ${error.message}${errorDetails}`);
  }
  return data;
}
