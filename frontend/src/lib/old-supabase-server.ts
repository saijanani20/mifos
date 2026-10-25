import { createClient } from '@supabase/supabase-js';

const oldSupabaseUrl = process.env.OLD_SUPABASE_URL || 'https://placeholder-old.supabase.co';
const oldSupabaseServiceKey = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

export const oldSupabase = createClient(oldSupabaseUrl, oldSupabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
