"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  exampleObjects,
  sameObject,
  type Board,
  type BoardObject,
  type BoardSummary,
} from "./types";
type SaveResult = BoardSummary & { objects?: BoardObject[] };
const same = sameObject;

export function useBoard(onError: (message: string) => void) {
  const [board, setBoard] = useState<Board | null>(null),
    [objects, setObjects] = useState<BoardObject[]>([]);
  const [loading, setLoading] = useState(true),
    [saveState, setSaveState] = useState("saved");
  const [canUndo, setCanUndo] = useState(false),
    [canRedo, setCanRedo] = useState(false);
  const boardRef = useRef<Board | null>(null),
    objectsRef = useRef<BoardObject[]>([]),
    serverRef = useRef<BoardObject[]>([]);
  const versionRef = useRef(1),
    queue = useRef<Promise<void>>(Promise.resolve()),
    pending = useRef<unknown>(null);
  const undoStack = useRef<BoardObject[][]>([]),
    redoStack = useRef<BoardObject[][]>([]),
    initialized = useRef(false);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  function adopt(value: Board) {
    boardRef.current = value;
    objectsRef.current = value.objects;
    serverRef.current = value.objects;
    versionRef.current = value.currentVersion;
    setBoard(value);
    setObjects(value.objects);
    setSaveState("saved");
    undoStack.current = [];
    redoStack.current = [];
    pending.current = null;
    setCanUndo(false);
    setCanRedo(false);
    localStorage.setItem("smartboard:lastBoard", value.boardId);
  }
  const save = useCallback(() => {
    const job = queue.current
      .then(async () => {
        const current = boardRef.current;
        if (!current) return;
        async function send(body: unknown) {
          const result = await api<SaveResult>(
            `/boards/${current!.boardId}/operations`,
            body,
          );
          versionRef.current = result.currentVersion;
          if (result.objects) serverRef.current = result.objects;
          pending.current = null;
          setBoard((b) =>
            b
              ? {
                  ...b,
                  currentVersion: result.currentVersion,
                  updatedAt: result.updatedAt,
                }
              : b,
          );
        }
        if (pending.current) {
          setSaveState("saving");
          await send(pending.current);
        }
        const target = objectsRef.current,
          old = new Map(serverRef.current.map((o) => [o.id, o])),
          nextIds = new Set(target.map((o) => o.id));
        const operations: unknown[] = [];
        for (const obj of target) {
          const previous = old.get(obj.id);
          if (!previous || !same(previous, obj))
            operations.push({
              operationId: crypto.randomUUID(),
              type: previous ? "OBJECT_UPDATE" : "OBJECT_CREATE",
              object: obj,
            });
        }
        for (const obj of serverRef.current)
          if (!nextIds.has(obj.id))
            operations.push({
              operationId: crypto.randomUUID(),
              type: "OBJECT_DELETE",
              objectId: obj.id,
            });
        if (!operations.length) {
          setSaveState("saved");
          return;
        }
        setSaveState("saving");
        pending.current = { baseVersion: versionRef.current, operations };
        await send(pending.current);
        setSaveState("saved");
      })
      .catch((error) => {
        setSaveState("error");
        errorRef.current(error.message);
        throw error;
      });
    queue.current = job.catch(() => {});
    return job;
  }, []);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      const boards = await api<BoardSummary[]>("/boards");
      const stored = localStorage.getItem("smartboard:lastBoard");
      const match = boards.find((b) => b.boardId === stored) || boards[0];
      if (match) {
        adopt(await api<Board>(`/boards/${match.boardId}`));
        return;
      }
      let key = localStorage.getItem("smartboard:initialKey");
      if (!key) {
        key = crypto.randomUUID();
        localStorage.setItem("smartboard:initialKey", key);
      }
      const created = await api<BoardSummary>(
        "/boards",
        { title: "Physics · Newton’s laws" },
        { "Idempotency-Key": key },
      );
      let loaded = await api<Board>(`/boards/${created.boardId}`);
      if (!loaded.objects.length) {
        const examples = exampleObjects(created.boardId);
        await api(`/boards/${created.boardId}/operations`, {
          baseVersion: loaded.currentVersion,
          operations: examples.map((o) => ({
            operationId: crypto.randomUUID(),
            type: "OBJECT_CREATE",
            object: o,
          })),
        });
        loaded = await api<Board>(`/boards/${created.boardId}`);
      }
      adopt(loaded);
    })()
      .catch((e) => errorRef.current(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!board) return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 650);
    return () => clearTimeout(timer);
  }, [objects, board?.boardId, save]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (
        pending.current ||
        objectsRef.current.some(
          (o) => !serverRef.current.some((s) => same(o, s)),
        ) ||
        objectsRef.current.length !== serverRef.current.length
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  function apply(next: BoardObject[]) {
    undoStack.current = [...undoStack.current.slice(-49), objectsRef.current];
    redoStack.current = [];
    objectsRef.current = next;
    setObjects(next);
    setSaveState("unsaved");
    setCanUndo(true);
    setCanRedo(false);
  }
  function undo() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(objectsRef.current);
    objectsRef.current = previous;
    setObjects(previous);
    setSaveState("unsaved");
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }
  function redo() {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(objectsRef.current);
    objectsRef.current = next;
    setObjects(next);
    setSaveState("unsaved");
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }
  async function open(id: string) {
    await save();
    setLoading(true);
    try {
      adopt(await api<Board>(`/boards/${id}`));
    } finally {
      setLoading(false);
    }
  }
  async function create(title: string) {
    await save();
    setLoading(true);
    try {
      const created = await api<BoardSummary>(
        "/boards",
        { title },
        { "Idempotency-Key": crypto.randomUUID() },
      );
      adopt(await api<Board>(`/boards/${created.boardId}`));
    } finally {
      setLoading(false);
    }
  }
  async function reloadSaved() {
    if (!boardRef.current) return;
    await queue.current;
    setLoading(true);
    try {
      adopt(await api<Board>(`/boards/${boardRef.current.boardId}`));
    } finally {
      setLoading(false);
    }
  }
  return {
    board,
    objects,
    loading,
    saveState,
    save,
    apply,
    undo,
    redo,
    canUndo,
    canRedo,
    open,
    create,
    reloadSaved,
  };
}
