from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_admin
from app.auth.service import hash_password
from app.database import get_main_db
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/v1/users", tags=["users"])


class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    role: str = UserRole.operator


class UserUpdate(BaseModel):
    display_name: str | None = None
    role: str | None = None
    is_active: bool | None = None


class ChangePassword(BaseModel):
    new_password: str


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str | None
    role: str
    is_active: bool
    company_id: int | None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[UserOut])
async def list_users(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_main_db),
):
    result = await db.execute(
        select(User)
        .where(User.company_id == current_user.company_id)
        .order_by(User.id)
    )
    return result.scalars().all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_main_db),
):
    existing = (await db.execute(
        select(User).where(User.username == body.username)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Username già in uso")
    user = User(
        company_id=current_user.company_id,
        username=body.username,
        hashed_password=hash_password(body.password),
        display_name=body.display_name,
        role=body.role,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_main_db),
):
    user = (await db.execute(
        select(User).where(User.id == user_id, User.company_id == current_user.company_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    await db.flush()
    await db.refresh(user)
    return user


@router.post("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    user_id: int,
    body: ChangePassword,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_main_db),
):
    user = (await db.execute(
        select(User).where(User.id == user_id, User.company_id == current_user.company_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    user.hashed_password = hash_password(body.new_password)
    await db.flush()
