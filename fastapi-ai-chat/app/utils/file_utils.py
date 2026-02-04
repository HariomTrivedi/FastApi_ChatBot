import os
import uuid
from pathlib import Path
from typing import Union, Tuple
from datetime import datetime

from fastapi import UploadFile, HTTPException, status
from pypdf import PdfReader

from app.core.config import settings


# Allowed image MIME types
ALLOWED_IMAGE_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/gif", 
    "image/webp", "image/bmp", "image/svg+xml"
}

# Allowed file extensions (for general files)
ALLOWED_FILE_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".txt", ".csv", ".xls", ".xlsx",
    ".ppt", ".pptx", ".zip", ".rar", ".7z", ".tar", ".gz",
    ".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv", ".webm", ".m4v", ".mpg", ".mpeg",
    ".mp3", ".wav", ".aac", ".flac", ".m4a", ".wma", ".ogg"
}

# Maximum file sizes (in bytes)
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_FILE_SIZE = 50 * 1024 * 1024   # 50 MB


def is_image_file(mime_type: str) -> bool:
    """Check if the file is an image based on MIME type"""
    return mime_type in ALLOWED_IMAGE_TYPES


def is_allowed_file(filename: str) -> bool:
    """Check if the file extension is allowed"""
    ext = Path(filename).suffix.lower()
    return ext in ALLOWED_FILE_EXTENSIONS


async def validate_file(file: UploadFile, is_image: bool = False) -> Tuple[str, int]:
    """
    Validate uploaded file.
    Returns (mime_type, file_size)
    Raises HTTPException if validation fails.
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename is required"
        )
    
    # Read file content to get size
    contents = await file.read()
    file_size = len(contents)
    
    # Reset file pointer
    await file.seek(0)
    
    # Get MIME type
    mime_type = file.content_type or "application/octet-stream"
    
    if is_image:
        # Validate image
        if not is_image_file(mime_type):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid image type. Allowed types: {', '.join(ALLOWED_IMAGE_TYPES)}"
            )
        if file_size > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Image size exceeds maximum allowed size of {MAX_IMAGE_SIZE / (1024*1024)} MB"
            )
    else:
        # Validate general file
        if not is_allowed_file(file.filename):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File type not allowed. Allowed extensions: {', '.join(ALLOWED_FILE_EXTENSIONS)}"
            )
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File size exceeds maximum allowed size of {MAX_FILE_SIZE / (1024*1024)} MB"
            )
    
    return mime_type, file_size


async def save_chat_file(file: UploadFile, user_id: int, is_image: bool = False) -> Tuple[Path, str, int]:
    """
    Save uploaded file for chat messages.
    Files are organized by type (images/files) and user.
    Returns (file_path, mime_type, file_size)
    """
    # Validate file
    mime_type, file_size = await validate_file(file, is_image)
    
    # Create directory structure: uploads/chat/{images|files}/{user_id}/
    base_dir = Path(settings.uploads_dir) / "chat"
    subdir = "images" if is_image else "files"
    user_dir = base_dir / subdir / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate unique filename to avoid conflicts
    file_ext = Path(file.filename).suffix
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    target_path = user_dir / unique_filename
    
    # Save file
    contents = await file.read()
    target_path.write_bytes(contents)
    
    return target_path, mime_type, file_size


async def save_upload_to_disk(file: UploadFile) -> Path:
    """
    Persist the uploaded file under the configured uploads directory.
    """
    uploads_dir = Path(settings.uploads_dir)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    filename = file.filename or "upload.pdf"
    target = uploads_dir / filename
    contents = await file.read()
    target.write_bytes(contents)
    return target


def extract_pdf_text(path: Union[str, Path]) -> str:
    """
    Extract text from a PDF file using pypdf.
    """
    reader = PdfReader(str(path))
    text_parts = []
    for page in reader.pages:
        text_parts.append(page.extract_text() or "")
    return "\n".join(text_parts)

