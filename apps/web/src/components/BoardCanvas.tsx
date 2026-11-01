"use client";
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Text, Line, Group } from "react-konva";
import Konva from "konva";
import type { BoardObject, Point, SelectionRequest, Tool } from "@/lib/types";
import { makeObject } from "@/lib/types";

type Props = {
  boardId: string;
  objects: BoardObject[];
  tool: Tool;
  color: string;
  selectedIds: string[];
  zoom: number;
  onZoom: (n: number) => void;
  onSelection: (r: SelectionRequest) => void;
  onChange: (objects: BoardObject[]) => void;
  onEdit: (obj: BoardObject) => void;
  onTool: (tool: Tool) => void;
};
export default function BoardCanvas(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 900, height: 700 });
  const [view, setView] = useState<Point>({ x: 0, y: 0 });
  const [gesture, setGesture] = useState<{
    start: Point;
    points: Point[];
  } | null>(null);
  const gestureRef = useRef<typeof gesture>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setView({ x: 0, y: 0 });
  }, [p.boardId]);
  const point = (): Point => {
    const s = stage.current!,
      pos = s.getPointerPosition()!;
    return { x: (pos.x - s.x()) / p.zoom, y: (pos.y - s.y()) / p.zoom };
  };
  function begin(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (p.tool === "hand") return;
    const pos = point();
    const id = e.target.findAncestor(".board-object", true)?.id();
    if (p.tool === "eraser") {
      if (id) p.onChange(p.objects.filter((o) => o.id !== id));
      return;
    }
    if (["text", "equation", "shape"].includes(p.tool)) {
      const obj = makeObject(
        p.boardId,
        p.tool === "equation"
          ? "EQUATION"
          : p.tool === "shape"
            ? "SHAPE"
            : "TEXT",
        pos.x,
        pos.y,
      );
      obj.content.color = p.color;
      if (p.tool === "shape") {
        obj.width = 220;
        obj.height = 130;
        p.onChange([...p.objects, obj]);
        p.onTool("select");
      } else p.onEdit(obj);
      return;
    }
    if (p.tool === "select" && id) {
      const ids = e.evt.shiftKey ? [...new Set([...p.selectedIds, id])] : [id];
      p.onSelection({ selectionType: "OBJECT", objectIds: ids });
      return;
    }
    const next = { start: pos, points: [pos] };
    gestureRef.current = next;
    setGesture(next);
  }
  function move() {
    const g = gestureRef.current;
    if (!g) return;
    const pos = point();
    if (p.tool === "lasso" || p.tool === "pen") {
      const last = g.points[g.points.length - 1];
      if (Math.hypot(pos.x - last.x, pos.y - last.y) < 4) return;
      if (g.points.length >= (p.tool === "lasso" ? 250 : 2000)) return;
      const next = { ...g, points: [...g.points, pos] };
      gestureRef.current = next;
      setGesture(next);
    } else {
      const next = { ...g, points: [g.start, pos] };
      gestureRef.current = next;
      setGesture(next);
    }
  }
  function end() {
    const g = gestureRef.current;
    if (!g) return;
    gestureRef.current = null;
    setGesture(null);
    const end = point();
    const x = Math.min(g.start.x, end.x),
      y = Math.min(g.start.y, end.y),
      width = Math.abs(end.x - g.start.x),
      height = Math.abs(end.y - g.start.y);
    if (p.tool === "pen") {
      if (g.points.length < 2) return;
      const xs = g.points.map((v) => v.x),
        ys = g.points.map((v) => v.y);
      const minX = Math.min(...xs),
        minY = Math.min(...ys);
      const obj = makeObject(p.boardId, "STROKE", minX, minY);
      obj.width = Math.max(1, Math.max(...xs) - minX);
      obj.height = Math.max(1, Math.max(...ys) - minY);
      obj.content.points = g.points.flatMap((v) => [v.x - minX, v.y - minY]);
      obj.content.color = p.color;
      p.onChange([...p.objects, obj]);
    } else if (p.tool === "lasso" && g.points.length >= 3)
      p.onSelection({ selectionType: "LASSO", polygon: g.points });
    else if (width > 3 && height > 3)
      p.onSelection({
        selectionType: "RECTANGLE",
        bounds: { x, y, width, height },
      });
  }
  return (
    <div
      ref={host}
      className={`canvas-host tool-${p.tool}`}
      data-testid="canvas-host"
    >
      <Stage
        ref={stage}
        width={size.width}
        height={size.height}
        x={view.x}
        y={view.y}
        scaleX={p.zoom}
        scaleY={p.zoom}
        draggable={p.tool === "hand"}
        onMouseDown={begin}
        onTouchStart={begin}
        onMouseMove={move}
        onTouchMove={move}
        onMouseUp={end}
        onTouchEnd={end}
        onDragEnd={(e) => {
          if (e.target === stage.current)
            setView({ x: e.target.x(), y: e.target.y() });
        }}
        onWheel={(e) => {
          e.evt.preventDefault();
          const s = stage.current!,
            pointer = s.getPointerPosition()!;
          const world = point();
          const scale = Math.max(
            0.4,
            Math.min(2, p.zoom * (e.evt.deltaY < 0 ? 1.07 : 1 / 1.07)),
          );
          setView({
            x: pointer.x - world.x * scale,
            y: pointer.y - world.y * scale,
          });
          p.onZoom(scale);
        }}
      >
        <Layer>
          {p.objects.map((obj) => (
            <Group
              key={obj.id}
              id={obj.id}
              name="board-object"
              x={obj.x}
              y={obj.y}
              draggable={p.tool === "select"}
              onDblClick={() => p.onEdit(obj)}
              onDblTap={() => p.onEdit(obj)}
              onDragEnd={(e) => {
                if (e.target.id() !== obj.id) return;
                p.onChange(
                  p.objects.map((o) =>
                    o.id === obj.id
                      ? { ...o, x: e.target.x(), y: e.target.y() }
                      : o,
                  ),
                );
              }}
            >
              <Rect
                width={obj.width}
                height={obj.height}
                fill="rgba(0,0,0,0.001)"
              />
              {obj.type === "STROKE" ? (
                <Line
                  points={obj.content.points}
                  stroke={obj.content.color}
                  strokeWidth={obj.content.strokeWidth}
                  lineCap="round"
                  lineJoin="round"
                  hitStrokeWidth={16}
                />
              ) : obj.type === "SHAPE" ? (
                <>
                  <Rect
                    width={obj.width}
                    height={obj.height}
                    stroke={obj.content.color}
                    strokeWidth={2}
                    cornerRadius={8}
                  />
                  <Text
                    text={obj.content.text}
                    padding={16}
                    width={obj.width}
                    height={obj.height}
                    fill={obj.content.color}
                    fontSize={obj.content.fontSize}
                  />
                </>
              ) : (
                <Text
                  text={obj.content.text}
                  width={obj.width}
                  height={obj.height}
                  fontSize={obj.content.fontSize}
                  fill={obj.content.color}
                  lineHeight={1.45}
                  fontFamily={
                    obj.type === "EQUATION"
                      ? "Georgia, serif"
                      : "Trebuchet MS, sans-serif"
                  }
                  fontStyle={obj.type === "EQUATION" ? "italic" : "normal"}
                />
              )}
              {p.selectedIds.includes(obj.id) && (
                <Rect
                  x={-12}
                  y={-12}
                  width={obj.width + 24}
                  height={obj.height + 24}
                  stroke="#c9ec9c"
                  strokeWidth={1.5 / p.zoom}
                  dash={[6 / p.zoom, 4 / p.zoom]}
                  cornerRadius={8}
                  fill="rgba(201,236,156,0.05)"
                  listening={false}
                />
              )}
            </Group>
          ))}
          {gesture && (p.tool === "pen" || p.tool === "lasso") && (
            <Line
              points={gesture.points.flatMap((v) => [v.x, v.y])}
              stroke={p.tool === "pen" ? p.color : "#c9ec9c"}
              strokeWidth={p.tool === "pen" ? 3 : 1.5 / p.zoom}
              dash={p.tool === "lasso" ? [6, 4] : undefined}
              fill={p.tool === "lasso" ? "rgba(201,236,156,.08)" : undefined}
              closed={p.tool === "lasso"}
              listening={false}
            />
          )}
          {gesture && (p.tool === "rectangle" || p.tool === "select") && (
            <Rect
              x={Math.min(gesture.start.x, gesture.points.at(-1)!.x)}
              y={Math.min(gesture.start.y, gesture.points.at(-1)!.y)}
              width={Math.abs(gesture.start.x - gesture.points.at(-1)!.x)}
              height={Math.abs(gesture.start.y - gesture.points.at(-1)!.y)}
              fill="rgba(201,236,156,.1)"
              stroke="#c9ec9c"
              strokeWidth={1.5 / p.zoom}
              dash={[6, 4]}
              listening={false}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
