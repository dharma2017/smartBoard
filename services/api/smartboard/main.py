import asyncio
from collections import defaultdict, deque
from contextlib import asynccontextmanager
import json
import logging
import time
from uuid import UUID, uuid4
from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session as DbSession
from .auth import Actor, actor
from .config import settings
from .database import Base, Board, Interaction, Selection, Session, engine, session
from .errors import ApiError
from .models import Ask, BoardObject, CreateBoard, SaveOperations, SelectionRequest, now
from .providers import Delta, Done, PROMPT_VERSION, get_provider
from .repository import (
    board_summary,
    create_board,
    interaction_json,
    owned_board,
    owned_selection,
    save_operations,
)
from .selection import extract

logger = logging.getLogger("smartboard")


@asynccontextmanager
async def lifespan(app):
    settings.validate()
    Base.metadata.create_all(engine)
    # This slice runs one API worker; unfinished interactions remain explicitly interrupted.
    with Session() as db:
        db.execute(
            update(Interaction)
            .where(Interaction.status == "PROCESSING")
            .values(status="INTERRUPTED")
        )
        db.commit()
    yield


app = FastAPI(title="Smartboard API", version="0.1.0", lifespan=lifespan)
app.state.provider = get_provider(settings)
app.state.active = set()
app.state.rate = defaultdict(deque)


@app.middleware("http")
async def request_boundary(request: Request, call_next):
    request.state.request_id = str(uuid4())
    # Bound requests before JSON decoding, including chunked requests.
    if request.method in {"POST", "PUT", "PATCH"}:
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 2_000_000:
                return JSONResponse(
                    {
                        "error": {
                            "code": "REQUEST_TOO_LARGE",
                            "message": "Request exceeds 2 MB.",
                        }
                    },
                    status_code=413,
                )
        request._body = bytes(body)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.exception_handler(ApiError)
async def api_error(request: Request, error: ApiError):
    return JSONResponse(
        {
            "error": {
                "code": error.code,
                "message": error.message,
                "requestId": request.state.request_id,
                "details": [],
            }
        },
        status_code=error.status,
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error):
    # Do not echo raw board content, credentials or Pydantic exception objects.
    details = [
        {"field": ".".join(str(x) for x in e["loc"]), "message": e["msg"]}
        for e in error.errors()
    ]
    return JSONResponse(
        {
            "error": {
                "code": "INVALID_REQUEST",
                "message": "Check the request fields and selection geometry.",
                "requestId": request.state.request_id,
                "details": details,
            }
        },
        status_code=400,
    )


def envelope(data, request: Request):
    return {"data": data, "meta": {"requestId": request.state.request_id}}


@app.get("/api/v1/health")
def health(request: Request):
    return envelope(
        {
            "status": "ok",
            "provider": settings.provider,
            "authMode": settings.auth_mode,
            "promptVersion": PROMPT_VERSION,
        },
        request,
    )


@app.get("/api/v1/boards")
def boards(
    request: Request, who: Actor = Depends(actor), db: DbSession = Depends(session)
):
    rows = db.scalars(
        select(Board)
        .where(Board.tenant_id == who.tenant, Board.owner_id == who.user)
        .order_by(Board.updated_at.desc())
        .limit(100)
    ).all()
    return envelope([board_summary(b) for b in rows], request)


@app.post("/api/v1/boards", status_code=201)
def new_board(
    payload: CreateBoard,
    request: Request,
    who: Actor = Depends(actor),
    db: DbSession = Depends(session),
    idempotency_key: UUID = Header(alias="Idempotency-Key"),
):
    return envelope(
        board_summary(create_board(db, who, payload.title, str(idempotency_key))),
        request,
    )


@app.get("/api/v1/boards/{board_id}")
def get_board(
    board_id: UUID,
    request: Request,
    who: Actor = Depends(actor),
    db: DbSession = Depends(session),
):
    board = owned_board(db, str(board_id), who)
    latest = db.scalar(
        select(Selection)
        .where(Selection.board_id == board.id)
        .order_by(Selection.created_at.desc())
        .limit(1)
    )
    history = db.scalars(
        select(Interaction)
        .where(Interaction.board_id == board.id)
        .order_by(Interaction.created_at)
    ).all()
    return envelope(
        {
            **board_summary(board),
            "objects": board.objects,
            "latestSelection": latest.snapshot if latest else None,
            "interactions": [interaction_json(r) for r in history],
        },
        request,
    )


@app.post("/api/v1/boards/{board_id}/operations")
def operations(
    board_id: UUID,
    payload: SaveOperations,
    request: Request,
    who: Actor = Depends(actor),
    db: DbSession = Depends(session),
):
    return envelope(save_operations(db, str(board_id), who, payload), request)


@app.post("/api/v1/boards/{board_id}/selection")
def selection(
    board_id: UUID,
    payload: SelectionRequest,
    request: Request,
    who: Actor = Depends(actor),
    db: DbSession = Depends(session),
):
    board = owned_board(db, str(board_id), who)
    snapshot = extract(
        board.id,
        board.version,
        [BoardObject.model_validate(o) for o in board.objects],
        payload,
        settings,
    )
    db.add(
        Selection(
            id=snapshot["selectionId"],
            board_id=board.id,
            snapshot=snapshot,
            created_at=snapshot["createdAt"],
        )
    )
    db.commit()
    return envelope(snapshot, request)


