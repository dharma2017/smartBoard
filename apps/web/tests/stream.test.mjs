import test from "node:test";
import assert from "node:assert/strict";
import { readEvents, sameObject } from "../src/lib/types.ts";

test("saved objects stay clean when server field order and version change", () => {
  const content = {
    text: "F = ma",
    role: "body",
    color: "#dce8dc",
    fontSize: 24,
    points: [],
    strokeWidth: 3,
  };
  const draft = {
    id: "equation",
    boardId: "board",
    type: "EQUATION",
    x: 100,
    y: 200,
    width: 300,
    height: 90,
    rotation: 0,
    zIndex: 0,
    version: 1,
    content,
  };
  const saved = {
    y: 200,
    x: 100,
    height: 90,
    width: 300,
    type: "EQUATION",
    boardId: "board",
    id: "equation",
    version: 2,
    zIndex: 0,
    rotation: 0,
    content: { ...content },
  };
  assert.equal(sameObject(draft, saved), true);
  assert.equal(sameObject(draft, { ...saved, x: 101 }), false);
  assert.equal(
    sameObject(draft, { ...saved, content: { ...content, text: "E = mc²" } }),
    false,
  );
});

test("SSE decoding preserves Unicode across byte boundaries and CRLF across chunks", async () => {
  const bytes = new TextEncoder().encode(
    'event: answer_delta\r\ndata: {"text":"Newton’s law · m/s²"}\r\n\r\nevent: completed\r\ndata: {"status":"COMPLETED"}\r\n\r\n',
  );
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  const events = [];
  await readEvents(new Response(body), (name, data) =>
    events.push([name, data]),
  );
  assert.deepEqual(events, [
    ["answer_delta", { text: "Newton’s law · m/s²" }],
    ["completed", { status: "COMPLETED" }],
  ]);
});

test("consumer errors cancel the underlying stream", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'event: error\ndata: {"message":"Provider failed"}\n\n',
        ),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readEvents(new Response(body), (_, data) => {
      throw new Error(data.message);
    }),
    /Provider failed/,
  );
  assert.equal(cancelled, true);
});

test("HTTP errors are surfaced before reading SSE", async () => {
  await assert.rejects(
    readEvents(
      Response.json(
        { error: { message: "Select content first" } },
        { status: 422 },
      ),
      () => {},
    ),
    /Select content first/,
  );
});
