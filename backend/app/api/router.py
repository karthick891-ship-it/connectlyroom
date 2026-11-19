from fastapi import APIRouter

from app.api import auth, conversations, uploads, users

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(conversations.router)
api_router.include_router(uploads.router)


@api_router.get("/health", tags=["meta"])
async def health():
    return {"status": "ok"}
