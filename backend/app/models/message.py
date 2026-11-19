from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BigID, DateTime3


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("idx_msg_conv_id", "conversation_id", "id"),  # history pagination
        UniqueConstraint("sender_id", "client_id", name="uq_msg_sender_client"),  # dedupe retries
    )

    id: Mapped[int] = mapped_column(BigID, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(BigID, ForeignKey("conversations.id", ondelete="CASCADE"))
    sender_id: Mapped[int] = mapped_column(BigID, ForeignKey("users.id"))
    client_id: Mapped[str] = mapped_column(String(36))
    type: Mapped[str] = mapped_column(Enum("text", "image", "file", "system", name="message_type"), default="text")
    content: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime3, server_default=text("CURRENT_TIMESTAMP(3)"))
    edited_at: Mapped[datetime | None] = mapped_column(DateTime3)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime3)


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(BigID, primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(BigID, ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigID)
    filename: Mapped[str | None] = mapped_column(String(255))
