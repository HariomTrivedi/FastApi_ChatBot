from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_
from typing import List

from app.db.database import get_db
from app.db.models import User, FriendRequest, FriendRequestStatus
from app.schemas.user import FriendRequestCreate, FriendRequestResponse, FriendRequestWithUser
from app.core.security import get_current_user
from app.services.websocket_manager import WebSocketManager

router = APIRouter()


@router.post("/requests", response_model=FriendRequestResponse, status_code=status.HTTP_201_CREATED)
async def send_friend_request(
    request_data: FriendRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Send a friend request to another user"""
    print(f"Sending friend request from user {current_user.id} to user {request_data.receiver_id}")

    # Check if receiver exists and is active
    receiver = db.query(User).filter(
        User.id == request_data.receiver_id,
        User.is_active == True
    ).first()

    if not receiver:
        print(f"Receiver user {request_data.receiver_id} not found or not active")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if trying to send request to self
    if current_user.id == request_data.receiver_id:
        print(f"User {current_user.id} trying to send request to themselves")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot send friend request to yourself"
        )

    # Check if request already exists
    existing_request = db.query(FriendRequest).filter(
        or_(
            and_(FriendRequest.sender_id == current_user.id, FriendRequest.receiver_id == request_data.receiver_id),
            and_(FriendRequest.sender_id == request_data.receiver_id, FriendRequest.receiver_id == current_user.id)
        )
    ).first()

    if existing_request:
        print(f"Existing request found with status: {existing_request.status}")
        if existing_request.status == FriendRequestStatus.ACCEPTED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Users are already friends"
            )
        elif existing_request.status == FriendRequestStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Friend request already exists"
            )

    # Create new friend request
    friend_request = FriendRequest(
        sender_id=current_user.id,
        receiver_id=request_data.receiver_id,
        status=FriendRequestStatus.PENDING
    )

    db.add(friend_request)
    db.commit()
    db.refresh(friend_request)

    # Send WebSocket notification to receiver
    await ws_manager.send_to_user(
        request_data.receiver_id,
        {
            "type": "friend_request_received",
            "data": {
                "request_id": friend_request.id,
                "sender_id": current_user.id,
                "sender_username": current_user.username,
                "sender_email": current_user.email
            }
        }
    )

    return friend_request


@router.get("/requests/sent", response_model=List[FriendRequestWithUser])
async def get_sent_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get friend requests sent by current user"""
    requests = db.query(FriendRequest).options(
        joinedload(FriendRequest.receiver)
    ).filter(
        FriendRequest.sender_id == current_user.id
    ).all()

    result = []
    for request in requests:
        result.append(FriendRequestWithUser(
            id=request.id,
            sender_id=request.sender_id,
            receiver_id=request.receiver_id,
            status=request.status.value,
            created_at=request.created_at,
            updated_at=request.updated_at,
            sender=current_user
        ))
    return result


@router.get("/requests/received", response_model=List[FriendRequestWithUser])
async def get_received_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get friend requests received by current user"""
    requests = db.query(FriendRequest).options(
        joinedload(FriendRequest.sender)
    ).filter(
        FriendRequest.receiver_id == current_user.id,
        FriendRequest.status == FriendRequestStatus.PENDING
    ).all()

    result = []
    for request in requests:
        result.append(FriendRequestWithUser(
            id=request.id,
            sender_id=request.sender_id,
            receiver_id=request.receiver_id,
            status=request.status.value,
            created_at=request.created_at,
            updated_at=request.updated_at,
            sender=request.sender
        ))
    return result


@router.delete("/friends/{friend_id}", response_model=dict)
async def remove_friend(
    friend_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Remove a friend (delete the friendship and all chat messages)"""
    # Find the friend request where current user and friend are connected
    friend_request = db.query(FriendRequest).filter(
        FriendRequest.status == FriendRequestStatus.ACCEPTED,
        or_(
            and_(FriendRequest.sender_id == current_user.id, FriendRequest.receiver_id == friend_id),
            and_(FriendRequest.sender_id == friend_id, FriendRequest.receiver_id == current_user.id)
        )
    ).first()

    if not friend_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Friend relationship not found"
        )

    # Delete all chat messages between the two users
    from app.db.models import ChatMessage
    deleted_messages = db.query(ChatMessage).filter(
        or_(
            and_(ChatMessage.sender_id == current_user.id, ChatMessage.receiver_id == friend_id),
            and_(ChatMessage.sender_id == friend_id, ChatMessage.receiver_id == current_user.id)
        )
    ).delete()

    # Delete the friend request record
    db.delete(friend_request)
    db.commit()

    # Send WebSocket notification to both users
    await ws_manager.send_to_user(
        current_user.id,
        {
            "type": "friend_removed",
            "data": {
                "removed_friend_id": friend_id,
                "deleted_messages": deleted_messages
            }
        }
    )

    await ws_manager.send_to_user(
        friend_id,
        {
            "type": "friend_removed",
            "data": {
                "removed_friend_id": current_user.id,
                "deleted_messages": deleted_messages
            }
        }
    )

    return {"message": "Friend removed successfully", "deleted_messages": deleted_messages}


