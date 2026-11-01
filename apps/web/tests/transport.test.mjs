import test from "node:test";
import assert from "node:assert/strict";
import { appFetch } from "../src/lib/transport.ts";

function setup(bridge) {
  globalThis.window = { SmartboardAndroid: bridge };
  globalThis.document = { documentElement: { dataset: {} } };
}
function cleanup() {
  delete globalThis.window;
  delete globalThis.document;
}

test("native transport delivers split UTF-8 bytes and preserves idempotency keys", async () => {
  let captured;
  setup({
    request(id, method, path, body, headers) {
      captured = { method, path, body, headers: JSON.parse(headers) };
      queueMicrotask(() => {
        window.__smartboardReceive({
          id,
          type: "headers",
          status: 200,
          contentType: "text/plain",
        });
        for (const byte of new TextEncoder().encode("Physics 🧠"))
          window.__smartboardReceive({
            id,
            type: "chunk",
            bytes: btoa(String.fromCharCode(byte)),
          });
        window.__smartboardReceive({ id, type: "done" });
      });
    },
    cancel() {},
  });
  try {
    const response = await appFetch("/api/v1/boards", {
      method: "POST",
      body: "{}",
      headers: { "Idempotency-Key": "test-id" },
    });
    assert.equal(await response.text(), "Physics 🧠");
    assert.equal(captured.headers["Idempotency-Key"], "test-id");
    assert.equal(document.documentElement.dataset.native, "android");
  } finally {
    cleanup();
  }
});

test("aborting a native request cancels its network connection", async () => {
  let id,
    cancelled = false;
  setup({
    request(value) {
      id = value;
    },
    cancel(value) {
      assert.equal(value, id);
      cancelled = true;
    },
  });
  try {
    const controller = new AbortController();
    const response = appFetch("/api/v1/ai/ask/stream", {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(response, { name: "AbortError" });
    assert.equal(cancelled, true);
  } finally {
    cleanup();
  }
});

test("native connection errors reject without a fabricated response", async () => {
  setup({
    request(id) {
      queueMicrotask(() =>
        window.__smartboardReceive({
          id,
          type: "error",
          message: "Backend unavailable",
        }),
      );
    },
    cancel() {},
  });
  try {
    await assert.rejects(appFetch("/api/v1/boards"), /Backend unavailable/);
  } finally {
    cleanup();
  }
});
