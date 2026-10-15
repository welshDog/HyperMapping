/** What happened to a message sent to the other device through the relay. */
export type SendResult =
  | { kind: 'ok' }
  | { kind: 'busy' } // 429: the relay already has its maximum number of calibrations open
  | { kind: 'too-big' } // 413
  | { kind: 'refused'; status: number } // any other error answer from the server
  | { kind: 'unreachable' }; // no answer at all (network down, server closed)

/** Turn an HTTP status (or null when there was no response) into a SendResult. */
export function sendResultFor(status: number | null): SendResult {
  if (status === null) return { kind: 'unreachable' };
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 429) return { kind: 'busy' };
  if (status === 413) return { kind: 'too-big' };
  return { kind: 'refused', status };
}

/** What the phone says when its first message to the laptop did not get through. */
export function helloFailureText(result: SendResult): string {
  switch (result.kind) {
    case 'busy':
      return 'The laptop server is busy. Close old calibration tabs or wait a few minutes, then tap Start again.';
    case 'unreachable':
      return 'Could not reach the laptop. Check the phone is on the same Wi-Fi and the app is still running, then tap Start again.';
    case 'refused':
      return `The laptop answered with an error (code ${result.status}). Reload this page and tap Start again.`;
    case 'too-big':
      return 'The laptop refused the message as too big. Reload this page and tap Start again.';
    case 'ok':
      return 'Connected.';
  }
}
