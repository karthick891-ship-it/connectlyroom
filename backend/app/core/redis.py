from redis.asyncio import Redis

from app.core.config import settings

redis: Redis = Redis.from_url(settings.redis_url, decode_responses=True)


async def rate_limit_ok(key: str, limit: int, window_seconds: int) -> bool:
    """Fixed-window counter. Returns False once `limit` is exceeded in the window."""
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, window_seconds)
    return count <= limit