@router.delete("/requests/{request_id}", response_model=dict)
async def cancel_friend_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Cancel/delete a friend request (for pending requests sent by current user or received requests)"""
    # Find the friend request where current user is either sender or receiver
    request = db.query(FriendRequest).filter(
        FriendRequest.id == request_id,
        or_(
            FriendRequest.sender_id == current_user.id,
            FriendRequest.receiver_id == current_user.id
        )
    ).first()

    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Friend request not found"
        )

    # If the request is already accepted, use the remove friend endpoint instead
    if request.status == FriendRequestStatus.ACCEPTED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel an accepted friendship. Use DELETE /friends/{friend_id} instead"
        )

    # Delete the friend request
    db.delete(request)
    db.commit()

    # Send WebSocket notification to the other user
    other_user_id = request.sender_id if request.sender_id != current_user.id else request.receiver_id
    await ws_manager.send_to_user(
        other_user_id,
        {
            "type": "friend_request_cancelled",
            "data": {
                "request_id": request.id,
                "cancelled_by_id": current_user.id,
                "cancelled_by_username": current_user.username
            }
        }
    )

    return {"message": "Friend request cancelled successfully"}


@router.put("/requests/{request_id}/accept", response_model=FriendRequestResponse)
async def accept_friend_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Accept a friend request"""
    request = db.query(FriendRequest).filter(
        FriendRequest.id == request_id,
        FriendRequest.receiver_id == current_user.id,
        FriendRequest.status == FriendRequestStatus.PENDING
    ).first()

    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Friend request not found"
        )

    request.status = FriendRequestStatus.ACCEPTED
    db.commit()
    db.refresh(request)

    # Send WebSocket notification to sender
    await ws_manager.send_to_user(
        request.sender_id,
        {
            "type": "friend_request_accepted",
            "data": {
                "request_id": request.id,
                "accepter_id": current_user.id,
                "accepter_username": current_user.username,
                "accepter_email": current_user.email
            }
        }
    )

    return request


@router.put("/requests/{request_id}/decline", response_model=FriendRequestResponse)
async def decline_friend_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ws_manager: WebSocketManager = Depends(lambda: WebSocketManager.instance())
):
    """Decline a friend request"""
    request = db.query(FriendRequest).filter(
        FriendRequest.id == request_id,
        FriendRequest.receiver_id == current_user.id,
        FriendRequest.status == FriendRequestStatus.PENDING
    ).first()

    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Friend request not found"
        )

    request.status = FriendRequestStatus.DECLINED
    db.commit()
    db.refresh(request)

    # Send WebSocket notification to sender
    await ws_manager.send_to_user(
        request.sender_id,
        {
            "type": "friend_request_declined",
            "data": {
                "request_id": request.id,
                "decliner_id": current_user.id,
                "decliner_username": current_user.username,
                "decliner_email": current_user.email
            }
        }
    )

    return request


@router.get("/friends", response_model=List[FriendRequestWithUser])
async def get_friends(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get accepted friends list"""
    # Get friends where current user is sender
    friends_as_sender = db.query(FriendRequest).options(
        joinedload(FriendRequest.receiver)
    ).filter(
        FriendRequest.sender_id == current_user.id,
        FriendRequest.status == FriendRequestStatus.ACCEPTED
    ).all()

    # Get friends where current user is receiver
    friends_as_receiver = db.query(FriendRequest).options(
        joinedload(FriendRequest.sender)
    ).filter(
        FriendRequest.receiver_id == current_user.id,
        FriendRequest.status == FriendRequestStatus.ACCEPTED
    ).all()

    # Combine and format results
    result = []

    # For requests where current user is sender, the friend is the receiver
    for request in friends_as_sender:
        result.append(FriendRequestWithUser(
            id=request.id,
            sender_id=request.sender_id,
            receiver_id=request.receiver_id,
            status=request.status.value,
            created_at=request.created_at,
            updated_at=request.updated_at,
            sender=request.receiver  # The friend is the receiver
        ))

    # For requests where current user is receiver, the friend is the sender
    for request in friends_as_receiver:
        result.append(FriendRequestWithUser(
            id=request.id,
            sender_id=request.sender_id,
            receiver_id=request.receiver_id,
            status=request.status.value,
            created_at=request.created_at,
            updated_at=request.updated_at,
            sender=request.sender  # The friend is the sender
        ))

    return result
