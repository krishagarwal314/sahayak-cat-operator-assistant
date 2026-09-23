"""Request and response models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., examples=["OP1001"])
    password: str = Field(..., examples=["cat1234"])


class LoginResponse(BaseModel):
    token: str
    token_type: str = "bearer"
    expires_in: int
    operator: dict


class SelectMachineRequest(BaseModel):
    machine_id: str


class TaskStatusRequest(BaseModel):
    status: str = Field(..., pattern="^(pending|in_progress|done|blocked)$")


class AskRequest(BaseModel):
    machine_id: str
    text: str | None = None
    intent: str | None = None
    language: str = "hi"
    speak: bool = False


class SpeakRequest(BaseModel):
    text: str
    language: str = "hi"


class TranslateRequest(BaseModel):
    text: str
    source: str = "en"
    target: str = "hi"


class IncidentRequest(BaseModel):
    machine_id: str
    description: str
    category: str = "near_miss"
    severity: str = "medium"
    language: str = "hi"


class SeatbeltRequest(BaseModel):
    machine_id: str
    fastened: bool


class BookingRequest(BaseModel):
    instructor_id: str
    slot: str
    module_id: str | None = None
