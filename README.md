# FastAPI Chatbot Dashboard

A comprehensive real-time chat application built with FastAPI, featuring both social messaging and AI-powered conversations. Includes user authentication, friend management, file sharing, and integrated AI chat with RAG capabilities.

## 🚀 Features

### Social Messaging
- **User Authentication**: Secure registration and login with JWT tokens
- **Friend System**: Send friend requests, manage friendships, view online users
- **Real-time Messaging**: WebSocket-powered instant messaging between friends
- **Message Management**: Edit and delete your own messages
- **File Sharing**: Upload and share images, documents, and files
- **Read Receipts**: See when messages are read by recipients

### AI Chat Integration
- **Multiple AI Providers**: Support for OpenAI, Groq, and Google Generative AI
- **Streaming Responses**: Real-time AI responses via WebSocket
- **RAG Pipeline**: PDF document processing and vector search with ChromaDB
- **Contextual Conversations**: AI maintains conversation history

## 🛠️ Tech Stack

- **Backend**: FastAPI, SQLAlchemy, WebSockets
- **Authentication**: JWT tokens with bcrypt password hashing
- **Database**: SQLite (easily configurable for PostgreSQL/MySQL)
- **AI Integration**: OpenAI, Groq, Google Generative AI
- **Vector Storage**: ChromaDB for document embeddings
- **Frontend**: Vanilla HTML/CSS/JavaScript with responsive design
- **File Storage**: Local file system with organized directory structure

## 📁 Project Structure

```
fastapi-ai-chat/
├── app/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── auth.py          # Authentication endpoints
│   │   │   ├── messages.py      # Messaging functionality
│   │   │   ├── friends.py       # Friend management
│   │   │   ├── chat.py          # AI chat WebSocket endpoint
│   │   │   └── documents.py     # Document upload and RAG
│   │   └── deps.py              # FastAPI dependencies
│   ├── core/
│   │   ├── config.py            # Application settings
│   │   ├── security.py          # JWT and password utilities
│   │   └── database.py          # Database connection
│   ├── db/
│   │   ├── models.py            # SQLAlchemy models
│   │   └── database.py          # Database utilities
│   ├── schemas/                 # Pydantic schemas
│   ├── services/                # Business logic services
│   └── utils/                   # Utility functions
├── frontend/
│   ├── index.html               # Main application UI
│   ├── app.js                   # Frontend JavaScript logic
│   └── test-emoji.html          # Emoji testing page
├── uploads/                     # User uploaded files
├── data/chroma/                 # Vector database storage
└── requirements.txt             # Python dependencies
```

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- SQLite (included with Python)

### Installation

1. **Clone and setup virtual environment:**
   ```bash
   cd fastapi-ai-chat
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure environment variables:**
   Create a `.env` file or set environment variables:
   ```bash
   # AI Service Configuration (choose one or more)
   OPENAI_API_KEY=your_openai_api_key
   GROQ_API_KEY=your_groq_api_key
   GOOGLE_API_KEY=your_google_api_key

   # Application Settings
   SECRET_KEY=your-secret-key-here
   DATABASE_URL=sqlite:///./chatbot.db
   ```

4. **Run database migrations (if needed):**
   ```bash
   python migrate_add_file_fields.py
   ```

5. **Start the server:**
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

6. **Open your browser:**
   Navigate to `http://localhost:8000`

## 🎯 Usage

### Social Messaging
1. **Register/Login**: Create an account or log in
2. **Find Friends**: Browse active users and send friend requests
3. **Start Chatting**: Open chat windows with your friends
4. **Share Files**: Upload images and documents in conversations
5. **Manage Messages**: Right-click/long-press messages to edit or delete

### AI Chat
1. **WebSocket Connection**: The AI chat uses WebSocket for real-time responses
2. **Document Upload**: Upload PDFs for RAG-enhanced conversations
3. **Streaming**: AI responses stream in real-time as they're generated

## 🔧 API Endpoints

### Authentication
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /auth/refresh` - Refresh JWT token

### Friends
- `GET /friends/active-users` - Get active users
- `POST /friends/send-request/{user_id}` - Send friend request
- `POST /friends/accept-request/{request_id}` - Accept friend request
- `DELETE /friends/reject-request/{request_id}` - Reject friend request
- `GET /friends/my-friends` - Get friend list

### Messages
- `POST /messages/send` - Send message to friend
- `GET /messages/conversation/{friend_id}` - Get chat history
- `PATCH /messages/{message_id}` - Edit message
- `DELETE /messages/{message_id}` - Delete message
- `PUT /messages/mark-read/{friend_id}` - Mark messages as read
- `POST /messages/send-image` - Send image
- `POST /messages/send-file` - Send file
- `GET /messages/file/{message_id}` - Download file

### AI Chat
- `WebSocket /chat/ws` - Real-time AI chat
- `POST /chat/sync` - Synchronous AI chat (for testing)

### Documents
- `POST /documents/upload` - Upload PDF documents
- `GET /documents/list` - List uploaded documents

## 🔒 Security Features

- JWT-based authentication with refresh tokens
- Password hashing with bcrypt
- Friend-only messaging (users can only message friends)
- File upload restrictions and validation
- CORS middleware for cross-origin requests
- Input validation with Pydantic schemas

## 🎨 Frontend Features

- **Responsive Design**: Works on desktop and mobile
- **Real-time Updates**: WebSocket-powered live messaging
- **Emoji Support**: Full emoji picker with categories
- **File Previews**: Image thumbnails and file type indicators
- **Context Menus**: Right-click/long-press for message actions
- **Read Receipts**: Visual indicators for message status
- **Dark Mode Ready**: CSS variables for easy theming

## 📊 Database Schema

The application uses SQLAlchemy with the following main models:
- **User**: User accounts with authentication
- **FriendRequest**: Friend request management
- **ChatMessage**: Messages between users
- **MessageType**: Enum for message types (text, image, file)

## 🔧 Configuration

Key settings in `app/core/config.py`:
- Database URL
- JWT secret and expiration
- CORS origins
- File upload settings
- AI service configurations

## 🚀 Deployment

### Production Considerations
1. **Database**: Switch from SQLite to PostgreSQL/MySQL
2. **File Storage**: Use cloud storage (AWS S3, Google Cloud Storage)
3. **Reverse Proxy**: Nginx or Apache for static files
4. **SSL**: Enable HTTPS in production
5. **Environment Variables**: Secure API keys and secrets

### Docker Deployment (Example)
```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is open source. Feel free to use and modify as needed.

## 🆘 Troubleshooting

### Common Issues
- **WebSocket Connection Failed**: Check if the server is running on the correct port
- **File Upload Errors**: Ensure upload directories exist and have proper permissions
- **AI Chat Not Working**: Verify API keys are set correctly in environment variables
- **Database Errors**: Run migrations if you've updated the schema

### Development Tips
- Use `--reload` flag during development for auto-restart
- Check browser console for frontend errors
- Monitor server logs for backend issues
- Use the test scripts in the root directory for debugging

---

Built with ❤️ using FastAPI and modern web technologies.
