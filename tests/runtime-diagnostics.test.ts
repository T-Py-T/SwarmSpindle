import { expect, test } from 'bun:test';
import { safeFailureFields } from '../modules/runtime/diagnostics.ts';

test('diagnostics copy only finite known categories, never provider messages or arbitrary field values', () => {
  const secret = 'PRIVATE-DIAGNOSTIC-FIXTURE-MARKER';
  expect(safeFailureFields({ code: 'provider_http_error', httpStatus: 429, providerErrorType: 'rate_limit_error',
    transportCode: 'ECONNRESET', phase: 'fetch_before_response', message: secret, headers: { authorization: secret }, body: secret, url: secret }))
    .toEqual({ code: 'provider_http_error', httpStatus: 429, providerErrorType: 'rate_limit_error', transportCode: 'ECONNRESET', phase: 'fetch_before_response' });
  const unknown = safeFailureFields({ code: secret, httpStatus: 700, providerErrorType: secret, transportCode: secret, phase: secret, message: secret });
  expect(unknown).toEqual({ code: 'unknown' });
  expect(JSON.stringify(unknown)).not.toContain(secret);
  expect(safeFailureFields(null)).toEqual({ code: 'unknown' });
  expect(safeFailureFields({ get code() { throw new Error(secret); }, get httpStatus() { throw new Error(secret); } })).toEqual({ code: 'unknown' });
});
