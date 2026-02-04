from pydantic import BaseModel


class DocumentChunk(BaseModel):
    id: str
    content: str


class DocumentUpload(BaseModel):
    document_id: str
    chunks_indexed: int
    message: str = "Document ingested successfully"

