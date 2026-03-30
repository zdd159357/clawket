export function shouldShowConnectionRecoveryMessage(code?: string, message?: string): boolean {
  const normalizedCode = (code ?? '').toLowerCase();
  const normalizedMessage = (message ?? '').toLowerCase();
  if (
    normalizedCode === 'ws_error'
    || normalizedCode === 'auth_failed'
    || normalizedCode === 'challenge_timeout'
    || normalizedCode === 'ws_connect_timeout'
    || normalizedCode === 'relay_bootstrap_timeout'
    || normalizedCode === 'device_nonce_mismatch'
    || normalizedCode === 'device_signature_invalid'
    || normalizedCode === 'pairing_required'
    || normalizedCode === 'auth_rejected'
  ) {
    return true;
  }
  return normalizedMessage.includes('challenge timed out')
    || normalizedMessage.includes('websocket error')
    || normalizedMessage.includes('websocket open timed out')
    || normalizedMessage.includes('relay bootstrap timed out')
    || normalizedMessage.includes('pairing required')
    || normalizedMessage.includes('device authentication')
    || normalizedMessage.includes('nonce mismatch');
}

export function shouldDelayConnectionRecoveryMessage(code?: string, message?: string): boolean {
  const normalizedCode = (code ?? '').toLowerCase();
  const normalizedMessage = (message ?? '').toLowerCase();
  if (
    normalizedCode === 'ws_error'
    || normalizedCode === 'auth_failed'
    || normalizedCode === 'ws_connect_timeout'
    || normalizedCode === 'challenge_timeout'
    || normalizedCode === 'relay_bootstrap_timeout'
  ) {
    return true;
  }
  return normalizedMessage.includes('websocket error')
    || normalizedMessage.includes('websocket open timed out')
    || normalizedMessage.includes('challenge timed out')
    || normalizedMessage.includes('relay bootstrap timed out');
}
