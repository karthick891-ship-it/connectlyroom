from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.services import presence
from app.services.chat import public_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
async def search_users(q: str = Query("", max_length=50), me: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    q = q.strip()
    if not q:
        return []
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = await db.scalars(
        select(User).where(User.id != me.id, User.username.like(f"%{escaped}%", escape="\\")).order_by(User.username).limit(20)
    )
    return [public_user(u) for u in rows]


@router.get("/online")
async def online(ids: str = Query("", max_length=2000), _: User = Depends(get_current_user)):
    parsed = [int(i) for i in ids.split(",") if i.strip().isdigit()][:500]
    return {"online": await presence.online_ids(parsed)}
