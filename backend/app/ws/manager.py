"""WebSocket connection manager with Redis pub/sub fan-out.

Every backend instance subscribes to one channel. Events are published with a list of
target user ids; each instance delivers to the sockets it holds locally. This keeps
delivery correct with any number of instances behind a load balancer.
"""
import asyncio
import json
import logging
from collections import defaultdict
from typing import Iterable

from fastapi import WebSocket

from app.core.redis import redis

logger = logging.getLogger("connectly.ws")
CHANNEL = "connectly:events"


class ConnectionManager:
    def __init__(self) -> None:
        self.local: dict[int, set[WebSocket]] = defaultdict(set)

    def add(self, user_id: int, ws: WebSocket) -> None:
        self.local[user_id].add(ws)

    def remove(self, user_id: int, ws: WebSocket) -> None:
        sockets = self.local.get(user_id)
        if sockets:
            sockets.discard(ws)
            if not sockets:
                self.local.pop(user_id, None)

    async def send_local(self, user_ids: Iterable[int], event: dict) -> None:
        payload = json.dumps(event)
        for uid in set(user_ids):
            for ws in list(self.local.get(uid, ())):
                try:
                    await ws.send_text(payload)
                except Exception:  # socket is dying; its receive loop will clean up
                    logger.debug("send failed for user %s", uid)

    async def publish(self, user_ids: Iterable[int], event: dict) -> None:
        await redis.publish(CHANNEL, json.dumps({"targets": sorted(set(user_ids)), "event": event}))

    async def listen(self) -> None:
        """Run as a background task for the lifetime of the app."""
        while True:
            pubsub = redis.pubsub()
            try:
                await pubsub.subscribe(CHANNEL)
                async for item in pubsub.listen():
                    if item.get("type") != "message":
                        continue
                    try:
                        data = json.loads(item["data"])
                        await self.send_local(data["targets"], data["event"])
                    except Exception:
                        logger.exception("bad pubsub payload")
            except asyncio.CancelledError:
                await pubsub.aclose()
                raise
            except Exception:
                logger.exception("pubsub connection lost, retrying in 1s")
                await asyncio.sleep(1)


manager = ConnectionManager()
