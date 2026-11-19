import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import app.models  # noqa: F401  (registers tables on Base.metadata)
from app.api.router import api_router
from app.core.config import settings
from app.core.redis import redis
from app.db.base import Base
from app.db.session import engine
from app.ws.manager import manager
from app.ws.router import router as ws_router

logging.basicConfig(level=logging.INFO)
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.auto_create_tables:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    listener = asyncio.create_task(manager.listen())
    yield
    listener.cancel()
    try:
        await listener
    except asyncio.CancelledError:
        pass
    await redis.aclose()
    await engine.dispose()


app = FastAPI(title="Connectly", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_sniff_for_uploads(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/files/"):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
    return response


app.include_router(api_router)
app.include_router(ws_router)
app.mount("/files", StaticFiles(directory=settings.upload_dir), name="files")
