git # FastAPI AI Chat Backend

This directory contains the FastAPI backend for the Chatbot Dashboard application. It provides both social messaging functionality and AI-powered chat capabilities.

## 🚀 Quick Start

1. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Set environment variables:**
   ```bash
   # Required for AI functionality
   OPENAI_API_KEY=your_openai_key
   GROQ_API_KEY=your_groq_key
   GOOGLE_API_KEY=your_google_key

   # Application settings
   SECRET_KEY=your-secret-key
   DATABASE_URL=sqlite:///./chatbot.db
   ```

3. **Run the server:**
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

4. **Access the application:**
   Open `http://localhost:8000` in your browser

## 📁 Project Structure

```
├── app/
│   ├── api/routes/          # API endpoints
│   │   ├── auth.py         # User authentication
│   │   ├── messages.py     # Social messaging
│   │   ├── friends.py      # Friend management
│   │   ├── chat.py         # AI chat WebSocket
│   │   └── documents.py    # Document upload/RAG
│   ├── core/               # Core functionality
│   │   ├── config.py       # Settings
│   │   ├── security.py     # JWT/auth utilities
│   │   └── database.py     # DB connection
│   ├── db/                 # Database models
│   ├── schemas/            # Pydantic models
│   ├── services/           # Business logic
│   └── utils/              # Utilities
├── frontend/               # Static files served by FastAPI
├── uploads/               # User uploaded files
├── data/chroma/           # Vector database
└── requirements.txt       # Python dependencies
```

## 🔧 Key Features

- **Social Messaging**: Friend requests, real-time chat, file sharing
- **AI Integration**: WebSocket streaming with multiple LLM providers
- **RAG Pipeline**: PDF processing and vector search
- **Authentication**: JWT-based security
- **File Management**: Image and document uploads

See the main README.md in the parent directory for comprehensive documentation.

