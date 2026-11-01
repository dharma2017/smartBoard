type NativeMessage = {
  id: string;
  type: "headers" | "chunk" | "done" | "error";
  status?: number;
  contentType?: string;
  bytes?: string;
  message?: string;
};
type NativeBridge = {
  request(
    id: string,
    method: string,
    path: string,
    body: string,
    headers: string,
  ): void;
  cancel(id: string): void;
  exportJson(name: string, json: string): void;
  configure(): void;
  workspaceKey(): string;
};
declare global {
  interface Window {
    SmartboardAndroid?: NativeBridge;
    __smartboardReceive?: (message: NativeMessage) => void;
  }
}
type Pending = { receive: (message: NativeMessage) => void; abort: () => void };
const pending = new Map<string, Pending>();

export function nativeBridge(): NativeBridge | undefined {
  return typeof window !== "undefined" ? window.SmartboardAndroid : undefined;
}

// Native HTTPS requests avoid exposing access tokens to JavaScript or requiring CORS.
// Each chunk is delivered to the same SSE parser used by the browser application.
export function appFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const bridge = nativeBridge();
  if (!bridge || !path.startsWith("/api/v1/")) return fetch(path, init);
  document.documentElement.dataset.native = "android";
  window.__smartboardReceive = (message) =>
    pending.get(message.id)?.receive(message);
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined,
      settled = false,
      sent = false;
    const cleanup = () => {
      pending.delete(id);
      init.signal?.removeEventListener("abort", abort);
    };
    const error = (reason: Error) => {
      if (settled) controller?.error(reason);
      else reject(reason);
      cleanup();
    };
    const abort = () => {
      if (sent) bridge.cancel(id);
      error(new DOMException("The request was stopped.", "AbortError"));
    };
    const receive = (message: NativeMessage) => {
      if (message.type === "headers") {
        const body = new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
          cancel() {
            bridge.cancel(id);
            cleanup();
          },
        });
        settled = true;
        resolve(
          new Response(body, {
            status: message.status || 200,
            headers: {
              "Content-Type": message.contentType || "application/json",
            },
          }),
        );
      } else if (message.type === "chunk")
        controller?.enqueue(
          Uint8Array.from(atob(message.bytes || ""), (char) =>
            char.charCodeAt(0),
          ),
        );
      else if (message.type === "done") {
        controller?.close();
        cleanup();
      } else if (message.type === "error")
        error(new Error(message.message || "The backend request failed."));
    };
    pending.set(id, { receive, abort });
    if (init.signal?.aborted) {
      abort();
      return;
    }
    init.signal?.addEventListener("abort", abort, { once: true });
    try {
      sent = true;
      bridge.request(
        id,
        init.method || "GET",
        path,
        String(init.body || ""),
        JSON.stringify({
          "Idempotency-Key":
            new Headers(init.headers).get("idempotency-key") || "",
        }),
      );
    } catch {
      error(new Error("The Android connection could not be started."));
    }
  });
}
