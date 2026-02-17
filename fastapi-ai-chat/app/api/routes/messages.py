from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload
from typing import Dict, List, Set
from pathlib import Path

from app.db.database import get_db
from app.db.models import User, ChatMessage, ChatMessageReaction, MessageType
from app.schemas.user import (
    ChatMessageCreate,
    ChatMessageUpdate,
    ChatMessageResponse,
    MessageReactionToggle,
    MessageReactionSummary,
    MessageReactionsResponse,
    MessageReactionsBulkRequest,
    MessageReactionsBulkResponse,
)
from app.core.security import get_current_user
from app.services.websocket_manager import WebSocketManager
from app.utils.file_utils import save_chat_file

router = APIRouter()

def _build_reaction_summaries(
    reactions: List[ChatMessageReaction],
    current_user_id: int,
) -> List[MessageReactionSummary]:
    by_emoji: Dict[str, Set[int]] = {}
    for reaction in reactions:
        by_emoji.setdefault(reaction.emoji, set()).add(reaction.user_id)

    summaries: List[MessageReactionSummary] = []
    for emoji, user_ids in by_emoji.items():
        summaries.append(
            MessageReactionSummary(
                emoji=emoji,
                count=len(user_ids),
                reacted_by_me=current_user_id in user_ids,
            )
        )

    # Stable ordering: most-used first, then emoji
    summaries.sort(key=lambda r: (-r.count, r.emoji))
    return summaries


def _fetch_reaction_summaries_by_message_id(
    db: Session,
    message_ids: List[int],
    current_user_id: int,
) -> Dict[int, List[MessageReactionSummary]]:
    if not message_ids:
        return {}

    rows = (
        db.query(ChatMessageReaction)
        .filter(ChatMessageReaction.message_id.in_(message_ids))
        .all()
    )

    by_message: Dict[int, List[ChatMessageReaction]] = {}
    for row in rows:
        by_message.setdefault(row.message_id, []).append(row)

    return {
        message_id: _build_reaction_summaries(reactions, current_user_id)
        for message_id, reactions in by_message.items()
    }


