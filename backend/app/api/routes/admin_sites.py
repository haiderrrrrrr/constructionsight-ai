from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ...core.db import get_db
from ...api.deps import require_admin
from ...models.user import User
from ...models.site import Site
from ...schemas.site import SiteCreate, SiteOut

router = APIRouter(prefix="/admin/sites", tags=["admin-sites"])


@router.get("", response_model=List[SiteOut])
def list_sites(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return db.query(Site).order_by(Site.name).all()


@router.post("", response_model=SiteOut, status_code=201)
def create_site(
    payload: SiteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    existing = db.query(Site).filter(Site.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="A site with this name already exists")
    site = Site(
        name=payload.name,
        location=payload.location,
        created_by=current_user.id,
    )
    db.add(site)
    db.commit()
    db.refresh(site)
    return site
