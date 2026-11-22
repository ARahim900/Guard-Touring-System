// A new app version has taken over while a patrol screen was open. The patrol
// screens show an "Update now" banner instead of reloading under the guard.
const EVENT = 'mb:update-ready';
let ready = false;

export function announceUpdate(): void {
  ready = true;
  window.dispatchEvent(new Event(EVENT));
}

export function isUpdateReady(): boolean { return ready; }

export function onUpdateReady(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
