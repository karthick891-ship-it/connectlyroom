from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.redis import rate_limit_ok
from app.core.security import (
    create_access_token, hash_password, hash_token, new_refresh_token, utcnow, verify_password,
)
from app.db.session import get_db
from app.models import RefreshToken, User
from app.schemas.auth import LoginIn, RefreshIn, RegisterIn

router = APIRouter(prefix="/auth", tags=["auth"])


def me_payload(u: User) -> dict:
    return {"id": u.id, "username": u.username, "email": u.email, "avatar_url": u.avatar_url}


async def issue_session(db: AsyncSession, user: User) -> dict:
    raw, hashed = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hashed,
            expires_at=utcnow() + timedelta(days=settings.refresh_token_days),
        )
    )
    await db.commit()
    return {"access_token": create_access_token(user.id), "refresh_token": raw, "user": me_payload(user)}


@router.post("/register", status_code=201)
async def register(body: RegisterIn, request: Request, db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    if not await rate_limit_ok(f"rl:register:{ip}", 10, 3600):
        raise HTTPException(429, "Too many sign-ups from this address. Try again later.")
    email = body.email.lower()
    taken = await db.scalar(select(User.id).where(or_(User.username == body.username, User.email == email)))
    if taken:
        raise HTTPException(409, "That username or email is already in use")
    user = User(username=body.username, email=email, password_hash=hash_password(body.password))
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "That username or email is already in use")
    return await issue_session(db, user)


@router.post("/login")
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    ident = body.identifier.strip()
    if not await rate_limit_ok(f"rl:login:{ip}:{ident.lower()}", 10, 60):
        raise HTTPException(429, "Too many attempts. Wait a minute and try again.")
    user = await db.scalar(select(User).where(or_(User.email == ident.lower(), User.username == ident)))
    if not user or not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "Incorrect email/username or password")
    return await issue_session(db, user)


@router.post("/refresh")
async def refresh(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    token = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(body.refresh_token)))
    if not token or token.revoked_at is not None or token.expires_at < utcnow():
        raise HTTPException(401, "Session expired. Sign in again.")
    user = await db.get(User, token.user_id)
    if not user:
        raise HTTPException(401, "Session expired. Sign in again.")
    token.revoked_at = utcnow()  # rotate
    return await issue_session(db, user)


@router.post("/logout", status_code=204)
async def logout(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    token = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(body.refresh_token)))
    if token and token.revoked_at is None:
        token.revoked_at = utcnow()
        await db.commit()


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return me_payload(user)