@router.post("/send", response_model=ChatMessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    message_data: ChatMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Send a message to another user"""

    # Check if receiver exists and is active
    receiver = db.query(User).filter(
        User.id == message_data.receiver_id,
        User.is_active == True
    ).first()

    if not receiver:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if they are friends
    from app.db.models import FriendRequest, FriendRequestStatus
    friendship = db.query(FriendRequest).filter(
        FriendRequest.status == FriendRequestStatus.ACCEPTED,
        ((FriendRequest.sender_id == current_user.id) & (FriendRequest.receiver_id == message_data.receiver_id)) |
        ((FriendRequest.sender_id == message_data.receiver_id) & (FriendRequest.receiver_id == current_user.id))
    ).first()

    if not friendship:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only send messages to friends"
        )

    # Validate reply_to_message_id if provided
    reply_to_message = None
    if message_data.reply_to_message_id:
        reply_to_message = db.query(ChatMessage).filter(
            ChatMessage.id == message_data.reply_to_message_id,
            ((ChatMessage.sender_id == current_user.id) & (ChatMessage.receiver_id == message_data.receiver_id)) |
            ((ChatMessage.sender_id == message_data.receiver_id) & (ChatMessage.receiver_id == current_user.id))
        ).first()

        if not reply_to_message:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Reply message not found or not accessible"
            )

    # Create the message
    message = ChatMessage(
        sender_id=current_user.id,
        receiver_id=message_data.receiver_id,
        content=message_data.content,
        message_type=MessageType.TEXT.value,
        reply_to_message_id=message_data.reply_to_message_id
    )

    db.add(message)
    db.commit()
    db.refresh(message)

    # Prepare reply message data if this is a reply
    reply_data = None
    if reply_to_message:
        reply_data = {
            "id": reply_to_message.id,
            "content": reply_to_message.content,
            "sender_username": reply_to_message.sender.username if reply_to_message.sender else "Unknown",
            "message_type": reply_to_message.message_type
        }

    # Send WebSocket notification to receiver
    await ws_manager.send_to_user(
        message_data.receiver_id,
        {
            "type": "chat_message",
            "data": {
                "id": message.id,
                "sender_id": current_user.id,
                "sender_username": current_user.username,
                "receiver_id": message_data.receiver_id,
                "content": message_data.content,
                "message_type": message.message_type,
                "reply_to_message_id": message.reply_to_message_id,
                "reply_to_message": reply_data,
                "reactions": [],
                "is_read": False,
                "created_at": message.created_at.isoformat()
            }
        }
    )

    # Return the message with sender and receiver info
    return ChatMessageResponse(
        id=message.id,
        sender_id=message.sender_id,
        receiver_id=message.receiver_id,
        content=message.content,
        message_type=message.message_type,
        reply_to_message_id=message.reply_to_message_id,
        is_read=message.is_read,
        created_at=message.created_at,
        reactions=[],
        sender=current_user,
        receiver=receiver,
        reply_to_message=reply_to_message
    )


@router.get("/conversation/{friend_id}", response_model=List[ChatMessageResponse])
async def get_conversation(
    friend_id: int,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Get chat history with a specific friend (paginated)"""

    # Check if they are friends
    from app.db.models import FriendRequest, FriendRequestStatus
    friendship = db.query(FriendRequest).filter(
        FriendRequest.status == FriendRequestStatus.ACCEPTED,
        ((FriendRequest.sender_id == current_user.id) & (FriendRequest.receiver_id == friend_id)) |
        ((FriendRequest.sender_id == friend_id) & (FriendRequest.receiver_id == current_user.id))
    ).first()

    if not friendship:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view messages with friends"
        )

    # Get all messages between the two users, eagerly loading sender, receiver, and reply_to_message
    messages = db.query(ChatMessage).options(
        joinedload(ChatMessage.sender),
        joinedload(ChatMessage.receiver),
        joinedload(ChatMessage.reply_to_message).joinedload(ChatMessage.sender),
        joinedload(ChatMessage.reply_to_message).joinedload(ChatMessage.receiver)
    ).filter(
        ((ChatMessage.sender_id == current_user.id) & (ChatMessage.receiver_id == friend_id)) |
        ((ChatMessage.sender_id == friend_id) & (ChatMessage.receiver_id == current_user.id))
    ).order_by(ChatMessage.created_at.desc()).offset(offset).limit(limit).all()

    reaction_map = _fetch_reaction_summaries_by_message_id(
        db,
        [m.id for m in messages],
        current_user.id,
    )

    # Note: Messages are no longer automatically marked as read when loading conversation
    # They will be marked as read only when the chat window is actually opened and viewed
    if messages:
        db.commit()

    # Format response with sender and receiver info
    result = []
    for message in reversed(messages):
        result.append(ChatMessageResponse(
            id=message.id,
            sender_id=message.sender_id,
            receiver_id=message.receiver_id,
            content=message.content,
            message_type=message.message_type if message.message_type else "text",
            file_path=message.file_path,
            file_name=message.file_name,
            file_size=message.file_size,
            mime_type=message.mime_type,
            reply_to_message_id=message.reply_to_message_id,
            is_read=message.is_read,
            created_at=message.created_at,
            reactions=reaction_map.get(message.id, []),
            sender=message.sender,
            receiver=message.receiver,
            reply_to_message=message.reply_to_message
        ))

    return result


