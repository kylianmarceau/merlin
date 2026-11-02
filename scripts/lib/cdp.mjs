import { EventEmitter, once } from "node:events";

export async function deadline(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export class CDP extends EventEmitter {
  constructor(ws) {
    super();
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const item = this.pending.get(message.id);
        if (!item) return;
        clearTimeout(item.timeout);
        this.pending.delete(message.id);
        message.error
          ? item.reject(Error(item.method + ": " + message.error.message))
          : item.resolve(message.result);
      } else this.emit(message.method, message.params, message.sessionId);
    });
    ws.addEventListener("close", () => {
      for (const item of this.pending.values()) {
        clearTimeout(item.timeout);
        item.reject(Error("DevTools connection closed"));
      }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await deadline(once(ws, "open"), 30000, "DevTools connection timeout");
    return new CDP(ws);
  }
  call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(method + " timed out"));
      }, 60000);
      this.pending.set(id, { method, resolve, reject, timeout });
      this.ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }
  close() {
    this.ws.close();
  }
}
