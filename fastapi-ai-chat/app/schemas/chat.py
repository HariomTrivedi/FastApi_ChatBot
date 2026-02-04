from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: str = "user"
    content: str

