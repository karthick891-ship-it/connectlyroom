from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BigID, DateTime3


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(BigID, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(Enum("direct", "group", name="conversation_type"))
    name: Mapped[str | None] = mapped_column(String(100))
    # "minUserId:maxUserId" for 1:1 chats; the unique index makes find-or-create race-safe.
    direct_key: Mapped[str | None] = mapped_column(String(50), unique=True)
    created_by: Mapped[int] = mapped_column(BigID, ForeignKey("users.id"))
    last_message_id: Mapped[int | None] = mapped_column(BigID)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime3, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime3, server_default=text("CURRENT_TIMESTAMP(3)"))


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    __table_args__ = (Index("idx_members_user", "user_id", "conversation_id"),)

    conversation_id: Mapped[int] = mapped_column(
        BigID, ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(BigID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(Enum("owner", "admin", "member", name="member_role"), default="member")
    last_read_message_id: Mapped[int] = mapped_column(BigID, default=0, server_default="0")
    joined_at: Mapped[datetime] = mapped_column(DateTime3, server_default=text("CURRENT_TIMESTAMP(3)"))
    left_at: Mapped[datetime | None] = mapped_column(DateTime3)
