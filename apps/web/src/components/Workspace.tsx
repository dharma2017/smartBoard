"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CloudCheck,
  Command,
  CornerDownLeft,
  Ellipsis,
  Equal,
  Expand,
  Hand,
  Lasso,
  Layers,
  LoaderCircle,
  MessageCircle,
  Minus,
  MousePointer2,
  NotebookPen,
  PenLine,
  Plus,
  Redo2,
  Scan,
  Shapes,
  Sparkles,
  Square,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
  X,
  Eraser,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  api,
  readEvents,
  type BoardObject,
  type BoardSummary,
  type Interaction,
  type Selection,
  type SelectionRequest,
  type Tool,
} from "@/lib/types";
import { useBoard } from "@/lib/useBoard";
import { appFetch, nativeBridge } from "@/lib/transport";
const BoardCanvas = dynamic(() => import("./BoardCanvas"), {
  ssr: false,
  loading: () => (
    <div className="canvas-loading">
      <LoaderCircle className="spin" /> Preparing your board
    </div>
  ),
});
const tools: { id: Tool; label: string; key: string; icon: LucideIcon }[] = [
  { id: "select", label: "Select & move", key: "V", icon: MousePointer2 },
  {
    id: "rectangle",
    label: "Rectangle selection",
    key: "R",
    icon: SquareDashed,
  },
  { id: "lasso", label: "Lasso selection", key: "L", icon: Lasso },
  { id: "pen", label: "Pen", key: "P", icon: PenLine },
  { id: "eraser", label: "Erase object", key: "E", icon: Eraser },
  { id: "text", label: "Add text", key: "T", icon: Type },
  { id: "equation", label: "Add equation", key: "Q", icon: Equal },
  { id: "shape", label: "Add shape", key: "S", icon: Shapes },
  { id: "hand", label: "Pan board", key: "H", icon: Hand },
];
const colors = ["#dce8dc", "#e5f4b5", "#f0c19a", "#a9cde8"];
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Try again.";

