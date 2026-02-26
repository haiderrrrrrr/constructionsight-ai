from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SiteCreate(BaseModel):
    name: str
    location: Optional[str] = None


class SiteOut(BaseModel):
    id: int
    name: str
    location: Optional[str] = None
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True
