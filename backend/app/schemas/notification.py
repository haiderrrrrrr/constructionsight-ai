from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class NotificationOut(BaseModel):
    id:         int
    type:       str
    title:      str
    message:    str
    camera_id:  Optional[int] = None
    project_id: Optional[int] = None
    task_id:    Optional[int] = None
    category:   Optional[str] = None
    priority:   Optional[str] = None
    action_url: Optional[str] = None
    is_read:    bool
    created_at: datetime

    model_config = {"from_attributes": True}
