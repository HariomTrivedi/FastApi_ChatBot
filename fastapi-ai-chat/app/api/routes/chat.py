from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends

from app.api.deps import AIServiceDep, WSManagerDep
from app.core.security import get_current_user_ws
from app.schemas.chat import ChatMessage

router = APIRouter()

CALL_SIGNAL_TYPES = {
    "call_start",
    "call_accept",
    "call_decline",
    "offer",
    "answer",
    "ice",
    "call_end",
}


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    ai_service: AIServiceDep,
    manager: WSManagerDep,
    current_user = Depends(get_current_user_ws),
):
    await manager.connect(websocket, current_user.id)
    try:
        while True:
            data = await websocket.receive_json()
            if isinstance(data, dict) and "type" in data:
                msg_type = data.get("type")
                if msg_type in CALL_SIGNAL_TYPES:
                    to_user_id = (
                        data.get("to_user_id")
                        or data.get("target_user_id")
                        or data.get("user_id")
                    )
                    if not to_user_id:
                        await manager.send_personal_message(
                            {
                                "type": "error",
                                "data": {
                                    "message": "Missing to_user_id for signaling message",
                                    "original_type": msg_type,
                                },
                            },
                            websocket,
                        )
                        continue

                    payload = data.get("data") or data.get("payload") or {}
                    await manager.send_to_user(
                        int(to_user_id),
                        {
                            "type": msg_type,
                            "data": {
                                **payload,
                                "from_user_id": current_user.id,
                            },
                        },
                    )
                    continue

                # Unknown message types can be ignored or handled later
                await manager.send_personal_message(
                    {
                        "type": "error",
                        "data": {
                            "message": "Unknown message type",
                            "original_type": msg_type,
                        },
                    },
                    websocket,
                )
                continue

            # Fallback to AI chat streaming when no explicit type is provided
            message = ChatMessage(**data)
            stream = ai_service.ai_stream_response(message)
            async for chunk in stream:
                await manager.send_personal_message({"type": "token", "data": chunk}, websocket)
            await manager.send_personal_message({"type": "done"}, websocket)
    except WebSocketDisconnect:
        # Handle normal WebSocket disconnection gracefully
        pass
    except Exception as e:
        # Log unexpected errors but don't crash
        print(f"WebSocket error for user {current_user.id}: {e}")
    finally:
        # Always ensure proper cleanup
        try:
            await manager.disconnect(websocket)
        except Exception as e:
            print(f"Error during WebSocket cleanup for user {current_user.id}: {e}")


@router.post("/sync", response_model=ChatMessage)
async def chat_sync(message: ChatMessage, ai_service: AIServiceDep):
    reply = await ai_service.generate(message)
    return ChatMessage(role="assistant", content=reply)
