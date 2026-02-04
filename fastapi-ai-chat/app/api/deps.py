from typing import Annotated

from fastapi import Depends

from app.core.config import settings
from app.services.ai_service import AIService
from app.services.rag_service import RAGService
from app.services.websocket_manager import WebSocketManager


def get_settings():
    return settings


def get_ai_service() -> AIService:
    return AIService(settings=settings)


def get_rag_service() -> RAGService:
    return RAGService()


def get_ws_manager() -> WebSocketManager:
    return WebSocketManager.instance()


SettingsDep = Annotated[settings.__class__, Depends(get_settings)]
AIServiceDep = Annotated[AIService, Depends(get_ai_service)]
RAGServiceDep = Annotated[RAGService, Depends(get_rag_service)]
WSManagerDep = Annotated[WebSocketManager, Depends(get_ws_manager)]