import { createClient } from '@supabase/supabase-js';

const oldSupabaseUrl = process.env.OLD_SUPABASE_URL || '';
const oldSupabaseServiceKey = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY || '';

export const oldSupabase = createClient(oldSupabaseUrl, oldSupabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
