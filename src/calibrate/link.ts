/** A random 128-bit session token as 32 lowercase hex characters. */
export function newSessionId(fill: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = fill(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The address the phone opens (the QR code holds this). */
export function buildCameraLink(host: string, port: string, protocol: string, session: string): string {
  const scheme = protocol.replace(/:$/, '');
  return `${scheme}://${host}${port ? `:${port}` : ''}/camera.html?s=${session}`;
}
