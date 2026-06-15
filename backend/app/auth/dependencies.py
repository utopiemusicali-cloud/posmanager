from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import decode_token, get_user_by_id
from app.database import get_main_db
from app.models.user import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    main_db: AsyncSession = Depends(get_main_db),
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token non valido o scaduto",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_token(token)
    if not payload:
        raise credentials_exc
    user_id: int | None = payload.get("uid")
    if user_id is None:
        raise credentials_exc
    user = await get_user_by_id(main_db, user_id)
    if not user or not user.is_active:
        raise credentials_exc
    # Imposta il DB aziendale sull'oggetto (attributo non mappato su DB)
    user._company_db = payload.get("cdb") or None
    return user


# ── Role guards ───────────────────────────────────────────────────────────────
def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in (UserRole.superadmin, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Richiesto ruolo admin")
    return current_user


def require_not_viewer(current_user: User = Depends(get_current_user)) -> User:
    """Blocca il ruolo viewer (sola lettura): usato su endpoint di scrittura."""
    if current_user.role == UserRole.viewer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso in sola lettura")
    return current_user


def require_superadmin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo superadmin")
    return current_user
