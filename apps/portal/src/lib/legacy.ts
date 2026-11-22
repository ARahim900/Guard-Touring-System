// Small gap-fillers for older iPhones (Safari before 15.4), loaded before the app.
// Newer browsers already have these and skip them.
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    writable: true,
    value: function at<T>(this: T[], index: number): T | undefined {
      const i = Math.trunc(index) || 0;
      return this[i < 0 ? this.length + i : i];
    },
  });
}

if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function' && typeof crypto.getRandomValues === 'function') {
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    writable: true,
    value: () => {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  });
}

export {};
