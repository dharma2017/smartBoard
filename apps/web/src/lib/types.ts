import { appFetch } from "./transport.ts";
export type Tool =
  | "select"
  | "rectangle"
  | "lasso"
  | "pen"
  | "text"
  | "equation"
  | "shape"
  | "eraser"
  | "hand";
export type Point = { x: number; y: number };
export type BoardObject = {
  id: string;
  boardId: string;
  type: "TEXT" | "EQUATION" | "STROKE" | "SHAPE";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0;
  zIndex: number;
  version: number;
  content: {
    text: string;
    role: "heading" | "body" | "caption";
    color: string;
    fontSize: number;
    points: number[];
    strokeWidth: number;
  };
};
export type Extracted = {
  id: string;
  type: string;
  content: string;
  recognitionRequired: boolean;
};
export type Selection = {
  selectionId: string;
  boardId: string;
  boardVersion: number;
  selectionType: string;
  objectIds: string[];
  extractedContent: Extracted[];
  surroundingContext: Extracted[];
  recognitionRequired: boolean;
  createdAt: string;
};
export type SelectionRequest = {
  selectionType: "OBJECT" | "RECTANGLE" | "LASSO";
  objectIds?: string[];
  bounds?: { x: number; y: number; width: number; height: number };
  polygon?: Point[];
  includeSurroundingContext?: boolean;
};
export type Interaction = {
  requestId: string;
  selectionId: string;
  question: string;
  answer: string;
  status: string;
  intent: string;
  createdAt?: string;
  usage?: Record<string, unknown>;
};
export type BoardSummary = {
  boardId: string;
  title: string;
  currentVersion: number;
  updatedAt: string;
};
export type Board = BoardSummary & {
  objects: BoardObject[];
  latestSelection: Selection | null;
  interactions: Interaction[];
};

// JSON field order can change across the API round-trip; version is server-owned.
export function sameObject(a: BoardObject, b: BoardObject): boolean {
  const value = (o: BoardObject) => [
    o.id,
    o.boardId,
    o.type,
    o.x,
    o.y,
    o.width,
    o.height,
    o.rotation,
    o.zIndex,
    o.content.text,
    o.content.role,
    o.content.color,
    o.content.fontSize,
    o.content.points,
    o.content.strokeWidth,
  ];
  return JSON.stringify(value(a)) === JSON.stringify(value(b));
}

export async function api<T>(
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await appFetch(`/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await res.json();
  if (!res.ok)
    throw new Error(result.error?.message || "The request failed. Try again.");
  return result.data;
}

export function makeObject(
  boardId: string,
  type: BoardObject["type"],
  x: number,
  y: number,
  text = "",
): BoardObject {
  return {
    id: crypto.randomUUID(),
    boardId,
    type,
    x,
    y,
    width: type === "EQUATION" ? 350 : 380,
    height: type === "EQUATION" ? 90 : 80,
    rotation: 0,
    zIndex: 0,
    version: 1,
    content: {
      text,
      role: "body",
      color: "#dce8dc",
      fontSize: type === "EQUATION" ? 52 : 24,
      points: [],
      strokeWidth: 3,
    },
  };
}

export function exampleObjects(boardId: string): BoardObject[] {
  const heading = makeObject(boardId, "TEXT", 82, 90, "Newton’s second law");
  Object.assign(heading, { width: 550, height: 50 });
  Object.assign(heading.content, {
    role: "heading",
    fontSize: 34,
    color: "#eff2d9",
  });
  const intro = makeObject(
    boardId,
    "TEXT",
    84,
    157,
    "How does a force change motion?",
  );
  Object.assign(intro, { width: 550, height: 50 });
  Object.assign(intro.content, { fontSize: 21, color: "#9bb9a9" });
  const equation = makeObject(boardId, "EQUATION", 124, 267, "F = ma");
  Object.assign(equation, { width: 350, height: 95 });
  Object.assign(equation.content, { fontSize: 64, color: "#e5f4b5" });
  const note = makeObject(
    boardId,
    "TEXT",
    125,
    400,
    "F   net force (N)\nm   mass (kg)\na   acceleration (m/s²)",
  );
  Object.assign(note, { width: 370, height: 120 });
  Object.assign(note.content, { fontSize: 23, color: "#b2c9ba" });
  const unrelated = makeObject(
    boardId,
    "TEXT",
    670,
    145,
    "NEXT LESSON\nWork & energy",
  );
  Object.assign(unrelated, { width: 240, height: 85 });
  Object.assign(unrelated.content, { fontSize: 18, color: "#77998a" });
  return [heading, intro, equation, note, unrelated];
}

export async function readEvents(
  response: Response,
  onEvent: (name: string, data: Record<string, unknown>) => void,
) {
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error?.message || "Could not start the response.");
  }
  if (!response.body)
    throw new Error("Streaming is unavailable in this browser.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(
        /\r\n/g,
        "\n",
      );
      if (buffer.length > 1_000_000)
        throw new Error("The response frame is too large.");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const name = block
          .split("\n")
          .find((l) => l.startsWith("event:"))
          ?.slice(6)
          .trim();
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (name && data) onEvent(name, JSON.parse(data));
      }
      if (done) {
        finished = true;
        break;
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
