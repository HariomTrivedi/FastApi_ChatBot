from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends

from app.api.deps import AIServiceDep, WSManagerDep
from app.core.security import get_current_user_ws
from app.schemas.chat import ChatMessage

router = APIRouter()


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

