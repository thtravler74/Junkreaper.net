/** Messages between the framed widget and public/widget.js on the host page. */
export const MSG = {
  resize: "clutterquote:resize",
  redirect: "clutterquote:redirect",
  redirectAck: "clutterquote:redirect-ack",
  event: "clutterquote:event",
} as const;

export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function postToHost(message: Record<string, unknown>): void {
  if (isFramed()) window.parent.postMessage(message, "*");
}

/**
 * Stripe Checkout refuses to render in an iframe, so payment must happen in the
 * top window. The host script performs the navigation on request. If no host
 * script answers (a bare <iframe> embed), resolves false and the caller shows a
 * link the customer taps instead.
 */
export function redirectTop(url: string, timeoutMs = 1200): Promise<boolean> {
  if (!isFramed()) {
    window.location.assign(url);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(false);
    }, timeoutMs);
    function onMessage(e: MessageEvent) {
      if (e.source === window.parent && e.data?.type === MSG.redirectAck) {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(true);
      }
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: MSG.redirect, url }, "*");
  });
}
