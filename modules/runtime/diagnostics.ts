import type { Actor, SwarmStore } from '@simpleswarm/swarm';

const failureCodes = new Set([
  'accounting_unavailable', 'admission_failed', 'agent_complete', 'agent_count', 'agent_inactive', 'agent_not_found',
  'auth_unavailable', 'budget_exhausted', 'cancelled', 'deadline', 'deferred_forbidden', 'duplicate_run',
  'endpoint_invalid', 'model_changed', 'model_unavailable', 'output_limit', 'payload_invalid', 'preflight_failed',
  'provider_error', 'provider_http_error', 'provider_sse_error', 'provider_transport_error', 'request_context_invalid',
  'request_timeout', 'request_uncertain', 'response_error', 'response_incomplete', 'response_invalid',
  'retry_forbidden', 'runtime_setup_failed', 'sandbox_unavailable', 'session_error', 'session_invalid', 'shutdown',
  'stream_incomplete', 'turn_limit', 'unsupported_model', 'usage_invalid', 'working_target_reached',
]);
const providerErrorTypes = new Set([
  'rate_limit_error', 'overloaded_error', 'authentication_error', 'invalid_request_error', 'api_error',
  'permission_error', 'not_found_error', 'request_too_large', 'server_error', 'rate_limit_exceeded',
  'insufficient_quota', 'context_length_exceeded', 'unknown',
]);
const transportCodes = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH',
  'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'unknown',
]);

function ownField(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}

/** Only known categories cross into diagnostics; messages, headers, URLs and bodies never do. */
export function safeFailureFields(error: unknown): Record<string, string | number> {
  const code = ownField(error, 'code');
  const result: Record<string, string | number> = { code: typeof code === 'string' && failureCodes.has(code) ? code : 'unknown' };
  const status = ownField(error, 'httpStatus');
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) result.httpStatus = status;
  const providerType = ownField(error, 'providerErrorType');
  if (typeof providerType === 'string' && providerErrorTypes.has(providerType)) result.providerErrorType = providerType;
  const transportCode = ownField(error, 'transportCode');
  if (typeof transportCode === 'string' && transportCodes.has(transportCode)) result.transportCode = transportCode;
  if (ownField(error, 'phase') === 'fetch_before_response') result.phase = 'fetch_before_response';
  return result;
}

/** Diagnostic persistence must not interrupt reconciliation or terminal stream delivery. */
export function emitDiagnostic(store: SwarmStore, actor: Actor, kind: string, payload: () => Parameters<SwarmStore['appendEvent']>[3]): void {
  try { store.appendEvent(actor.swarmId, actor.agentId, kind, payload()); }
  catch { /* Existing ledger and lifecycle operations remain authoritative if diagnostics cannot be persisted. */ }
}
