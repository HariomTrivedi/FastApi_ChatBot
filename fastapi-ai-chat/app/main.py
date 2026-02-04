from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import auth, chat, documents, friends, messages
from app.core.config import settings
from app.events import register_startup_shutdown


def create_app() -> FastAPI:
    app = FastAPI(title="fastapi-ai-chat", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allow_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )

    app.include_router(auth.router, prefix="/auth", tags=["authentication"])
    app.include_router(chat.router, prefix="/chat", tags=["chat"])
    app.include_router(documents.router, prefix="/documents", tags=["documents"])
    app.include_router(friends.router, prefix="/friends", tags=["friends"])
    app.include_router(messages.router, prefix="/messages", tags=["messages"])

    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

    register_startup_shutdown(app)
    return app


app = create_app()

