import re
from datetime import datetime, timezone

from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Attachment, Conversation, ConversationMember, Message, User

MAX_TEXT_LEN = 4000
UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


# ---------- serialization ----------
def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def public_user(u: User) -> dict:
    return {"id": u.id, "username": u.username, "avatar_url": u.avatar_url}


def serialize_message(m: Message, attachments: list[Attachment]) -> dict:
    deleted = m.deleted_at is not None
    return {
        "id": m.id,
        "conversation_id": m.conversation_id,
        "sender_id": m.sender_id,
        "client_id": m.client_id,
        "type": m.type,
        "content": None if deleted else m.content,
        "created_at": iso(m.created_at),
        "edited_at": iso(m.edited_at),
        "deleted": deleted,
        "attachments": []
        if deleted
        else [
            {"id": a.id, "url": a.url, "mime_type": a.mime_type, "size_bytes": a.size_bytes, "filename": a.filename}
            for a in attachments
        ],
    }


async def attachments_for(db: AsyncSession, message_ids: list[int]) -> dict[int, list[Attachment]]:
    out: dict[int, list[Attachment]] = {i: [] for i in message_ids}
    if message_ids:
        rows = await db.scalars(select(Attachment).where(Attachment.message_id.in_(message_ids)))
        for a in rows:
            out[a.message_id].append(a)
    return out


async def message_payload(db: AsyncSession, msg: Message) -> dict:
    atts = await attachments_for(db, [msg.id])
    return serialize_message(msg, atts[msg.id])


# ---------- membership ----------
async def is_member(db: AsyncSession, conversation_id: int, user_id: int) -> bool:
    row = await db.scalar(
        select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
            ConversationMember.left_at.is_(None),
        )
    )
    return row is not None


# ---------- conversations ----------
async def get_or_create_direct(db: AsyncSession, user_id: int, other_id: int) -> tuple[Conversation, bool]:
    if user_id == other_id:
        raise ValueError("You cannot start a chat with yourself")
    if await db.get(User, other_id) is None:
        raise LookupError("User not found")
    a, b = sorted((user_id, other_id))
    key = f"{a}:{b}"
    existing = await db.scalar(select(Conversation).where(Conversation.direct_key == key))
    if existing:
        return existing, False
    conv = Conversation(type="direct", direct_key=key, created_by=user_id)
    db.add(conv)
    try:
        await db.flush()
    except IntegrityError:  # lost a race with the other user
        await db.rollback()
        existing = await db.scalar(select(Conversation).where(Conversation.direct_key == key))
        return existing, False
    db.add_all(
        [
            ConversationMember(conversation_id=conv.id, user_id=a, role="member"),
            ConversationMember(conversation_id=conv.id, user_id=b, role="member"),
        ]
    )
    await db.commit()
    return conv, True


async def create_group(db: AsyncSession, owner_id: int, name: str, member_ids: list[int]) -> Conversation:
    ids = {owner_id, *member_ids}
    found = set((await db.scalars(select(User.id).where(User.id.in_(ids)))).all())
    if found != ids:
        raise LookupError("One or more users were not found")
    conv = Conversation(type="group", name=name.strip(), created_by=owner_id)
    db.add(conv)
    await db.flush()
    db.add_all(
        ConversationMember(conversation_id=conv.id, user_id=uid, role="owner" if uid == owner_id else "member")
        for uid in ids
    )
    await db.commit()
    return conv


_LIST_SQL = text(
    """
    SELECT c.id, c.type, c.name, c.last_message_id, c.last_message_at, c.created_at,
           LEAST((SELECT COUNT(*) FROM messages m
                  WHERE m.conversation_id = c.id
                    AND m.id > cm.last_read_message_id
                    AND m.sender_id <> :uid
                    AND m.deleted_at IS NULL), 100) AS unread
    FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.user_id = :uid AND cm.left_at IS NULL
      AND (:cid IS NULL OR c.id = :cid)
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
    LIMIT 100
    """
)


async def list_conversations(db: AsyncSession, user_id: int, conversation_id: int | None = None) -> list[dict]:
    rows = (await db.execute(_LIST_SQL, {"uid": user_id, "cid": conversation_id})).mappings().all()
    if not rows:
        return []
    ids = [r["id"] for r in rows]

    member_rows = await db.execute(
        select(User, ConversationMember.last_read_message_id)
        .join(ConversationMember, ConversationMember.user_id == User.id)
        .where(ConversationMember.conversation_id.in_(ids), ConversationMember.left_at.is_(None))
        .add_columns(ConversationMember.conversation_id)
    )
    members: dict[int, list[dict]] = {i: [] for i in ids}
    for user, last_read, cid in member_rows:
        members[cid].append({**public_user(user), "last_read_message_id": last_read})

    last_ids = [r["last_message_id"] for r in rows if r["last_message_id"]]
    last_messages: dict[int, dict] = {}
    if last_ids:
        msgs = (await db.scalars(select(Message).where(Message.id.in_(last_ids)))).all()
        atts = await attachments_for(db, [m.id for m in msgs])
        last_messages = {m.id: serialize_message(m, atts[m.id]) for m in msgs}

    return [
        {
            "id": r["id"],
            "type": r["type"],
            "name": r["name"],
            "members": members[r["id"]],
            "last_message": last_messages.get(r["last_message_id"]),
            "last_activity": iso(r["last_message_at"] or r["created_at"]),
            "unread": int(r["unread"]),
        }
        for r in rows
    ]