@router.patch("/{message_id}", response_model=ChatMessageResponse)
async def update_message(
    message_id: int,
    update_data: ChatMessageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Edit a message (sender only, text messages only)"""
    message = db.query(ChatMessage).options(
        joinedload(ChatMessage.sender),
        joinedload(ChatMessage.receiver)
    ).filter(ChatMessage.id == message_id).first()

    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    if message.sender_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only edit your own messages")

    if message.message_type != MessageType.TEXT.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only text messages can be edited")

    message.content = update_data.content
    db.commit()
    db.refresh(message)

    await ws_manager.send_to_user(
        message.receiver_id,
        {
            "type": "message_edited",
            "data": {
                "id": message.id,
                "sender_id": message.sender_id,
                "receiver_id": message.receiver_id,
                "content": message.content,
                "message_type": message.message_type,
                "created_at": message.created_at.isoformat(),
            }
        }
    )

    return ChatMessageResponse(
        id=message.id,
        sender_id=message.sender_id,
        receiver_id=message.receiver_id,
        content=message.content,
        message_type=message.message_type,
        file_path=message.file_path,
        file_name=message.file_name,
        file_size=message.file_size,
        mime_type=message.mime_type,
        is_read=message.is_read,
        created_at=message.created_at,
        sender=message.sender,
        receiver=message.receiver
    )


@router.delete("/{message_id}", response_model=dict)
async def delete_message(
    message_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Delete a message (sender only)"""
    message = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()

    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    if message.sender_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only delete your own messages")

    receiver_id = message.receiver_id
    db.query(ChatMessageReaction).filter(ChatMessageReaction.message_id == message_id).delete(
        synchronize_session=False
    )
    db.delete(message)
    db.commit()

    await ws_manager.send_to_user(
        receiver_id,
        {
            "type": "message_deleted",
            "data": {"message_id": message_id, "sender_id": current_user.id, "receiver_id": receiver_id}
        }
    )

    return {"deleted": True, "message_id": message_id}


@router.post("/{message_id}/reactions/toggle", response_model=MessageReactionsResponse)
async def toggle_reaction(
    message_id: int,
    payload: MessageReactionToggle,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance()),
):
    """Toggle an emoji reaction on a message (sender or receiver)"""
    emoji = (payload.emoji or "").strip()
    if not emoji:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Emoji is required")

    message = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    if current_user.id not in (message.sender_id, message.receiver_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to react to this message")

    existing = db.query(ChatMessageReaction).filter(
        ChatMessageReaction.message_id == message_id,
        ChatMessageReaction.user_id == current_user.id,
        ChatMessageReaction.emoji == emoji,
    ).first()

    if existing:
        db.delete(existing)
    else:
        db.add(ChatMessageReaction(message_id=message_id, user_id=current_user.id, emoji=emoji))

    db.commit()

    updated_rows = db.query(ChatMessageReaction).filter(ChatMessageReaction.message_id == message_id).all()
    summaries = _build_reaction_summaries(updated_rows, current_user.id)

    def _dump(m: MessageReactionSummary) -> dict:
        return m.model_dump() if hasattr(m, "model_dump") else m.dict()

    for user_id in {message.sender_id, message.receiver_id}:
        per_user_summaries = _build_reaction_summaries(updated_rows, int(user_id))
        await ws_manager.send_to_user(
            int(user_id),
            {
                "type": "message_reaction_updated",
                "data": {
                    "message_id": message_id,
                    "reactions": [_dump(s) for s in per_user_summaries],
                },
            },
        )

    return {"message_id": message_id, "reactions": [_dump(s) for s in summaries]}


@router.post("/reactions/bulk", response_model=MessageReactionsBulkResponse)
async def get_reactions_bulk(
    payload: MessageReactionsBulkRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    message_ids = list(dict.fromkeys(payload.message_ids or []))
    if not message_ids:
        return {"items": []}

    if len(message_ids) > 200:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Too many message_ids",
        )

    accessible = (
        db.query(ChatMessage.id)
        .filter(
            ChatMessage.id.in_(message_ids),
            (
                (ChatMessage.sender_id == current_user.id)
                | (ChatMessage.receiver_id == current_user.id)
            ),
        )
        .all()
    )
    accessible_ids = [mid for (mid,) in accessible]
    if not accessible_ids:
        return {"items": []}

    reaction_map = _fetch_reaction_summaries_by_message_id(
        db,
        accessible_ids,
        current_user.id,
    )

    items = [
        {
            "message_id": mid,
            "reactions": reaction_map.get(mid, []),
        }
        for mid in accessible_ids
    ]

    return {"items": items}


@router.put("/mark-read/{friend_id}", response_model=dict)
async def mark_messages_read(
    friend_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Mark all messages from a friend as read"""

    # Update messages from friend as read
    updated_messages = db.query(ChatMessage).filter(
        ChatMessage.sender_id == friend_id,
        ChatMessage.receiver_id == current_user.id,
        ChatMessage.is_read == False
    ).all()

    message_ids = [msg.id for msg in updated_messages]

    # Update the messages
    updated_count = db.query(ChatMessage).filter(
        ChatMessage.sender_id == friend_id,
        ChatMessage.receiver_id == current_user.id,
        ChatMessage.is_read == False
    ).update({"is_read": True})

    db.commit()

    # Notify the sender that their messages have been read
    if updated_count > 0:
        await ws_manager.send_to_user(
            friend_id,
            {
                "type": "messages_read",
                "data": {
                    "reader_id": current_user.id,
                    "reader_username": current_user.username,
                    "message_ids": message_ids
                }
            }
        )

    return {"marked_read": updated_count}


@router.delete("/conversation/{friend_id}", response_model=dict)
async def delete_conversation(
    friend_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete all messages in conversation with a friend"""

    # Check if they are friends (or were friends)
    from app.db.models import FriendRequest, FriendRequestStatus

    message_ids = [
        mid
        for (mid,) in db.query(ChatMessage.id).filter(
            ((ChatMessage.sender_id == current_user.id) & (ChatMessage.receiver_id == friend_id))
            | ((ChatMessage.sender_id == friend_id) & (ChatMessage.receiver_id == current_user.id))
        ).all()
    ]

    if message_ids:
        db.query(ChatMessageReaction).filter(ChatMessageReaction.message_id.in_(message_ids)).delete(
            synchronize_session=False
        )

    # Delete all messages between the two users (both directions)
    deleted_count = db.query(ChatMessage).filter(
        ((ChatMessage.sender_id == current_user.id) & (ChatMessage.receiver_id == friend_id)) |
        ((ChatMessage.sender_id == friend_id) & (ChatMessage.receiver_id == current_user.id))
    ).delete()

    db.commit()

    return {"deleted_messages": deleted_count}


@router.post("/send-image", response_model=ChatMessageResponse, status_code=status.HTTP_201_CREATED)
async def send_image(
    receiver_id: int = Form(...),
    content: str = Form(""),  # Optional caption
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Send an image message to another user"""
    
    # Check if receiver exists and is active
    receiver = db.query(User).filter(
        User.id == receiver_id,
        User.is_active == True
    ).first()

    if not receiver:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if they are friends
    from app.db.models import FriendRequest, FriendRequestStatus
    friendship = db.query(FriendRequest).filter(
        FriendRequest.status == FriendRequestStatus.ACCEPTED,
        ((FriendRequest.sender_id == current_user.id) & (FriendRequest.receiver_id == receiver_id)) |
        ((FriendRequest.sender_id == receiver_id) & (FriendRequest.receiver_id == current_user.id))
    ).first()

    if not friendship:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only send messages to friends"
        )

    # Save the image file
    file_path, mime_type, file_size = await save_chat_file(file, current_user.id, is_image=True)
    
    # Use caption or default message
    message_content = content if content else f"📷 {file.filename}"

    # Create the message
    message = ChatMessage(
        sender_id=current_user.id,
        receiver_id=receiver_id,
        content=message_content,
        message_type=MessageType.IMAGE.value,
        file_path=str(file_path),
        file_name=file.filename,
        file_size=file_size,
        mime_type=mime_type
    )

    db.add(message)
    db.commit()
    db.refresh(message)

    # Send WebSocket notification to receiver
    await ws_manager.send_to_user(
        receiver_id,
        {
            "type": "chat_message",
            "data": {
                "id": message.id,
                "sender_id": current_user.id,
                "sender_username": current_user.username,
                "receiver_id": receiver_id,
                "content": message_content,
                "message_type": message.message_type,
                "file_path": str(file_path),
                "file_name": file.filename,
                "file_size": file_size,
                "mime_type": mime_type,
                "reactions": [],
                "is_read": False,
                "created_at": message.created_at.isoformat()
            }
        }
    )

    # Return the message with sender and receiver info
    return ChatMessageResponse(
        id=message.id,
        sender_id=message.sender_id,
        receiver_id=message.receiver_id,
        content=message.content,
        message_type=message.message_type,
        file_path=message.file_path,
        file_name=message.file_name,
        file_size=message.file_size,
        mime_type=message.mime_type,
        is_read=message.is_read,
        created_at=message.created_at,
        reactions=[],
        sender=current_user,
        receiver=receiver
    )


@router.post("/send-file", response_model=ChatMessageResponse, status_code=status.HTTP_201_CREATED)
async def send_file(
    receiver_id: int = Form(...),
    content: str = Form(""),  # Optional description
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Send a file message to another user"""
    
    # Check if receiver exists and is active
    receiver = db.query(User).filter(
        User.id == receiver_id,
        User.is_active == True
    ).first()

    if not receiver:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if they are friends
    from app.db.models import FriendRequest, FriendRequestStatus
    friendship = db.query(FriendRequest).filter(
        FriendRequest.status == FriendRequestStatus.ACCEPTED,
        ((FriendRequest.sender_id == current_user.id) & (FriendRequest.receiver_id == receiver_id)) |
        ((FriendRequest.sender_id == receiver_id) & (FriendRequest.receiver_id == current_user.id))
    ).first()

    if not friendship:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only send messages to friends"
        )

    # Save the file
    file_path, mime_type, file_size = await save_chat_file(file, current_user.id, is_image=False)
    
    # Use description or default message
    message_content = content if content else f"📎 {file.filename}"

    # Create the message
    message = ChatMessage(
        sender_id=current_user.id,
        receiver_id=receiver_id,
        content=message_content,
        message_type=MessageType.FILE.value,
        file_path=str(file_path),
        file_name=file.filename,
        file_size=file_size,
        mime_type=mime_type
    )

    db.add(message)
    db.commit()
    db.refresh(message)

    # Send WebSocket notification to receiver
    await ws_manager.send_to_user(
        receiver_id,
        {
            "type": "chat_message",
            "data": {
                "id": message.id,
                "sender_id": current_user.id,
                "sender_username": current_user.username,
                "receiver_id": receiver_id,
                "content": message_content,
                "message_type": message.message_type,
                "file_path": str(file_path),
                "file_name": file.filename,
                "file_size": file_size,
                "mime_type": mime_type,
                "reactions": [],
                "is_read": False,
                "created_at": message.created_at.isoformat()
            }
        }
    )

    # Return the message with sender and receiver info
    return ChatMessageResponse(
        id=message.id,
        sender_id=message.sender_id,
        receiver_id=message.receiver_id,
        content=message.content,
        message_type=message.message_type,
        file_path=message.file_path,
        file_name=message.file_name,
        file_size=message.file_size,
        mime_type=message.mime_type,
        is_read=message.is_read,
        created_at=message.created_at,
        reactions=[],
        sender=current_user,
        receiver=receiver
    )


@router.get("/file/{message_id}")
async def get_file(
    message_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Download a file or image from a message"""
    
    # Get the message
    message = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
    
    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )
    
    # Check if user is sender or receiver
    is_sender = message.sender_id == current_user.id
    is_receiver = message.receiver_id == current_user.id
    
    if not (is_sender or is_receiver):
        # Log for debugging
        print(f"File access denied - Message ID: {message_id}, Sender: {message.sender_id}, Receiver: {message.receiver_id}, Current User: {current_user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this file"
        )
    
    # Check if message has a file
    if not message.file_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message does not contain a file"
        )
    
    # Check if file exists
    file_path = Path(message.file_path)
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found on server"
        )
    
    # Return the file
    return FileResponse(
        path=str(file_path),
        filename=message.file_name or file_path.name,
        media_type=message.mime_type or "application/octet-stream"
    )
