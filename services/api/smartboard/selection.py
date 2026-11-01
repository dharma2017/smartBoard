from uuid import uuid4
from .config import Settings
from .errors import ApiError
from .models import BoardObject, Bounds, Point, SelectionRequest, now


def intersects(a: Bounds, b: Bounds) -> bool:
    return (
        a.x <= b.x + b.width
        and a.x + a.width >= b.x
        and a.y <= b.y + b.height
        and a.y + a.height >= b.y
    )


def orient(a: Point, b: Point, c: Point) -> float:
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)


def on_segment(a: Point, b: Point, p: Point) -> bool:
    return (
        abs(orient(a, b, p)) < 1e-8
        and min(a.x, b.x) - 1e-8 <= p.x <= max(a.x, b.x) + 1e-8
        and min(a.y, b.y) - 1e-8 <= p.y <= max(a.y, b.y) + 1e-8
    )


def crosses(a: Point, b: Point, c: Point, d: Point) -> bool:
    return (
        (
            orient(a, b, c) * orient(a, b, d) < 0
            and orient(c, d, a) * orient(c, d, b) < 0
        )
        or on_segment(a, b, c)
        or on_segment(a, b, d)
        or on_segment(c, d, a)
        or on_segment(c, d, b)
    )


def inside(polygon: list[Point], p: Point) -> bool:
    inside_polygon = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if on_segment(a, b, p):
            return True
        if (a.y > p.y) != (b.y > p.y) and p.x < (b.x - a.x) * (p.y - a.y) / (
            b.y - a.y
        ) + a.x:
            inside_polygon = not inside_polygon
    return inside_polygon


def polygon_intersects(polygon: list[Point], bounds: Bounds) -> bool:
    x, y, w, h = bounds.x, bounds.y, bounds.width, bounds.height
    corners = [
        Point(x=x, y=y),
        Point(x=x + w, y=y),
        Point(x=x + w, y=y + h),
        Point(x=x, y=y + h),
    ]
    return (
        any(inside(polygon, p) for p in corners)
        or any(x <= p.x <= x + w and y <= p.y <= y + h for p in polygon)
        or any(
            crosses(a, b, c, d)
            for a, b in zip(polygon, polygon[1:] + polygon[:1])
            for c, d in zip(corners, corners[1:] + corners[:1])
        )
    )


def extracted(obj: BoardObject) -> dict:
    return {
        "id": str(obj.id),
        "type": obj.type,
        "content": obj.content.text,
        "recognitionRequired": obj.type in {"STROKE", "SHAPE"}
        and not obj.content.text.strip(),
    }


def extract(
    board_id: str,
    version: int,
    objects: list[BoardObject],
    request: SelectionRequest,
    config: Settings,
) -> dict:
    if request.selectionType == "OBJECT":
        ids = {str(i) for i in request.objectIds}
        selected = [o for o in objects if str(o.id) in ids]
        if len(selected) != len(ids):
            raise ApiError(
                422,
                "SELECTION_STALE",
                "Some objects no longer exist. Select the content again.",
            )
    elif request.selectionType == "RECTANGLE":
        selected = [o for o in objects if intersects(o, request.bounds)]
    else:
        selected = [o for o in objects if polygon_intersects(request.polygon, o)]
    selected.sort(key=lambda o: (o.y, o.x, o.zIndex))
    ids = {o.id for o in selected}
    surrounding = {}
    if request.includeSurroundingContext:
        for obj in selected:
            headings = [
                o
                for o in objects
                if o.id not in ids
                and o.type == "TEXT"
                and o.content.role == "heading"
                and o.y + o.height <= obj.y
                and obj.y - o.y - o.height <= 180
                and o.x <= obj.x + obj.width
                and o.x + o.width >= obj.x
            ]
            if headings:
                heading = max(headings, key=lambda o: o.y)
                surrounding[heading.id] = heading
    if len(selected) + len(surrounding) > config.max_selection_objects:
        raise ApiError(
            422,
            "CONTEXT_LIMIT",
            f"Select at most {config.max_selection_objects} objects including headings.",
        )
    content = [extracted(o) for o in selected]
    nearby = [
        extracted(o) for o in sorted(surrounding.values(), key=lambda o: (o.y, o.x))
    ]
    if sum(len(o["content"]) for o in content + nearby) > config.max_context_chars:
        raise ApiError(
            422,
            "CONTEXT_LIMIT",
            f"Select less than {config.max_context_chars} characters of context.",
        )
    return {
        "selectionId": str(uuid4()),
        "boardId": board_id,
        "boardVersion": version,
        "selectionType": request.selectionType,
        "objectIds": [str(o.id) for o in selected],
        "extractedContent": content,
        "surroundingContext": nearby,
        "recognitionRequired": any(o["recognitionRequired"] for o in content),
        "createdAt": now(),
    }
