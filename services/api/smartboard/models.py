from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator
import math


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


Coordinate = Annotated[float, Field(ge=-10000, le=10000)]
Dimension = Annotated[float, Field(gt=0, le=10000)]


class Point(StrictModel):
    x: Coordinate
    y: Coordinate


class Bounds(Point):
    width: Dimension
    height: Dimension


class Content(StrictModel):
    text: str = Field(default="", max_length=4000)
    role: Literal["heading", "body", "caption"] = "body"
    color: str = Field(default="#dce8dc", pattern=r"^#[0-9a-fA-F]{6}$")
    fontSize: int = Field(default=24, ge=12, le=64)
    points: list[float] = Field(default_factory=list, max_length=4096)
    strokeWidth: float = Field(default=3, ge=1, le=12)

    @model_validator(mode="after")
    def finite_points(self):
        if len(self.points) % 2 or any(
            not math.isfinite(n) or abs(n) > 10000 for n in self.points
        ):
            raise ValueError("Stroke points must be finite x/y pairs")
        return self


class BoardObject(Bounds):
    id: UUID
    boardId: UUID
    type: Literal["TEXT", "EQUATION", "STROKE", "SHAPE"]
    rotation: Literal[0] = 0
    zIndex: int = Field(default=0, ge=0, le=10000)
    version: int = Field(default=1, ge=1)
    content: Content

    @model_validator(mode="after")
    def supported_content(self):
        if self.type in {"TEXT", "EQUATION"} and not self.content.text.strip():
            raise ValueError("Text and equations must contain text")
        if self.type == "STROKE" and len(self.content.points) < 4:
            raise ValueError("A stroke needs at least two points")
        return self


class CreateBoard(StrictModel):
    title: str = Field(min_length=1, max_length=200)


class Operation(StrictModel):
    operationId: UUID
    type: Literal["OBJECT_CREATE", "OBJECT_UPDATE", "OBJECT_DELETE"]
    object: BoardObject | None = None
    objectId: UUID | None = None

    @model_validator(mode="after")
    def fields_match_type(self):
        if self.type == "OBJECT_DELETE" and not self.objectId:
            raise ValueError("Deletion requires objectId")
        if self.type != "OBJECT_DELETE" and not self.object:
            raise ValueError("Creation and update require an object")
        return self


class SaveOperations(StrictModel):
    baseVersion: int = Field(ge=1)
    operations: list[Operation] = Field(min_length=1, max_length=500)


class SelectionRequest(StrictModel):
    selectionType: Literal["OBJECT", "RECTANGLE", "LASSO"]
    objectIds: list[UUID] = Field(default_factory=list, max_length=100)
    bounds: Bounds | None = None
    polygon: list[Point] = Field(default_factory=list, max_length=256)
    includeSurroundingContext: bool = True

    @model_validator(mode="after")
    def validate_geometry(self):
        if self.selectionType == "OBJECT" and not self.objectIds:
            raise ValueError("Choose at least one object")
        if self.selectionType == "RECTANGLE" and not self.bounds:
            raise ValueError("A rectangle requires bounds")
        if self.selectionType == "LASSO":
            if len(self.polygon) < 3:
                raise ValueError("A lasso needs at least three points")
            p = self.polygon
            area = sum(a.x * b.y - b.x * a.y for a, b in zip(p, p[1:] + p[:1])) / 2
            if abs(area) < 1:
                raise ValueError("A lasso must enclose a nonzero area")
        return self


class Ask(StrictModel):
    boardId: UUID
    selectionId: UUID
    question: str = Field(min_length=1, max_length=2000)
    intent: Literal["EXPLAIN", "SUMMARIZE", "GENERATE_EXAMPLES"] = "EXPLAIN"

    @model_validator(mode="after")
    def nonempty(self):
        if not self.question.strip():
            raise ValueError("A question is required")
        return self
