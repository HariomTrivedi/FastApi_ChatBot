from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.db.models import User
from app.services.websocket_manager import WebSocketManager

router = APIRouter()

SIGNAL_TYPES = {"offer", "answer", "ice", "busy"}


class CallTarget(BaseModel):
    to_user_id: int = Field(..., ge=1)
    call_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class CallSignal(BaseModel):
    to_user_id: int = Field(..., ge=1)
    type: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    call_id: Optional[str] = None


def _ws_manager() -> WebSocketManager:
    return WebSocketManager.instance()


async def _send_ws_event(
    ws_manager: WebSocketManager,
    to_user_id: int,
    event_type: str,
    payload: Dict[str, Any],
):
    await ws_manager.send_to_user(
        to_user_id,
        {
            "type": event_type,
            "data": payload,
        },
    )


@router.post("/start", status_code=status.HTTP_200_OK)
async def start_call(
    body: CallTarget,
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(_ws_manager),
):
    await _send_ws_event(
        ws_manager,
        body.to_user_id,
        "call_start",
        {
            "from_user_id": current_user.id,
            "call_id": body.call_id,
            "metadata": body.metadata or {},
        },
    )
    return {"ok": True}


@router.post("/accept", status_code=status.HTTP_200_OK)
async def accept_call(
    body: CallTarget,
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(_ws_manager),
):
    await _send_ws_event(
        ws_manager,
        body.to_user_id,
        "call_accept",
        {
            "from_user_id": current_user.id,
            "call_id": body.call_id,
        },
    )
    return {"ok": True}


@router.post("/decline", status_code=status.HTTP_200_OK)
async def decline_call(
    body: CallTarget,
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(_ws_manager),
):
    await _send_ws_event(
        ws_manager,
        body.to_user_id,
        "call_decline",
        {
            "from_user_id": current_user.id,
            "call_id": body.call_id,
        },
    )
    return {"ok": True}


@router.post("/end", status_code=status.HTTP_200_OK)
async def end_call(
    body: CallTarget,
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(_ws_manager),
):
    await _send_ws_event(
        ws_manager,
        body.to_user_id,
        "call_end",
        {
            "from_user_id": current_user.id,
            "call_id": body.call_id,
        },
    )
    return {"ok": True}


@router.post("/signal", status_code=status.HTTP_200_OK)
async def send_signal(
    body: CallSignal,
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(_ws_manager),
):
    if body.type not in SIGNAL_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid signal type. Allowed: {', '.join(sorted(SIGNAL_TYPES))}",
        )

    payload = {
        **body.payload,
        "from_user_id": current_user.id,
        "call_id": body.call_id,
    }

    await _send_ws_event(ws_manager, body.to_user_id, body.type, payload)
    return {"ok": True}