def event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def persist_result(request_id: str, status: str, answer: str, usage: dict):
    with Session() as db:
        row = db.get(Interaction, request_id)
        row.status, row.answer, row.usage = status, answer, usage
        db.commit()


@app.post("/api/v1/ai/ask/stream")
async def ask(
    payload: Ask,
    request: Request,
    who: Actor = Depends(actor),
    db: DbSession = Depends(session),
):
    snapshot = owned_selection(
        db, str(payload.boardId), str(payload.selectionId), who
    ).snapshot
    if not snapshot["objectIds"]:
        raise ApiError(
            422, "EMPTY_SELECTION", "Select at least one object to ask a question."
        )
    if snapshot["recognitionRequired"]:
        raise ApiError(
            422,
            "RECOGNITION_REQUIRED",
            "Add a transcription to the drawing, save it, then select it again.",
        )
    identity = (who.tenant, who.user)
    if identity in app.state.active:
        raise ApiError(
            429,
            "REQUEST_IN_PROGRESS",
            "Wait for the current response or stop it before asking again.",
        )
    times = app.state.rate[identity]
    current = time.monotonic()
    while times and times[0] < current - 60:
        times.popleft()
    if len(times) >= 20:
        raise ApiError(
            429,
            "RATE_LIMIT_EXCEEDED",
            "Please wait a minute before asking more questions.",
        )
    # Claim before yielding or starting network work.
    app.state.active.add(identity)
    times.append(current)
    request_id = str(uuid4())
    history_rows = db.scalars(
        select(Interaction)
        .where(
            Interaction.board_id == str(payload.boardId),
            Interaction.selection_id == str(payload.selectionId),
            Interaction.status == "COMPLETED",
        )
        .order_by(Interaction.created_at.desc())
        .limit(6)
    ).all()
    history = [
        {"question": r.question, "answer": r.answer} for r in reversed(history_rows)
    ]
    usage = {
        "provider": settings.provider,
        "model": settings.openai_model
        if settings.provider == "openai"
        else "scripted-demo",
        "promptVersion": PROMPT_VERSION,
        "inputTokens": None,
        "outputTokens": None,
        "estimatedCostUsd": None,
    }
    try:
        db.add(
            Interaction(
                id=request_id,
                board_id=str(payload.boardId),
                selection_id=str(payload.selectionId),
                question=payload.question,
                intent=payload.intent,
                answer="",
                status="PROCESSING",
                usage=usage,
                created_at=now(),
            )
        )
        db.commit()
    except Exception:
        app.state.active.discard(identity)
        raise

    async def generate():
        answer, finished, saved_complete = "", False, False
        started, first_token = time.monotonic(), None
        try:
            yield event(
                "request_started",
                {
                    "requestId": request_id,
                    "provider": settings.provider,
                    "promptVersion": PROMPT_VERSION,
                },
            )
            async with asyncio.timeout(settings.request_timeout):
                async for item in app.state.provider.stream(
                    snapshot, payload.question, payload.intent, history
                ):
                    if await request.is_disconnected():
                        raise asyncio.CancelledError()
                    if isinstance(item, Delta):
                        if (
                            not isinstance(item.text, str)
                            or len(answer) + len(item.text) > 24000
                        ):
                            raise ValueError("Invalid provider output")
                        if first_token is None:
                            first_token = round((time.monotonic() - started) * 1000)
                        answer += item.text
                        yield event("answer_delta", {"text": item.text})
                    elif isinstance(item, Done):
                        usage.update(item.usage)
                        finished = True
            if not finished or not answer.strip():
                raise ValueError("Incomplete response")
            usage.update(
                {
                    "firstTokenMs": first_token,
                    "durationMs": round((time.monotonic() - started) * 1000),
                }
            )
            if (
                settings.input_price
                and settings.output_price
                and usage["inputTokens"] is not None
            ):
                usage["estimatedCostUsd"] = round(
                    (
                        usage["inputTokens"] * float(settings.input_price)
                        + usage["outputTokens"] * float(settings.output_price)
                    )
                    / 1_000_000,
                    8,
                )
            # Persist before the terminal event; a successful response is always recoverable.
            persist_result(request_id, "COMPLETED", answer, usage)
            saved_complete = True
            yield event("sources", {"sources": []})
            yield event(
                "completed",
                {"requestId": request_id, "status": "COMPLETED", "usage": usage},
            )
            logger.info(
                "ai_request request_id=%s status=COMPLETED provider=%s duration_ms=%s",
                request_id,
                settings.provider,
                usage["durationMs"],
            )
        except asyncio.CancelledError:
            if not saved_complete:
                persist_result(request_id, "CANCELLED", answer, usage)
            raise
        except Exception as error:
            code = (
                "AI_TIMEOUT" if isinstance(error, TimeoutError) else "AI_PROVIDER_ERROR"
            )
            persist_result(request_id, "FAILED", answer, {**usage, "errorCode": code})
            logger.warning(
                "ai_request request_id=%s status=FAILED code=%s", request_id, code
            )
            yield event(
                "error",
                {
                    "code": code,
                    "message": "The response could not be completed. Try again.",
                    "requestId": request_id,
                },
            )
        finally:
            app.state.active.discard(identity)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
