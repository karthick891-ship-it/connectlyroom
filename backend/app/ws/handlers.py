import logging

from fastapi import WebSocket

from app.core.config import settings
from app.core.redis import rate_limit_ok
from app.db.session import SessionLocal
from app.services import chat, membership, presence
from app.ws.manager import manager

logger = logging.getLogger("connectly.ws")


async def _error(ws: WebSocket, code: str, message: str, client_id: str | None = None) -> None:
    await ws.send_json({"type": "error", "code": code, "message": message, "client_id": client_id})


async def _members_for(ws: WebSocket, user_id: int, data: dict, client_id: str | None = None) -> tuple[int, list[int]] | None:
    """Validates conversation_id and that the sender belongs to it (checked on every event)."""
    cid = data.get("conversation_id")
    if not isinstance(cid, int):
        await _error(ws, "bad_request", "conversation_id is required", client_id)
        return None
    members = await membership.member_ids(cid)
    if user_id not in members:
        await _error(ws, "forbidden", "You are not a member of this conversation", client_id)
        return None
    return cid, members


async def on_send(user_id: int, data: dict, ws: WebSocket) -> None:
    client_id = data.get("client_id") if isinstance(data.get("client_id"), str) else None
    try:
        kind, content, attachment = chat.validate_payload(data)
    except ValueError as e:
        return await _error(ws, "bad_request", str(e), client_id)
    if not await rate_limit_ok(f"rl:msg:{user_id}", settings.rate_limit_messages_per_10s, 10):
        return await _error(ws, "rate_limited", "You are sending messages too quickly", client_id)
    checked = await _members_for(ws, user_id, data, client_id)
    if not checked:
        return
    cid, members = checked

    async with SessionLocal() as db:
        msg, created = await chat.save_message(db, cid, user_id, client_id, kind, content, attachment)
        payload = await chat.message_payload(db, msg)

    await ws.send_json({"type": "message.ack", "client_id": client_id, "message": payload})
    if created:
        await manager.publish(members, {"type": "message.new", "message": payload})


async def on_typing(user_id: int, data: dict, ws: WebSocket) -> None:
    if not await rate_limit_ok(f"rl:typing:{user_id}", 10, 5):
        return
    checked = await _members_for(ws, user_id, data)
    if checked:
        cid, members = checked
        await manager.publish(
            [m for m in members if m != user_id],
            {"type": "typing", "conversation_id": cid, "user_id": user_id},
        )


async def on_read(user_id: int, data: dict, ws: WebSocket) -> None:
    mid = data.get("message_id")
    if not isinstance(mid, int) or mid <= 0:
        return await _error(ws, "bad_request", "message_id is required")
    checked = await _members_for(ws, user_id, data)
    if not checked:
        return
    cid, members = checked
    async with SessionLocal() as db:
        effective = await chat.mark_read(db, cid, user_id, mid)
    await manager.publish(
        members,
        {"type": "message.read", "conversation_id": cid, "user_id": user_id, "message_id": effective},
    )


async def on_edit_or_delete(user_id: int, data: dict, ws: WebSocket, delete: bool) -> None:
    mid = data.get("message_id")
    if not isinstance(mid, int):
        return await _error(ws, "bad_request", "message_id is required")
    async with SessionLocal() as db:
        if delete:
            msg = await chat.delete_message(db, mid, user_id)
        else:
            content = data.get("content")
            if not isinstance(content, str) or not content.strip() or len(content) > chat.MAX_TEXT_LEN:
                return await _error(ws, "bad_request", "Invalid content")
            msg = await chat.edit_message(db, mid, user_id, content.strip())
        if msg is None:
            return await _error(ws, "not_found", "Message not found or not yours")
        payload = await chat.message_payload(db, msg)
    members = await membership.member_ids(msg.conversation_id)
    await manager.publish(members, {"type": "message.updated", "message": payload})


async def handle_event(user_id: int, data: dict, ws: WebSocket) -> None:
    kind = data.get("type")
    try:
        if kind == "ping":
            await presence.heartbeat(user_id)
            await ws.send_json({"type": "pong"})
        elif kind == "message.send":
            await on_send(user_id, data, ws)
        elif kind == "typing.start":
            await on_typing(user_id, data, ws)
        elif kind == "message.read":
            await on_read(user_id, data, ws)
        elif kind == "message.edit":
            await on_edit_or_delete(user_id, data, ws, delete=False)
        elif kind == "message.delete":
            await on_edit_or_delete(user_id, data, ws, delete=True)
    except Exception:
        logger.exception("error handling %s", kind)
        cid = data.get("client_id") if isinstance(data.get("client_id"), str) else None
        try:
            await _error(ws, "server_error", "Something went wrong", cid)
        except Exception:
            pass
