import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.core.security import decode_access_token
from app.services import presence
from app.ws.handlers import handle_event
from app.ws.manager import manager

router = APIRouter()
MAX_FRAME_CHARS = 20_000


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = ""):
    # Accept first so we can send application-level close codes the browser can read.
    await ws.accept()
    origin = ws.headers.get("origin")
    if origin and origin not in settings.cors_origin_list:
        await ws.close(code=4403)
        return
    user_id = decode_access_token(token)
    if user_id is None:
        await ws.close(code=4401)
        return

    manager.add(user_id, ws)
    await presence.on_connect(user_id)
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > MAX_FRAME_CHARS:
                continue
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            if isinstance(data, dict):
                await handle_event(user_id, data, ws)
    except WebSocketDisconnect:
        pass
    finally:
        manager.remove(user_id, ws)
        await presence.on_disconnect(user_id)
