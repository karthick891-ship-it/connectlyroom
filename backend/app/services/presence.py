"""Presence via a per-user connection counter in Redis (works across instances).

`conn:{user_id}` is incremented on connect and decremented on disconnect. It carries a TTL
that client heartbeats refresh, so a crashed instance cannot leave a user online forever.
"""
from sqlalchemy import text

from app.core.redis import redis
from app.db.session import SessionLocal
from app.ws.manager import manager

TTL_SECONDS = 90


def _key(user_id: int) -> str:
    return f"conn:{user_id}"


async def contacts(user_id: int) -> list[int]:
    async with SessionLocal() as db:
        rows = await db.execute(
            text(
                """SELECT DISTINCT cm2.user_id
                   FROM conversation_members cm1
                   JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
                   WHERE cm1.user_id = :uid AND cm2.user_id <> :uid
                     AND cm1.left_at IS NULL AND cm2.left_at IS NULL"""
            ),
            {"uid": user_id},
        )
        return [r[0] for r in rows]


async def announce(user_id: int, status: str) -> None:
    ids = await contacts(user_id)
    if ids:
        await manager.publish(ids, {"type": "presence.update", "user_id": user_id, "status": status})


async def on_connect(user_id: int) -> None:
    count = await redis.incr(_key(user_id))
    await redis.expire(_key(user_id), TTL_SECONDS)
    if count == 1:
        await announce(user_id, "online")


async def on_disconnect(user_id: int) -> None:
    count = await redis.decr(_key(user_id))
    if count <= 0:
        await redis.delete(_key(user_id))
        await announce(user_id, "offline")


async def heartbeat(user_id: int) -> None:
    if not await redis.expire(_key(user_id), TTL_SECONDS):
        await redis.set(_key(user_id), 1, ex=TTL_SECONDS)


async def online_ids(user_ids: list[int]) -> list[int]:
    if not user_ids:
        return []
    values = await redis.mget([_key(i) for i in user_ids])
    return [i for i, v in zip(user_ids, values) if v and int(v) > 0]
