from pydantic import BaseModel


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    username: str | None = None


class UserRead(BaseModel):
    id: int
    username: str
    display_name: str | None
    is_active: bool

    model_config = {"from_attributes": True}
