# fastapi-ai-chat

Real-time AI chatbot starter built with FastAPI. Features WebSocket streaming responses, pluggable LLM service, and a minimal RAG pipeline for PDF uploads and vector search.

## Features
- WebSocket chat with broadcast manager
- LLM abstraction with streaming placeholder (OpenAI/Groq ready)
- RAG basics: PDF upload → text chunking → in-memory vector store search
- Modular FastAPI layout and simple HTML/JS frontend

## Quickstart
1. Install Python 3.10+ and create a virtual environment.
2. Install deps:
   ```bash
   pip install -r requirements.txt
   ```
3. Set environment variables (or edit `.env`):
   ```
   OPENAI_API_KEY=sk-...
   GROQ_API_KEY=...
   ```
4. Run the server:
   ```bash
   uvicorn app.main:app --reload
   ```
5. Open the frontend at http://localhost:8000 to chat.

## Project Layout
See `app/` for backend modules and `frontend/` for the minimal UI.

