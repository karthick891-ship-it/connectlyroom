import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.api.deps import get_current_user
from app.core.config import settings
from app.models import User

router = APIRouter(prefix="/uploads", tags=["uploads"])

# The stored extension comes from the MIME type, never from the client's file name.
ALLOWED = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "application/zip": ".zip",
}


@router.post("", status_code=201)
async def upload(file: UploadFile = File(...), _: User = Depends(get_current_user)):
    ext = ALLOWED.get(file.content_type or "")
    if not ext:
        raise HTTPException(415, "This file type is not allowed. Use an image, PDF, text file or zip.")
    limit = settings.max_upload_mb * 1024 * 1024
    name = f"{uuid.uuid4().hex}{ext}"
    dest = Path(settings.upload_dir) / name
    size = 0
    try:
        with dest.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"Files are limited to {settings.max_upload_mb} MB")
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    return {
        "url": f"/files/{name}",
        "mime_type": file.content_type,
        "size_bytes": size,
        "filename": (file.filename or name)[:255],
    }