export default function Workspace() {
  const [error, setError] = useState("");
  const b = useBoard(setError);
  const [tool, setTool] = useState<Tool>("select"),
    [color, setColor] = useState(colors[0]),
    [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<Selection | null>(null),
    [selecting, setSelecting] = useState(false),
    [nearby, setNearby] = useState(true);
  const [question, setQuestion] = useState(""),
    [interactions, setInteractions] = useState<Interaction[]>([]),
    [streaming, setStreaming] = useState(false);
  const [provider, setProvider] = useState("demo"),
    [providerKnown, setProviderKnown] = useState(false),
    [authMode, setAuthMode] = useState("dev");
  const [draft, setDraft] = useState<BoardObject | null>(null),
    [modal, setModal] = useState<"boards" | "new" | "help" | null>(null),
    [title, setTitle] = useState("");
  const [boards, setBoards] = useState<BoardSummary[]>([]),
    [showObjects, setShowObjects] = useState(false),
    [mobilePanel, setMobilePanel] = useState(false);
  const abort = useRef<AbortController | null>(null),
    chatEnd = useRef<HTMLDivElement>(null),
    selectSequence = useRef(0);
  const [contextOpen, setContextOpen] = useState(true);
  useEffect(() => {
    api<{ provider: string; authMode: string }>("/health")
      .then((v) => {
        setProvider(v.provider);
        setAuthMode(v.authMode);
        setProviderKnown(true);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    selectSequence.current++;
    setSelecting(false);
    setSelection(b.board?.latestSelection || null);
    setInteractions(b.board?.interactions || []);
    setQuestion("");
    setZoom(
      window.innerWidth < 850
        ? Math.max(0.4, Math.min(1, (window.innerWidth - 100) / 660))
        : 1,
    );
  }, [b.board?.boardId, b.board?.interactions, b.board?.latestSelection]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [interactions, streaming]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!draft && !modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,[tabindex="0"]',
        ) || [],
      );
    if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft(null);
        setModal(null);
        return;
      }
      if (e.key !== "Tab") return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [!!draft, modal]);
  const currentChat = interactions.filter(
    (i) => i.selectionId === selection?.selectionId,
  );
  const selectedIds = selection?.objectIds || [];
  function edit(obj: BoardObject) {
    setDraft(structuredClone(obj));
  }
  function changeTool(next: Tool) {
    setTool(next);
  }
  async function selectContent(request: SelectionRequest) {
    if (!b.board) return;
    if (streaming) {
      setError("Stop the current answer before changing the selection.");
      return;
    }
    const sequence = ++selectSequence.current;
    setSelecting(true);
    setError("");
    try {
      await b.save();
      const value = await api<Selection>(
        `/boards/${b.board.boardId}/selection`,
        { ...request, includeSurroundingContext: nearby },
      );
      if (sequence !== selectSequence.current) return;
      setSelection(value);
      setContextOpen(true);
      if (!value.objectIds.length)
        setError(
          "No objects in that selection. Try a smaller region around the equation.",
        );
    } catch (e) {
      setError(message(e));
    } finally {
      if (sequence === selectSequence.current) setSelecting(false);
    }
  }
  function trySelection() {
    const equation = b.objects.find((o) => o.type === "EQUATION");
    if (equation)
      void selectContent({ selectionType: "OBJECT", objectIds: [equation.id] });
    else setTool("rectangle");
  }
  async function send(text = question, intent = "EXPLAIN") {
    if (!b.board || !selection || !text.trim() || streaming || selecting)
      return;
    const sid = selection.selectionId,
      localId = crypto.randomUUID();
    const controller = new AbortController();
    abort.current = controller;
    setStreaming(true);
    setError("");
    setQuestion("");
    setMobilePanel(true);
    const row: Interaction = {
      requestId: localId,
      selectionId: sid,
      question: text.trim(),
      answer: "",
      status: "PROCESSING",
      intent,
    };
    setInteractions((items) => [...items, row]);
    let completed = false;
    const patch = (values: Partial<Interaction>) =>
      setInteractions((items) =>
        items.map((i) => (i.requestId === localId ? { ...i, ...values } : i)),
      );
    try {
      const response = await appFetch("/api/v1/ai/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          boardId: b.board.boardId,
          selectionId: sid,
          question: text.trim(),
          intent,
        }),
      });
      await readEvents(response, (name, data) => {
        if (name === "answer_delta")
          setInteractions((items) =>
            items.map((i) =>
              i.requestId === localId
                ? { ...i, answer: i.answer + String(data.text) }
                : i,
            ),
          );
        if (name === "completed") {
          completed = true;
          patch({
            status: "COMPLETED",
            usage: data.usage as Record<string, unknown>,
          });
        }
        if (name === "error") throw new Error(String(data.message));
      });
      if (!completed)
        throw new Error(
          "The response ended early. You can try your question again.",
        );
    } catch (e) {
      const cancelled = e instanceof Error && e.name === "AbortError";
      patch({ status: cancelled ? "CANCELLED" : "FAILED" });
      if (!cancelled) {
        setError(message(e));
        setQuestion(text);
      }
    } finally {
      setStreaming(false);
      abort.current = null;
    }
  }
  function deleteSelected() {
    if (selectedIds.length)
      b.apply(b.objects.filter((o) => !selectedIds.includes(o.id)));
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        draft ||
        modal
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) b.redo();
        else b.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void b.save().catch(() => {});
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      const entry = tools.find(
        (t) => t.key.toLowerCase() === e.key.toLowerCase(),
      );
      if (entry && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setTool(entry.id);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function browse() {
    try {
      setBoards(await api<BoardSummary[]>("/boards"));
      setModal("boards");
    } catch (e) {
      setError(message(e));
    }
  }
  function exportBoard() {
    if (!b.board) return;
    const bridge = nativeBridge();
    if (bridge) {
      bridge.exportJson(
        `${b.board.title.replace(/[^a-z0-9]/gi, "-")}.json`,
        JSON.stringify(
          {
            ...b.board,
            objects: b.objects,
            latestSelection: selection,
            interactions,
          },
          null,
          2,
        ),
      );
      return;
    }
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...b.board,
            objects: b.objects,
            latestSelection: selection,
            interactions,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a"),
      url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `${b.board.title.replace(/[^a-z0-9]/gi, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const canAsk =
    !!selection?.objectIds.length &&
    !selection.recognitionRequired &&
    !selecting;
  return (
    <main className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => void browse()}
          aria-label="Smartboard home"
        >
          <span className="brand-symbol">
            <NotebookPen size={22} />
          </span>
          <span>
            smartboard<span className="brand-dot">.</span>
          </span>
        </button>
        <span className="header-divider" />
        <button className="workspace-link" onClick={() => void browse()}>
          My workspace <ChevronDown size={13} />
        </button>
        <div className="topbar-right">
          <span
            className={`save-indicator ${b.saveState === "error" ? "save-error" : ""}`}
            role="status"
          >
            {b.saveState === "saving" ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <CloudCheck size={15} />
            )}
            <span>
              {b.saveState === "saved"
                ? "All changes saved"
                : b.saveState === "saving"
                  ? "Saving…"
                  : b.saveState === "error"
                    ? "Save failed"
                    : "Unsaved changes"}
            </span>
          </span>
          <button
            className="button quiet export-button"
            onClick={exportBoard}
            disabled={!b.board}
          >
            <ArrowDownToLine size={15} /> Export JSON
          </button>
          <span
            className="avatar"
            title={
              authMode === "dev"
                ? "Local learner · development session"
                : "Your workspace"
            }
          >
            L
          </span>
        </div>
      </header>
      <div className="workspace-bar">
        <div className="board-breadcrumb">
          <BookOpen size={16} />
          <span>My boards</span>
          <ChevronRight size={13} />
          <strong>{b.board?.title || "Opening your board…"}</strong>
          <span className="local-tag">
            {authMode === "dev" ? "LOCAL" : "PRIVATE"}
          </span>
        </div>
        <div className="board-actions">
          <button
            className="button quiet"
            onClick={() => {
              setTitle("");
              setModal("new");
            }}
            disabled={streaming || b.loading}
          >
            <Plus size={15} /> New board
          </button>
          <button
            className="icon-button"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            onClick={() => setModal("help")}
          >
            <Command size={16} />
          </button>
        </div>
      </div>
      <div className="workspace-body">
        <aside className="tool-rail" aria-label="Drawing tools">
          <div className="tools-list">
            {tools.map((t, index) => (
              <div
                key={t.id}
                className={index === 3 || index === 8 ? "tool-divider" : ""}
              >
                <button
                  className={`tool-button ${tool === t.id ? "active" : ""}`}
                  aria-label={t.label}
                  aria-pressed={tool === t.id}
                  title={`${t.label} (${t.key})`}
                  onClick={() => changeTool(t.id)}
                >
                  <t.icon size={20} strokeWidth={1.65} />
                  {tool === t.id && <i />}
                </button>
              </div>
            ))}
          </div>
          <div className="color-list" aria-label="Pen color">
            {colors.map((c) => (
              <button
                key={c}
                className={`color-button ${color === c ? "chosen" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>
          <button
            className="tool-button rail-help"
            title="Help & shortcuts"
            aria-label="Help & shortcuts"
            onClick={() => setModal("help")}
          >
            <span>?</span>
          </button>
        </aside>
        <section className="board-area" aria-label="Interactive blackboard">
          <div className="canvas-topline">
            <span>
              <i className="status-dot" /> A space to think.
            </span>
            <button
              className={`objects-toggle ${showObjects ? "selected" : ""}`}
              onClick={() => setShowObjects((v) => !v)}
              aria-expanded={showObjects}
            >
              <Layers size={14} /> Objects <span>{b.objects.length}</span>
            </button>
          </div>
          <div className="board-surface">
            {b.board && !b.loading && (
              <BoardCanvas
                key={b.board.boardId}
                boardId={b.board.boardId}
                objects={b.objects}
                tool={tool}
                color={color}
                selectedIds={selectedIds}
                zoom={zoom}
                onZoom={setZoom}
                onSelection={(r) => void selectContent(r)}
                onChange={b.apply}
                onEdit={edit}
                onTool={setTool}
              />
            )}
            {!b.board || b.loading ? (
              <div className="board-loading">
                <LoaderCircle size={26} className="spin" />
                <span>
                  {b.loading
                    ? "Opening your learning space…"
                    : "Start the API service to open your board."}
                </span>
                {!b.loading && (
                  <button
                    className="button"
                    onClick={() => window.location.reload()}
                  >
                    Try again
                  </button>
                )}
              </div>
            ) : null}
            {showObjects && (
              <div className="objects-popover">
                <div className="popover-heading">
                  Board objects{" "}
                  <button
                    className="icon-button"
                    aria-label="Close object list"
                    onClick={() => setShowObjects(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
                {b.objects.length ? (
                  b.objects.map((o) => (
                    <div className="object-row" key={o.id}>
                      <button
                        className={
                          selectedIds.includes(o.id) ? "is-selected" : ""
                        }
                        onClick={() =>
                          void selectContent({
                            selectionType: "OBJECT",
                            objectIds: [o.id],
                          })
                        }
                      >
                        <span>
                          {o.type === "EQUATION"
                            ? "ƒ"
                            : o.type === "STROKE"
                              ? "∿"
                              : "T"}
                        </span>
                        {o.content.text || o.type.toLowerCase()}
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${o.content.text || o.type}`}
                        onClick={() => edit(o)}
                      >
                        <PenLine size={13} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p>Add text or draw on the board.</p>
                )}
              </div>
            )}
            {b.board && !selection && !b.loading && (
              <div className="canvas-hint">
                <Scan size={15} />
                <span>Select a thought. Explore it with AI.</span>
                <button onClick={trySelection}>
                  Try it <ArrowUp size={13} />
                </button>
              </div>
            )}
            {selection && (
              <div className="selection-pill">
                <Scan size={14} />
                {selecting
                  ? "Reading selection…"
                  : `${selection.objectIds.length} object${selection.objectIds.length === 1 ? "" : "s"} selected`}
                <span />{" "}
                <button
                  onClick={() => {
                    if (!streaming) {
                      selectSequence.current++;
                      setSelection(null);
                      setSelecting(false);
                    }
                  }}
                  aria-label="Clear selection"
                  disabled={streaming}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="board-bottom">
              <div className="zoom-controls">
                <button
                  aria-label="Zoom out"
                  onClick={() => setZoom((v) => Math.max(0.4, v - 0.1))}
                >
                  <Minus size={14} />
                </button>
                <button
                  className="zoom-label"
                  onClick={() => setZoom(1)}
                  title="Reset zoom"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  aria-label="Zoom in"
                  onClick={() => setZoom((v) => Math.min(2, v + 0.1))}
                >
                  <Plus size={14} />
                </button>
                <span />
                <button aria-label="Fit board" onClick={() => setZoom(0.75)}>
                  <Expand size={14} />
                </button>
              </div>
              <div className="history-controls">
                <button
                  aria-label="Undo"
                  title="Undo (Ctrl+Z)"
                  disabled={!b.canUndo}
                  onClick={b.undo}
                >
                  <Undo2 size={17} />
                </button>
                <button
                  aria-label="Redo"
                  title="Redo (Ctrl+Shift+Z)"
                  disabled={!b.canRedo}
                  onClick={b.redo}
                >
                  <Redo2 size={17} />
                </button>
              </div>
              <span className="board-footnote">
                {tools.find((t) => t.id === tool)?.label} <span>·</span>{" "}
                {tool === "select"
                  ? "Shift + click to select more"
                  : "Drag on the board"}
              </span>
            </div>
          </div>
          <div className="under-board">
            <span>
              <MousePointer2 size={12} /> Double-click an object to edit
            </span>
            <button onClick={() => void b.save().catch(() => {})}>
              {b.saveState === "error" ? "Retry saving" : "Save board"}
              <CornerDownLeft size={12} />
            </button>
            <span className="version-label">
              v{b.board?.currentVersion || 1}
            </span>
          </div>
        </section>
        <button
          className={`mobile-assistant-button ${mobilePanel ? "panel-is-open" : ""}`}
          onClick={() => setMobilePanel((v) => !v)}
        >
          <Sparkles size={18} />
          Ask assistant
        </button>
        <aside
          className={`assistant-panel ${mobilePanel ? "mobile-open" : ""}`}
          aria-label="Contextual AI assistant"
        >
          <div className="assistant-header">
            <span className="assistant-symbol">
              <Sparkles size={20} />
            </span>
            <div>
              <h1>Learning assistant</h1>
              <p>A little context. A new perspective.</p>
            </div>
            <button
              className="icon-button mobile-close"
              aria-label="Close assistant"
              onClick={() => setMobilePanel(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="assistant-tabs">
            <span>
              <MessageCircle size={14} /> Conversation
            </span>
            <span
              className={`provider-badge ${provider === "demo" ? "demo" : ""}`}
            >
              {providerKnown
                ? provider === "demo"
                  ? "Demo mode"
                  : "Live AI"
                : "Connecting…"}
            </span>
          </div>
          <div className="assistant-scroll">
            <div className="context-section">
              <button
                className="context-heading"
                onClick={() => setContextOpen((v) => !v)}
                aria-expanded={contextOpen}
              >
                <span>
                  <Scan size={14} /> SELECTED CONTEXT
                </span>
                <span>
                  {selection?.objectIds.length || 0} objects{" "}
                  <ChevronDown
                    size={13}
                    style={{
                      transform: contextOpen ? "none" : "rotate(-90deg)",
                    }}
                  />
                </span>
              </button>
              {contextOpen &&
                (selection?.objectIds.length ? (
                  <>
                    <div className="context-contents">
                      {selection.extractedContent.map((o) => (
                        <div
                          className={`context-object ${o.type === "EQUATION" ? "equation-context" : ""}`}
                          key={o.id}
                        >
                          <span className="object-type">
                            {o.type === "EQUATION" ? "EQUATION" : o.type}
                          </span>
                          <p>{o.content || "Drawing · transcription needed"}</p>
                          {o.recognitionRequired && (
                            <button
                              className="inline-link"
                              onClick={() => {
                                const obj = b.objects.find(
                                  (v) => v.id === o.id,
                                );
                                if (obj) edit(obj);
                              }}
                            >
                              Add transcription
                            </button>
                          )}
                        </div>
                      ))}
                      {selection.surroundingContext.length > 0 && (
                        <div className="nearby-heading">
                          <span>
                            <Layers size={12} /> Nearby heading
                          </span>
                          {selection.surroundingContext.map((o) => (
                            <p key={o.id}>{o.content}</p>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="context-detail">
                      <Check size={12} />{" "}
                      {selection.recognitionRequired
                        ? "Review drawing transcription"
                        : "Context ready for your question"}
                    </div>
                    {selection.boardVersion !== b.board?.currentVersion && (
                      <p className="snapshot-note">
                        Using the saved selection from v{selection.boardVersion}
                        . Reselect to include your edits.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="context-empty">
                    <SquareDashed size={24} />
                    <p>Select an object, or draw a region on the board.</p>
                    <button onClick={trySelection}>
                      Try selecting the equation <ChevronRight size={12} />
                    </button>
                  </div>
                ))}
              <label className="nearby-option">
                <input
                  type="checkbox"
                  checked={nearby}
                  onChange={(e) => setNearby(e.target.checked)}
                />{" "}
                Include nearby headings on next selection
              </label>
            </div>
            {!currentChat.length && (
              <div className="assistant-welcome">
                <span className="welcome-spark">
                  <Sparkles size={23} strokeWidth={1.3} />
                </span>
                <h2>Let’s make it click.</h2>
                <p>
                  {selection?.objectIds.length
                    ? "Your selection is the starting point. What would you like to understand?"
                    : "Select a concept on your board, then ask me to help you understand it."}
                </p>
                <div className="suggested-actions">
                  <button
                    disabled={!canAsk || streaming}
                    onClick={() =>
                      void send("Explain this in simple language.", "EXPLAIN")
                    }
                  >
                    <BookOpen size={16} />
                    <span>Explain simply</span>
                    <ChevronRight size={14} />
                  </button>
                  <button
                    disabled={!canAsk || streaming}
                    onClick={() =>
                      void send(
                        "Give me a real-world example of this.",
                        "GENERATE_EXAMPLES",
                      )
                    }
                  >
                    <Sparkles size={16} />
                    <span>Find a real-world example</span>
                    <ChevronRight size={14} />
                  </button>
                  <button
                    disabled={!canAsk || streaming}
                    onClick={() =>
                      void send("Summarize the selected content.", "SUMMARIZE")
                    }
                  >
                    <Layers size={16} />
                    <span>Give me the big picture</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
            <div
              className="chat-history"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {currentChat.map((i) => (
                <article className="chat-turn" key={i.requestId}>
                  <div className="user-message">
                    <span className="message-label">YOU</span>
                    <p>{i.question}</p>
                  </div>
                  <div className="assistant-message">
                    <span className="message-label">
                      <Sparkles size={12} /> SMARTBOARD
                    </span>
                    <p>
                      {i.answer ||
                        (i.status === "PROCESSING"
                          ? "Thinking with your selection…"
                          : "No response received.")}
                      {i.status === "PROCESSING" && (
                        <span className="stream-cursor" />
                      )}
                    </p>
                    {i.status !== "COMPLETED" && i.status !== "PROCESSING" && (
                      <div className="incomplete-note">
                        {i.status === "CANCELLED"
                          ? "Stopped"
                          : "Incomplete response"}{" "}
                        · {i.answer ? "Partial answer" : "You can try again"}
                      </div>
                    )}
                    {i.status === "COMPLETED" && (
                      <div className="response-meta">
                        <Check size={11} /> Saved with your board{" "}
                        {i.usage?.outputTokens != null && (
                          <span>· {String(i.usage.outputTokens)} tokens</span>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <div ref={chatEnd} />
          </div>
          <form
            className="question-area"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className={`question-box ${!canAsk ? "inactive" : ""}`}>
              <textarea
                aria-label="Ask about your selection"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  canAsk
                    ? "Ask about your selection…"
                    : "Select something to get started…"
                }
                disabled={!canAsk || streaming}
                maxLength={2000}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="question-box-footer">
                <span>
                  <Scan size={12} />
                  {selection?.objectIds.length
                    ? `${selection.objectIds.length} selected`
                    : "Board context"}
                </span>
                {streaming ? (
                  <button
                    type="button"
                    className="send-button stop"
                    aria-label="Stop response"
                    onClick={() => abort.current?.abort()}
                  >
                    <Square size={13} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                    aria-label="Send question"
                    disabled={!canAsk || !question.trim()}
                  >
                    <ArrowUp size={18} />
                  </button>
                )}
              </div>
            </div>
            <p>
              {provider === "demo"
                ? "Demo responses are scripted. Live AI is configurable."
                : "AI can make mistakes. Check important information."}
            </p>
          </form>
        </aside>
      </div>
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          {b.saveState === "error" && (
            <>
              <button className="recovery-action" onClick={exportBoard}>
                Download local draft
              </button>
              <button
                className="recovery-action"
                onClick={() =>
                  void b
                    .reloadSaved()
                    .then(() => {
                      setError("");
                      setSelection(null);
                    })
                    .catch((e) => setError(message(e)))
                }
              >
                Discard draft & reload saved board
              </button>
            </>
          )}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}
      {draft && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDraft(null);
          }}
        >
          <form
            className="modal editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-title"
            onSubmit={(e) => {
              e.preventDefault();
              const existing = b.objects.some((o) => o.id === draft.id);
              const updated = {
                ...draft,
                height: Math.max(
                  draft.height,
                  draft.content.text.split("\n").length *
                    draft.content.fontSize *
                    1.45 +
                    8,
                ),
              };
              b.apply(
                existing
                  ? b.objects.map((o) => (o.id === draft.id ? updated : o))
                  : [...b.objects, updated],
              );
              setDraft(null);
              setTool("select");
            }}
          >
            <div className="modal-heading">
              <h2 id="editor-title">
                {draft.type === "STROKE"
                  ? "Transcribe drawing"
                  : b.objects.some((o) => o.id === draft.id)
                    ? "Edit object"
                    : draft.type === "EQUATION"
                      ? "Add an equation"
                      : "Add text"}
              </h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setDraft(null)}
                aria-label="Close editor"
              >
                <X size={18} />
              </button>
            </div>
            <label>
              {draft.type === "STROKE"
                ? "What does this drawing say?"
                : draft.type === "EQUATION"
                  ? "Equation (plain text or Unicode)"
                  : "Text"}
              <textarea
                autoFocus
                rows={4}
                maxLength={4000}
                required={draft.type === "TEXT" || draft.type === "EQUATION"}
                value={draft.content.text}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    content: { ...draft.content, text: e.target.value },
                  })
                }
              />
            </label>
            {draft.type === "TEXT" && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.content.role === "heading"}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      content: {
                        ...draft.content,
                        role: e.target.checked ? "heading" : "body",
                      },
                    })
                  }
                />{" "}
                Use as a heading for nearby context
              </label>
            )}
            {draft.type !== "STROKE" && (
              <div className="editor-fields">
                <label>
                  Font size
                  <input
                    type="number"
                    min={12}
                    max={64}
                    value={draft.content.fontSize}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        content: {
                          ...draft.content,
                          fontSize: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Width
                  <input
                    type="number"
                    min={40}
                    max={2000}
                    value={draft.width}
                    onChange={(e) =>
                      setDraft({ ...draft, width: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
            )}
            <p className="editor-note">
              {draft.type === "STROKE"
                ? "Review your transcription, save, then select the drawing again."
                : "Save your changes, then select the content to ask the assistant."}
            </p>
            <div className="modal-actions">
              {b.objects.some((o) => o.id === draft.id) && (
                <button
                  type="button"
                  className="button delete-button"
                  onClick={() => {
                    b.apply(b.objects.filter((o) => o.id !== draft.id));
                    setDraft(null);
                  }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button type="submit" className="button primary">
                Save object <Check size={14} />
              </button>
            </div>
          </form>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <h2 id="modal-title">
                {modal === "boards"
                  ? "Your learning space"
                  : modal === "new"
                    ? "Start a new board"
                    : "Make yourself at home"}
              </h2>
              <button
                className="icon-button"
                onClick={() => setModal(null)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>
            {modal === "boards" ? (
              <div className="board-list">
                {boards.map((board) => (
                  <button
                    disabled={streaming}
                    key={board.boardId}
                    onClick={() => {
                      void b
                        .open(board.boardId)
                        .then(() => setModal(null))
                        .catch((e) => setError(message(e)));
                    }}
                  >
                    <BookOpen size={18} />
                    <span>
                      <strong>{board.title}</strong>
                      <small>
                        Version {board.currentVersion} ·{" "}
                        {new Date(board.updatedAt).toLocaleDateString()}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
                <button
                  onClick={() => {
                    setTitle("");
                    setModal("new");
                  }}
                >
                  <Plus size={18} />
                  Create a new board
                </button>
              </div>
            ) : modal === "new" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!title.trim()) return;
                  void b
                    .create(title.trim())
                    .then(() => setModal(null))
                    .catch((e) => setError(message(e)));
                }}
              >
                <label>
                  Board title
                  <input
                    autoFocus
                    required
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="What are we learning today?"
                  />
                </label>
                <div className="modal-actions">
                  <button
                    type="submit"
                    className="button primary"
                    disabled={b.loading}
                  >
                    Create board <Plus size={15} />
                  </button>
                </div>
              </form>
            ) : (
              <div className="shortcut-list">
                <p>
                  Select an object, draw a rectangle, or lasso several ideas.
                  Review the extracted context, then ask your question.
                </p>
                {tools.map((t) => (
                  <div key={t.id}>
                    <span>
                      <t.icon size={15} />
                      {t.label}
                    </span>
                    <kbd>{t.key}</kbd>
                  </div>
                ))}
                <div>
                  <span>Undo / redo</span>
                  <kbd>Ctrl + Z / ⇧ Z</kbd>
                </div>
                <div>
                  <span>Save board</span>
                  <kbd>Ctrl + S</kbd>
                </div>
                <p>
                  Shift + click adds objects to a selection. Double-click to
                  edit. Drawings need a transcription before AI can explain
                  them.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
