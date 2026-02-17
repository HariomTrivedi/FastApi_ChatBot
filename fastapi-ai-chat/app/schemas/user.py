from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, EmailStr, Field

from app.db.models import User


class UserBase(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)
    full_name: Optional[str] = None


class UserCreate(UserBase):
    # bcrypt supports up to 72 bytes; enforce a sane max to avoid runtime errors
    password: str = Field(..., min_length=6, max_length=72)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(UserBase):
    id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    email: Optional[EmailStr] = None


class FriendRequestBase(BaseModel):
    receiver_id: int


class FriendRequestCreate(FriendRequestBase):
    pass


class FriendRequestResponse(BaseModel):
    id: int
    sender_id: int
    receiver_id: int
    status: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FriendRequestWithUser(FriendRequestResponse):
    sender: UserResponse

    class Config:
        from_attributes = True


class ChatMessageBase(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)


class ChatMessageCreate(ChatMessageBase):
    receiver_id: int
    reply_to_message_id: Optional[int] = None


class ChatMessageUpdate(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)


class MessageReactionToggle(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=32)


class MessageReactionSummary(BaseModel):
    emoji: str
    count: int
    reacted_by_me: bool = False


class MessageReactionsResponse(BaseModel):
    message_id: int
    reactions: List[MessageReactionSummary] = Field(default_factory=list)


class MessageReactionsBulkRequest(BaseModel):
    message_ids: List[int] = Field(default_factory=list)


class MessageReactionsBulkResponse(BaseModel):
    items: List[MessageReactionsResponse] = Field(default_factory=list)


class ChatMessageResponse(BaseModel):
    id: int
    sender_id: int
    receiver_id: int
    content: str
    message_type: str = "text"
    file_path: Optional[str] = None
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    reply_to_message_id: Optional[int] = None
    is_read: bool
    created_at: datetime
    reactions: List[MessageReactionSummary] = Field(default_factory=list)
    sender: UserResponse
    receiver: UserResponse
    reply_to_message: Optional['ChatMessageResponse'] = None

    class Config:
        from_attributes = True
