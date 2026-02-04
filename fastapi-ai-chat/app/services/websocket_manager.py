from typing import Dict, Set

from fastapi import WebSocket


class WebSocketManager:
    _instance = None

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.user_connections: Dict[int, Set[WebSocket]] = {}  # user_id -> set of websockets

    @classmethod
    def instance(cls) -> "WebSocketManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def connect(self, websocket: WebSocket, user_id: int = None):
        await websocket.accept()
        self.active_connections.add(websocket)

        # Associate websocket with user if user_id provided
        if user_id is not None:
            if user_id not in self.user_connections:
                self.user_connections[user_id] = set()
            self.user_connections[user_id].add(websocket)

    async def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

        # Remove from user connections - create a copy to avoid modification during iteration
        users_to_remove = []
        for user_id, connections in list(self.user_connections.items()):
            connections.discard(websocket)
            if not connections:
                users_to_remove.append(user_id)

        # Remove empty user connection sets
        for user_id in users_to_remove:
            del self.user_connections[user_id]

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)

    async def broadcast(self, message: dict):
        # Create a copy to avoid issues if connections change during broadcasting
        connections = list(self.active_connections)
        dead_connections = []
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception:
                # Mark dead connections for removal
                dead_connections.append(connection)

        # Remove dead connections
        for connection in dead_connections:
            self.active_connections.discard(connection)

    async def send_to_user(self, user_id: int, message: dict):
        """Send message to all websockets connected by a specific user"""
        if user_id in self.user_connections:
            # Create a copy of the connections to avoid issues if websockets disconnect during sending
            connections = list(self.user_connections[user_id])
            dead_connections = []
            for websocket in connections:
                try:
                    await websocket.send_json(message)
                except Exception:
                    # Mark dead connections for removal
                    dead_connections.append(websocket)

            # Remove dead connections
            for websocket in dead_connections:
                self.user_connections[user_id].discard(websocket)
                if not self.user_connections[user_id]:
                    del self.user_connections[user_id]

