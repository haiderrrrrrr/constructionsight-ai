from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, UniqueConstraint, func
from ..core.db import Base


class Zone(Base):
    """
    An operational zone within a site (e.g. 'North Scaffold', 'Entry Checkpoint').

    Site-level zoning is logical — it describes real-world areas within the site.
    A site can have multiple zones. Zone management at this level is shared
    across all cameras that might cover that area.

    Note: camera-level zoning is visual (CameraZonePolygon). In Phase 1, full zone
    management lives in camera_zone_polygons. A dedicated site_zones reference table
    can be promoted to a source-of-truth later if cross-camera zone standardization
    is required.
    """
    __tablename__ = "zones"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(String(500), nullable=True)
    # Optional: classify zone type for AI model routing (e.g. 'scaffold', 'entry', 'storage')
    zone_type = Column(String(100), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("site_id", "name", name="uq_zone_site_name"),
    )


class CameraZonePolygon(Base):
    """
    A camera-specific zone polygon — the visual region on a camera's frame that
    corresponds to a site zone.

    Key rules:
    - One camera can have multiple active zone polygons (one per zone it covers).
    - Different cameras in the same site may define polygons for different subsets
      of that site's zones (partial coverage is valid).
    - Two cameras may define different polygons for the same real-world site zone
      (e.g. an overlap area seen from two angles).
    - Renaming or editing a zone polygon on one camera does NOT affect other cameras'
      polygons for the same zone.
    - Together, all active polygons on a camera represent the portions of the site
      visible in that camera's feed.

    `points` is a JSON array of {x, y} normalised to [0, 1] of frame dimensions:
        [{"x": 0.1, "y": 0.2}, {"x": 0.5, "y": 0.2}, ...]
    """
    __tablename__ = "camera_zone_polygons"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"), nullable=False, index=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=False, index=True)
    # JSON array of {x, y} normalised 0-1 coordinates
    points = Column(Text, nullable=True)
    label = Column(String(200), nullable=True)
    # Optional: zone category / type override for this polygon (e.g. 'exclusion', 'ppe_required')
    zone_category = Column(String(100), nullable=True)
    is_active = Column(Integer, default=1, nullable=False)   # 1 = active, 0 = soft-disabled
    version = Column(Integer, default=1, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
