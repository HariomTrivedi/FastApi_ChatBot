from pathlib import Path
from typing import List

import chromadb
from chromadb.utils import embedding_functions

from app.core.config import settings
from app.schemas.document import DocumentChunk


class VectorStore:
    """
    Chroma collection wrapper. Supports local persistent and cloud modes.
    """

    def __init__(self, collection_name: str = "documents"):
        self.collection_name = collection_name
        self.client = self._init_client()
        self.embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name="all-MiniLM-L6-v2"
        )
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            embedding_function=self.embedding_fn,
        )

    def _init_client(self):
        mode = (settings.chroma_mode or "local").lower()
        if mode == "cloud" and settings.chroma_api_key and settings.chroma_tenant and settings.chroma_database:
            # Cloud client uses provided credentials
            return chromadb.CloudClient(
                api_key=settings.chroma_api_key,
                tenant=settings.chroma_tenant,
                database=settings.chroma_database,
            )
        # Default to local persistent client
        Path(settings.vector_db_dir).mkdir(parents=True, exist_ok=True)
        return chromadb.PersistentClient(path=settings.vector_db_dir)

    def add_chunks(self, doc_id: str, chunks: List[DocumentChunk]) -> None:
        ids = [f"{doc_id}-{chunk.id}" for chunk in chunks]
        texts = [chunk.content for chunk in chunks]
        metadatas = [{"doc_id": doc_id, "chunk_id": chunk.id} for chunk in chunks]
        self.collection.upsert(ids=ids, documents=texts, metadatas=metadatas)

    def similarity_search(self, query: str, k: int = 3) -> List[DocumentChunk]:
        results = self.collection.query(query_texts=[query], n_results=k)
        documents = results.get("documents", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]
        chunks: List[DocumentChunk] = []
        for content, meta in zip(documents, metadatas):
            chunks.append(
                DocumentChunk(
                    id=str(meta.get("chunk_id", "")),
                    content=content,
                )
            )
        return chunks