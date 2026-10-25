import { adminSupabase } from './auth-server';
import { normalizeBranchId, CANONICAL_BRANCHES } from './branch-mapping';

const isUUID = (str: any) => typeof str === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);
const VALID_BRANCH_IDS = new Set(CANONICAL_BRANCHES.map(b => b.id));

export interface AuditLogOptions {
  action: string;
  resource?: string;
  details?: Record<string, any>;
  userId?: string;
  userEmail?: string;
  role?: string;
  branchId?: string;
  status?: 'SUCCESS' | 'FAILED' | 'WARNING';
  request?: Request;
}

/**
 * Records an audit log entry in public.audit_logs
 * Guaranteed against UUID syntax errors and Branch FK constraint violations.
 */
export async function recordAuditLog(sessionOrUser: any, options: AuditLogOptions) {
  try {
    const rawUserId = options.userId || sessionOrUser?.user?.id || sessionOrUser?.id || null;
    const validUserId = isUUID(rawUserId) ? rawUserId : null;
    
    const userEmail = options.userEmail || sessionOrUser?.user?.email || sessionOrUser?.email || 'system';
    const role = options.role || sessionOrUser?.role || 'TELLER';
    
    const rawBranchId = options.branchId || sessionOrUser?.branchId || sessionOrUser?.branch_id || 'HQ';
    const canonicalBranch = normalizeBranchId(rawBranchId);
    const validBranchId = (canonicalBranch && VALID_BRANCH_IDS.has(canonicalBranch as any)) ? canonicalBranch : (canonicalBranch === 'ALL' ? null : 'HQ');

    let ipAddress = '127.0.0.1';
    let userAgent = 'Browser Client';

    if (options.request) {
      ipAddress = options.request.headers.get('x-forwarded-for')?.split(',')[0] || 
                  options.request.headers.get('x-real-ip') || 
                  '127.0.0.1';
      userAgent = options.request.headers.get('user-agent') || 'Browser Client';
    }

    const payloadDetails: Record<string, any> = {
      status: options.details?.status || options.status || 'SUCCESS',
      ...(options.details || {}),
      ip_address: ipAddress,
      user_agent: userAgent
    };

    if (rawUserId && !validUserId) {
      payloadDetails.raw_user_id = rawUserId;
    }

    const { error } = await adminSupabase.from('audit_logs').insert([{
      user_id: validUserId,
      user_email: userEmail,
      role,
      branch_id: validBranchId,
      action: options.action,
      resource: options.resource || '',
      details: payloadDetails,
      created_at: new Date().toISOString()
    }]);

    if (error) {
      console.warn('[AuditLog Notice]:', error.message);
    }
  } catch (err) {
    console.error('[AuditLog Error]:', err);
    // Non-blocking error to ensure primary user transaction completes
  }
}
