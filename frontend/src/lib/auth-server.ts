import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeBranchId } from './branch-mapping';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ielkaetihagxgnrrasch.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllbGthZXRpaGFneGducnJhc2NoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDEwMTU1OSwiZXhwIjoyMDk5Njc3NTU5fQ.F0KSjnVMl9Nz4fuXV3Z_fHBkQfCU8ieyPT0qJ2xLEMg';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export type UserRole = 'ADMIN' | 'TELLER' | 'AUDITOR' | 'MANAGER';

export interface AuthSession {
  user: any;
  profile: any;
  role: UserRole;
  branchId: string;
  branchName?: string;
  isAuthorized: boolean;
}

/**
 * Extracts and verifies the authenticated user session server-side from request headers or tokens.
 */
export async function getAuthenticatedUser(request: Request): Promise<AuthSession | null> {
  try {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    const xAuthToken = request.headers.get('x-auth-token');
    
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (xAuthToken) {
      token = xAuthToken.trim();
    }

    if (!token) {
      // Check cookies if header is absent
      const cookieHeader = request.headers.get('cookie') || '';
      const tokenCookie = cookieHeader.split(';').find(c => c.trim().startsWith('sb-access-token=') || c.trim().startsWith('auth_token='));
      if (tokenCookie) {
        token = tokenCookie.split('=')[1]?.trim() || '';
      }
    }

    if (!token) {
      return null;
    }

    // Verify token with Supabase Auth
    const { data: { user }, error: userError } = await adminSupabase.auth.getUser(token);
    if (userError || !user) {
      return null;
    }

    // Fetch user profile securely
    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    const role = (profile?.role || 'TELLER').toUpperCase() as UserRole;
    if (user.email && user.email.toLowerCase() === 'auditor@gmail.com') {
      // Legacy auditor account revoked
      return null;
    }
    let branchId = normalizeBranchId(profile?.branch_id || 'HQ');
    const branchName = profile?.branch_name || '';

    // Branch identification: check selected branch header x-branch-id
    const selectedBranch =
      request.headers.get('x-branch-id') ||
      request.headers.get('X-Branch-Id') ||
      request.headers.get('X-BRANCH-ID');
    
    if (selectedBranch && selectedBranch.trim() !== '') {
      branchId = normalizeBranchId(selectedBranch.trim());
    }

    // Tellers are strictly prohibited from operating as Head Office (HQ)
    if (role === 'TELLER' && (branchId === 'HQ' || branchId === 'HEAD OFFICE')) {
      branchId = '';
    }

    return {
      user,
      profile,
      role,
      branchId,
      branchName,
      isAuthorized: true
    };
  } catch (err) {
    console.error('getAuthenticatedUser error:', err);
    return null;
  }
}

/**
 * Validates whether the authenticated user is permitted to access/modify data for the target branch ID.
 * Returns true if permitted, false if forbidden.
 */
export function validateBranchAccess(session: AuthSession | null, targetBranchId?: string | null): boolean {
  if (!session) return false;
  // ADMIN has full system access
  if (session.role === 'ADMIN') return true;

  const isHead = !session.branchId || normalizeBranchId(session.branchId) === 'HQ' || session.branchId === 'HEAD OFFICE';
  // Users operating from Head Office (except TELLER) have cross-branch visibility
  if (isHead && session.role !== 'TELLER') return true;

  // Branch user is strictly bound to their assigned / selected branch
  if (!targetBranchId || targetBranchId === 'ALL' || targetBranchId === 'HQ') {
    return false;
  }

  return normalizeBranchId(session.branchId) === normalizeBranchId(targetBranchId);
}

/**
 * Enforces server-side authorization for API routes.
 * Returns null if authorized, or a NextResponse error if unauthorized.
 */
export async function enforceApiAuth(
  request: Request,
  allowedRoles?: UserRole | UserRole[],
  targetBranchId?: string | null
): Promise<{ session: AuthSession | null; errorResponse: NextResponse | null }> {
  const session = await getAuthenticatedUser(request);

  if (!session) {
    return {
      session: null,
      errorResponse: NextResponse.json(
        { error: 'Unauthorized. Authentication token is missing or invalid.' },
        { status: 401 }
      )
    };
  }

  if (allowedRoles) {
    const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (!rolesArray.includes(session.role)) {
      return {
        session,
        errorResponse: NextResponse.json(
          { error: `Forbidden. Requires one of the following roles: ${rolesArray.join(', ')}.` },
          { status: 403 }
        )
      };
    }
  }

  if (session.role !== 'ADMIN' && targetBranchId) {
    if (!validateBranchAccess(session, targetBranchId)) {
      return {
        session,
        errorResponse: NextResponse.json(
          { error: `Forbidden. You are not authorized to access or modify data for branch ${targetBranchId}.` },
          { status: 403 }
        )
      };
    }
  }

  return { session, errorResponse: null };
}
