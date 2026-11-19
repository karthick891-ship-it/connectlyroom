from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.chat import CreateConversationIn
from app.services import chat
from app.ws.manager import manager

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("")
async def list_conversations(me: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await chat.list_conversations(db, me.id)


@router.post("", status_code=201)
async def create_conversation(body: CreateConversationIn, me: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        if body.type == "direct":
            conv, created = await chat.get_or_create_direct(db, me.id, body.user_id)
        else:
            conv, created = await chat.create_group(db, me.id, body.name, body.member_ids), True
    except ValueError as e:
        raise HTTPException(400, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))

    result = (await chat.list_conversations(db, me.id, conv.id))[0]
    if created:
        # Tell every member's open sessions (unread is 0 for a brand-new conversation).
        member_ids = [m["id"] for m in result["members"]]
        await manager.publish(member_ids, {"type": "conversation.new", "conversation": result})
    return result


@router.get("/{conversation_id}/messages")
async def get_messages(
    conversation_id: int,
    before_id: int | None = Query(None, ge=1),
    after_id: int | None = Query(None, ge=0),
    limit: int = Query(50, ge=1, le=200),
    me: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await chat.is_member(db, conversation_id, me.id):
        raise HTTPException(404, "Conversation not found")
    return await chat.list_messages(db, conversation_id, before_id, after_id, limit)
