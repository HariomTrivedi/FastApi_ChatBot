from datetime import datetime
from dataclasses import dataclass
from typing import List

from sqlalchemy import Boolean, Column, Integer, String, DateTime, ForeignKey, Enum, BigInteger, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import enum

from app.db.database import Base


@dataclass
class Document:
    id: str
    chunks: List[str]


class FriendRequestStatus(enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    REMOVED = "removed"


class MessageType(enum.Enum):
    TEXT = "text"
    IMAGE = "image"
    FILE = "file"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class FriendRequest(Base):
    __tablename__ = "friend_requests"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(Enum(FriendRequestStatus), default=FriendRequestStatus.PENDING)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    sender = relationship("User", foreign_keys=[sender_id], backref="sent_requests")
    receiver = relationship("User", foreign_keys=[receiver_id], backref="received_requests")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(String, nullable=False)
    message_type = Column(String(20), default=MessageType.TEXT.value, nullable=False)
    file_path = Column(String, nullable=True)  # Path to stored file
    file_name = Column(String, nullable=True)  # Original filename
    file_size = Column(BigInteger, nullable=True)  # File size in bytes
    mime_type = Column(String, nullable=True)  # MIME type of the file
    reply_to_message_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=True)  # Reply to another message
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    sender = relationship("User", foreign_keys=[sender_id], backref="sent_messages")
    receiver = relationship("User", foreign_keys=[receiver_id], backref="received_messages")
    reply_to_message = relationship("ChatMessage", remote_side=[id], backref="replies")
    reaction_entries = relationship(
        "ChatMessageReaction",
        back_populates="message",
        cascade="all, delete-orphan",
    )


class ChatMessageReaction(Base):
    __tablename__ = "chat_message_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_user_emoji"),
    )

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    emoji = Column(String(32), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    message = relationship("ChatMessage", back_populates="reaction_entries")
    user = relationship("User")