# ---------- messages ----------
def validate_payload(data: dict) -> tuple[str, str | None, dict | None]:
    """Returns (kind, content, attachment) or raises ValueError."""
    client_id = data.get("client_id")
    if not isinstance(client_id, str) or not UUID_RE.match(client_id):
        raise ValueError("client_id must be a UUID")
    kind = data.get("kind", "text")
    if kind not in ("text", "image", "file"):
        raise ValueError("Unsupported message kind")
    content = data.get("content")
    if content is not None:
        if not isinstance(content, str):
            raise ValueError("content must be a string")
        content = content.strip() or None
        if content and len(content) > MAX_TEXT_LEN:
            raise ValueError(f"Messages are limited to {MAX_TEXT_LEN} characters")

    attachment = None
    if kind == "text":
        if not content:
            raise ValueError("Message is empty")
    else:
        att = data.get("attachment")
        if not isinstance(att, dict):
            raise ValueError("attachment is required")
        url, mime, size = att.get("url"), att.get("mime_type"), att.get("size_bytes")
        if not (isinstance(url, str) and url.startswith("/files/") and ".." not in url and len(url) < 500):
            raise ValueError("Invalid attachment url")
        if not (isinstance(mime, str) and len(mime) < 100 and isinstance(size, int) and size >= 0):
            raise ValueError("Invalid attachment")
        filename = att.get("filename")
        filename = filename[:255] if isinstance(filename, str) else None
        attachment = {"url": url, "mime_type": mime, "size_bytes": size, "filename": filename}
    return kind, content, attachment


async def save_message(
    db: AsyncSession, conversation_id: int, sender_id: int, client_id: str, kind: str,
    content: str | None, attachment: dict | None,
) -> tuple[Message, bool]:
    """Idempotent on (sender_id, client_id). Returns (message, created)."""

    async def existing() -> Message | None:
        return await db.scalar(select(Message).where(Message.sender_id == sender_id, Message.client_id == client_id))

    if found := await existing():
        return found, False

    msg = Message(conversation_id=conversation_id, sender_id=sender_id, client_id=client_id, type=kind, content=content)
    db.add(msg)
    try:
        await db.flush()
    except IntegrityError:  # concurrent retry
        await db.rollback()
        return await existing(), False

    if attachment:
        db.add(Attachment(message_id=msg.id, **attachment))
    await db.execute(
        update(Conversation)
        .where(Conversation.id == conversation_id)
        .values(last_message_id=msg.id, last_message_at=func.now(3))
    )
    await db.commit()
    await db.refresh(msg)  # loads server-side created_at
    return msg, True


async def edit_message(db: AsyncSession, message_id: int, user_id: int, content: str) -> Message | None:
    msg = await db.get(Message, message_id)
    if not msg or msg.sender_id != user_id or msg.deleted_at is not None or msg.type != "text":
        return None
    msg.content = content
    msg.edited_at = func.now(3)
    await db.commit()
    await db.refresh(msg)
    return msg


async def delete_message(db: AsyncSession, message_id: int, user_id: int) -> Message | None:
    msg = await db.get(Message, message_id)
    if not msg or msg.sender_id != user_id or msg.deleted_at is not None:
        return None
    msg.deleted_at = func.now(3)
    await db.commit()
    await db.refresh(msg)
    return msg


async def list_messages(
    db: AsyncSession, conversation_id: int, before_id: int | None, after_id: int | None, limit: int
) -> list[dict]:
    """Cursor pagination. Always returns oldest -> newest."""
    q = select(Message).where(Message.conversation_id == conversation_id)
    if after_id is not None:
        rows = list((await db.scalars(q.where(Message.id > after_id).order_by(Message.id.asc()).limit(limit))).all())
    else:
        if before_id is not None:
            q = q.where(Message.id < before_id)
        rows = list((await db.scalars(q.order_by(Message.id.desc()).limit(limit))).all())
        rows.reverse()
    atts = await attachments_for(db, [m.id for m in rows])
    return [serialize_message(m, atts[m.id]) for m in rows]


async def mark_read(db: AsyncSession, conversation_id: int, user_id: int, message_id: int) -> int:
    """Moves the read marker forward only (never past the newest message). Returns the effective id."""
    last = await db.scalar(select(Conversation.last_message_id).where(Conversation.id == conversation_id)) or 0
    effective = min(message_id, last)
    await db.execute(
        update(ConversationMember)
        .where(ConversationMember.conversation_id == conversation_id, ConversationMember.user_id == user_id)
        .values(last_read_message_id=func.greatest(ConversationMember.last_read_message_id, effective))
    )
    await db.commit()
    return effective
