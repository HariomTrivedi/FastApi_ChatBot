from fastapi import FastAPI

from app.core.logger import setup_logging, logger
from app.db.database import init_db


def register_startup_shutdown(app: FastAPI):
    @app.on_event("startup")
    async def startup_event():
        setup_logging()
        init_db()  # Initialize database tables
        logger.info("Application startup complete")

    @app.on_event("shutdown")
    async def shutdown_event():
        logger.info("Application shutdown")

