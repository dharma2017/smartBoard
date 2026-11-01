import hashlib
import json
from uuid import uuid4
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .auth import Actor
from .config import settings
from .database import Board, BoardOperation, Interaction, Selection
from .errors import ApiError
from .models import BoardObject, SaveOperations, now


def owned_board(db: Session, board_id: str, actor: Actor) -> Board:
    board = db.get(Board, board_id)
    if not board:
        raise ApiError(404, "BOARD_NOT_FOUND", "This board could not be found.")
    if board.tenant_id != actor.tenant or board.owner_id != actor.user:
        raise ApiError(403, "ACCESS_DENIED", "You do not have access to this board.")
    return board


def board_summary(board: Board) -> dict:
    return {
        "boardId": board.id,
        "title": board.title,
        "currentVersion": board.version,
        "updatedAt": board.updated_at,
    }


def create_board(db: Session, actor: Actor, title: str, key: str) -> Board:
    if not title.strip():
        raise ApiError(422, "VALIDATION_FAILED", "Give the board a title.")
    query = select(Board).where(
        Board.tenant_id == actor.tenant,
        Board.owner_id == actor.user,
        Board.creation_key == key,
    )
    existing = db.scalar(query)
    if existing:
        if existing.title != title.strip():
            raise ApiError(
                409,
                "IDEMPOTENCY_CONFLICT",
                "This creation key was already used for a different board.",
            )
        return existing
    board = Board(
        id=str(uuid4()),
        tenant_id=actor.tenant,
        owner_id=actor.user,
        creation_key=key,
        title=title.strip(),
        version=1,
        objects=[],
        updated_at=now(),
    )
    db.add(board)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(query)
        if not existing or existing.title != title.strip():
            raise ApiError(
                409, "IDEMPOTENCY_CONFLICT", "This creation key is already in use."
            ) from None
        return existing
    return board


def save_operations(
    db: Session, board_id: str, actor: Actor, payload: SaveOperations
) -> dict:
    board = owned_board(db, board_id, actor)
    pending, seen = [], set()
    for op in payload.operations:
        key = str(op.operationId)
        if key in seen:
            raise ApiError(
                422, "VALIDATION_FAILED", "Operation IDs must be unique within a batch."
            )
        seen.add(key)
        digest = hashlib.sha256(
            json.dumps(op.model_dump(mode="json"), sort_keys=True).encode()
        ).hexdigest()
        old = db.get(BoardOperation, (board_id, key))
        if old and old.payload_hash != digest:
            raise ApiError(
                409,
                "IDEMPOTENCY_CONFLICT",
                "An operation ID was reused with different content.",
            )
        if not old:
            pending.append((op, digest))
    if not pending:
        return {**board_summary(board), "savedOperations": 0, "objects": board.objects}
    if board.version != payload.baseVersion:
        raise ApiError(
            409,
            "VERSION_CONFLICT",
            "This board changed in another session. Reload the saved board before editing.",
        )
    objects = {o["id"]: dict(o) for o in board.objects}
    for op, digest in pending:
        obj = op.object
        key = str(op.objectId if op.type == "OBJECT_DELETE" else obj.id)
        if op.type == "OBJECT_DELETE":
            if key not in objects:
                raise ApiError(
                    422,
                    "OBJECT_NOT_FOUND",
                    "The object being deleted no longer exists.",
                )
            del objects[key]
        else:
            if str(obj.boardId) != board_id:
                raise ApiError(
                    422, "INVALID_OBJECT", "Objects must belong to the target board."
                )
            if op.type == "OBJECT_CREATE" and key in objects:
                raise ApiError(409, "OBJECT_EXISTS", "This object already exists.")
            if op.type == "OBJECT_UPDATE" and key not in objects:
                raise ApiError(
                    422, "OBJECT_NOT_FOUND", "The object being edited no longer exists."
                )
            value = obj.model_dump(mode="json")
            value["version"] = objects[key]["version"] + 1 if key in objects else 1
            objects[key] = value
    if len(objects) > settings.max_objects:
        raise ApiError(
            422,
            "BOARD_LIMIT",
            f"This slice supports {settings.max_objects} objects per board.",
        )
    updated_at = now()
    # Compare-and-swap protects the whole batch, including operation receipts.
    result = db.execute(
        update(Board)
        .where(Board.id == board_id, Board.version == payload.baseVersion)
        .values(
            version=payload.baseVersion + 1,
            objects=list(objects.values()),
            updated_at=updated_at,
        )
    )
    if result.rowcount != 1:
        db.rollback()
        raise ApiError(
            409, "VERSION_CONFLICT", "The saved board changed. Reload before editing."
        )
    for op, digest in pending:
        db.add(
            BoardOperation(
                board_id=board_id, operation_id=str(op.operationId), payload_hash=digest
            )
        )
    db.commit()
    db.refresh(board)
    return {
        **board_summary(board),
        "savedOperations": len(pending),
        "objects": board.objects,
    }


def owned_selection(
    db: Session, board_id: str, selection_id: str, actor: Actor
) -> Selection:
    owned_board(db, board_id, actor)
    selection = db.get(Selection, selection_id)
    if not selection or selection.board_id != board_id:
        raise ApiError(
            404, "SELECTION_NOT_FOUND", "Select some content on this board first."
        )
    return selection


def interaction_json(row: Interaction) -> dict:
    # A server restart must not turn an interrupted generation into a successful answer.
    return {
        "requestId": row.id,
        "selectionId": row.selection_id,
        "question": row.question,
        "intent": row.intent,
        "answer": row.answer,
        "status": row.status,
        "usage": row.usage,
        "createdAt": row.created_at,
    }
