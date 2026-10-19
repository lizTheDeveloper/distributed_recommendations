// packages/match's PSI adapter base64-encodes with Node's `Buffer`
// (`Buffer.from(bytes).toString('base64')`, `Buffer.from(text, 'base64')`). Browsers
// have no Buffer, so install the two calls it uses, and nothing more.

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64decode(text: string): Uint8Array {
  const s = atob(text.replace(/[^A-Za-z0-9+/=]/g, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

class MiniBuffer extends Uint8Array {
  toString(encoding?: string): string {
    return encoding === "base64" ? b64encode(this) : new TextDecoder().decode(this);
  }
}

export function installBufferShim(): void {
  const g = globalThis as { Buffer?: unknown };
  if (g.Buffer) return;
  g.Buffer = {
    from(x: Uint8Array | ArrayLike<number> | string, encoding?: string): MiniBuffer {
      if (typeof x === "string") {
        const bytes = encoding === "base64" ? b64decode(x) : new TextEncoder().encode(x);
        return new MiniBuffer(bytes);
      }
      return new MiniBuffer(Array.from(x as ArrayLike<number>));
    },
  };
}
