import uuid
from typing import List, Tuple

from fastapi import UploadFile

from app.db.vector_db import VectorStore
from app.schemas.document import DocumentChunk
from app.utils.file_utils import save_upload_to_disk, extract_pdf_text
from app.utils.text_utils import chunk_text


class RAGService:
    """
    Handles ingest and retrieval over a persistent ChromaDB vector store.
    """

    def __init__(self):
        self.store = VectorStore()

    async def add_document(self, file: UploadFile) -> Tuple[str, List[DocumentChunk]]:
        # Save upload for traceability
        saved_path = await save_upload_to_disk(file)
        raw_text = extract_pdf_text(saved_path)
        chunks = [DocumentChunk(id=str(i), content=chunk) for i, chunk in enumerate(chunk_text(raw_text))]
        doc_id = str(uuid.uuid4())
        self.store.add_chunks(doc_id, chunks)
        return doc_id, chunks

    def search(self, query: str, limit: int = 3) -> List[DocumentChunk]:
        return self.store.similarity_search(query, k=limit)

