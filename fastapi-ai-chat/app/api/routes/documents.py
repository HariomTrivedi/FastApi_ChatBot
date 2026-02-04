from fastapi import APIRouter, UploadFile, File, HTTPException

from app.api.deps import RAGServiceDep
from app.schemas.document import DocumentUpload

router = APIRouter()


@router.post("/upload", response_model=DocumentUpload)
async def upload_pdf(file: UploadFile = File(...), rag_service: RAGServiceDep = None):
    if file.content_type not in ("application/pdf",):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    doc_id, chunks = await rag_service.add_document(file)
    return DocumentUpload(document_id=doc_id, chunks_indexed=len(chunks))

