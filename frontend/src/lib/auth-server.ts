import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeBranchId } from './branch-mapping';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export type UserRole = 'ADMIN' | 'TELLER' | 'AUDITOR' | 'MANAGER';

export interface AuthSession {
  user: any;
  profile: any;
  role: UserRole;
  branchId: string;
  trustedBranchId: string;
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

      // Check refresh token fallback if access token cookie is missing
      if (!token) {
        const refreshCookie = cookieHeader.split(';').find(c => c.trim().startsWith('sb-refresh-token=') || c.trim().startsWith('refresh_token='));
        const refreshToken = refreshCookie ? refreshCookie.split('=')[1]?.trim() : '';
        if (refreshToken) {
          try {
            const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
              auth: { autoRefreshToken: false, persistSession: false }
            });
            const { data: refreshedSession } = await authSupabase.auth.refreshSession({ refresh_token: refreshToken });
            if (refreshedSession?.session?.access_token) {
              token = refreshedSession.session.access_token;
            }
          } catch (rErr) {
            console.warn('[auth-server] Refresh token recovery failed:', rErr);
          }
        }
      }
    }

    if (!token) {
      return null;
    }

    // Verify token with Supabase Auth
    let user: any = null;
    const { data: authData, error: userError } = await adminSupabase.auth.getUser(token);
    if (!userError && authData?.user) {
      user = authData.user;
    } else {
      // Graceful recovery for tokens expired during active shifts (24-hour shift grace window)
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
          const payload = JSON.parse(payloadJson);
          const userId = payload.sub;
          const exp = payload.exp;

          const nowSec = Math.floor(Date.now() / 1000);
          // Allow 24 hours of shift window past token expiration
          const isWithinShiftGrace = exp && (nowSec - exp < 24 * 3600);

          if (userId && isWithinShiftGrace) {
            const { data: adminUser } = await adminSupabase.auth.admin.getUserById(userId);
            if (adminUser?.user) {
              user = adminUser.user;
            }
          }
        }
      } catch (recoveryErr) {
        console.warn('[auth-server] Expired JWT recovery attempt failed:', recoveryErr);
      }
    }

    if (!user) {
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
    const trustedBranchId = normalizeBranchId(profile?.branch_id || 'HQ');
    let branchId = trustedBranchId;
    const branchName = profile?.branch_name || '';

    // Branch identification: Only ADMIN or HQ users can switch target branch via header
    const selectedBranch =
      request.headers.get('x-branch-id') ||
      request.headers.get('X-Branch-Id') ||
      request.headers.get('X-BRANCH-ID');
    
    if (role === 'ADMIN' || (role === 'AUDITOR' && normalizeBranchId(profile?.branch_id || 'HQ') === 'HQ')) {
      if (selectedBranch && selectedBranch.trim() !== '') {
        branchId = normalizeBranchId(selectedBranch.trim());
      }
    } else {
      // Non-admin staff (TELLER, MANAGER) are strictly bound to their profile assigned branch
      branchId = normalizeBranchId(profile?.branch_id || 'HQ');
    }

    // Tellers are strictly prohibited from operating as Head Office (HQ)
    if (role === 'TELLER' && (branchId === 'HQ' || branchId === 'HEAD OFFICE')) {
      const assigned = normalizeBranchId(profile?.branch_id || '');
      branchId = (assigned !== 'HQ' && assigned !== 'HEAD OFFICE') ? assigned : '';
    }

    return {
      user,
      profile,
      role,
      branchId,
      trustedBranchId,
      branchName,
      isAuthorized: true
    };
  } catch (err) {
    console.error('getAuthenticatedUser error:', err);
    return null;
  }
}

/**
 * Validates financial mutation authorization strictly.
 * Unlike general read views, financial actions (cash dispatch, cash receipt, till count, approval)
 * strictly forbid branch spoofing via x-branch-id headers for non-admin accounts.
 */
export function validateFinancialActionAuth(
  session: AuthSession | null,
  requiredBranchId?: string | null,
  allowedRoles?: UserRole[]
): { authorized: boolean; error?: string } {
  if (!session || !session.user) {
    return { authorized: false, error: 'Unauthorized. Valid authentication session required.' };
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return { authorized: false, error: `Forbidden. Action requires role: ${allowedRoles.join(', ')}.` };
  }

  // ADMIN has full system access across all branches
  if (session.role === 'ADMIN') {
    return { authorized: true };
  }

  if (requiredBranchId) {
    const targetNorm = normalizeBranchId(requiredBranchId);
    const profileNorm = normalizeBranchId(session.trustedBranchId);

    if (profileNorm !== targetNorm) {
      return { 
        authorized: false, 
        error: `Forbidden. Your assigned branch (${profileNorm}) is not authorized to perform operations for branch (${targetNorm}).` 
      };
    }
  }

  return { authorized: true };
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
