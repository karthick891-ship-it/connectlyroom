"""Cached membership lookups, used on every WebSocket event."""
import json

from sqlalchemy import select

from app.core.redis import redis
from app.db.session import SessionLocal
from app.models import ConversationMember

TTL_SECONDS = 60


async def member_ids(conversation_id: int) -> list[int]:
    key = f"members:{conversation_id}"
    cached = await redis.get(key)
    if cached:
        return json.loads(cached)
    async with SessionLocal() as db:
        rows = await db.scalars(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.left_at.is_(None),
            )
        )
        ids = list(rows.all())
    if ids:
        await redis.set(key, json.dumps(ids), ex=TTL_SECONDS)
    return ids


async def invalidate(conversation_id: int) -> None:
    await redis.delete(f"members:{conversation_id}")
