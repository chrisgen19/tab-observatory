export type HostStatus = { kind: 'none' | 'waiting' | 'missing' | 'dropped'; message: string };

const MISSING = /not found|forbidden|not connected|cannot identify the launching/i;
const WAITING = 'Waiting for a fresh companion sample';
const SETUP_HINT = 'Check the companion installation in the setup panel and retry monitoring.';

/** Classifies the background's host error: setup is only suggested when the companion is missing. */
export function describeHostError(hostError: string): HostStatus {
  if (!hostError) return { kind: 'none', message: '' };
  if (hostError === WAITING) return { kind: 'waiting', message: hostError };
  if (MISSING.test(hostError)) return { kind: 'missing', message: `${hostError.replace(/\.$/, '')}. ${SETUP_HINT}` };
  return { kind: 'dropped', message: hostError };
}
