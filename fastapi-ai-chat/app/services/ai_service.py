import asyncio
from typing import AsyncGenerator, List

import google.generativeai as genai

from app.core.config import Settings
from app.schemas.chat import ChatMessage


class AIService:
    """
    Simple LLM wrapper.
    - Uses Gemini if GEMINI_API_KEY is set.
    - Falls back to fake streaming otherwise.
    TODO: Add OpenAI/Groq streaming implementations.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.use_gemini = bool(settings.gemini_api_key)
        self.gemini_model = settings.gemini_model
        if self.use_gemini:
            genai.configure(api_key=settings.gemini_api_key)
            self.gemini_client = genai.GenerativeModel(self.gemini_model)
        else:
            self.gemini_client = None

    async def generate(self, message: ChatMessage) -> str:
        if self.gemini_client:
            # Non-streaming fallback for synchronous usage
            resp = await asyncio.to_thread(self.gemini_client.generate_content, message.content)
            return resp.text or ""
        return f"Echo: {message.content}"

    async def ai_stream_response(self, message: ChatMessage) -> AsyncGenerator[str, None]:
        if self.gemini_client:
            async for token in self._stream_gemini(message.content):
                yield token
            return
        # Fake streaming: emit one word at a time
        words = message.content.split()
        if not words:
            yield "..."
            return
        for word in words:
            await asyncio.sleep(0.05)
            yield word + " "
        yield "\n"

    async def _stream_gemini(self, prompt: str) -> AsyncGenerator[str, None]:
        """
        Stream tokens from Gemini. The library is sync, so run in a thread
        and yield chunks asynchronously.
        """
        def _collect_tokens() -> List[str]:
            tokens: List[str] = []
            for chunk in self.gemini_client.generate_content(prompt, stream=True):
                if chunk.text:
                    tokens.append(chunk.text)
            return tokens

        tokens = await asyncio.to_thread(_collect_tokens)
        for tok in tokens:
            yield tok

