/**
 * Offer `text` to the user as a downloaded file. Throws if the browser refuses
 * (the caller reports it); the anchor and object URL are always cleaned up.
 */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  let a: HTMLAnchorElement | null = null;
  let ok = false;
  try {
    a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    ok = true;
  } finally {
    a?.remove();
    if (ok) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    else URL.revokeObjectURL(url);
  }
}
