"""
Factory-boy model factories for creating test data concisely.

Usage:
    from tests.factories import UserFactory, ProjectFactory
    user = UserFactory(db=session)
    project = ProjectFactory(db=session, created_by=user.id)
"""
import factory
from factory.alchemy import SQLAlchemyModelFactory
from faker import Faker

from app.models.user import User, PlatformRole
from app.models.project import Project, ProjectStatus
from app.models.site import Site
from app.models.project_invitation import ProjectInvitation, InvitationStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
from app.models.camera import Camera, RegistryStatus
from app.models.notification import Notification
from app.models.project_report import ProjectReport, ReportStatus
from app.core.security import get_password_hash

fake = Faker()


class BaseFactory(SQLAlchemyModelFactory):
    class Meta:
        abstract = True
        sqlalchemy_session_persistence = "flush"

    @classmethod
    def _create(cls, model_class, *args, **kwargs):
        db = kwargs.pop('db', None)
        if db is not None:
            cls._meta.sqlalchemy_session = db
        return super()._create(model_class, *args, **kwargs)


class UserFactory(BaseFactory):
    class Meta:
        model = User

    full_name = factory.LazyFunction(fake.name)
    email = factory.LazyFunction(fake.unique.email)
    username = factory.LazyFunction(lambda: fake.unique.user_name()[:30])
    password_hash = factory.LazyFunction(lambda: get_password_hash("TestPass123!"))
    platform_role = PlatformRole.USER
    is_approved = True
    is_active = True
    token_version = 1
    auth_provider = "local"
    theme_skin = "dark"
    failed_login_count = 0


class AdminFactory(UserFactory):
    platform_role = PlatformRole.ADMIN
    email = factory.LazyFunction(fake.unique.email)
    username = factory.LazyFunction(lambda: f"admin_{fake.unique.user_name()[:25]}")


class SiteFactory(BaseFactory):
    class Meta:
        model = Site

    name = factory.LazyFunction(fake.company)
    location = factory.LazyFunction(fake.city)
    created_by = None  # must be provided


class ProjectFactory(BaseFactory):
    class Meta:
        model = Project

    name = factory.LazyFunction(fake.company)
    location = factory.LazyFunction(fake.city)
    description = factory.LazyFunction(fake.sentence)
    status = ProjectStatus.DRAFT
    created_by = None   # must be provided
    site_id = None      # must be provided


class ProjectInvitationFactory(BaseFactory):
    class Meta:
        model = ProjectInvitation

    email = factory.LazyFunction(fake.unique.email)
    invited_name = factory.LazyFunction(fake.name)
    project_id = None   # must be provided
    role = ProjectRole.PROJECT_MANAGER
    token = factory.LazyFunction(lambda: fake.unique.uuid4())
    expires_at = factory.LazyFunction(
        lambda: __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        + __import__("datetime").timedelta(days=7)
    )
    invited_by = None   # must be provided
    status = InvitationStatus.PENDING


class ProjectMembershipFactory(BaseFactory):
    class Meta:
        model = ProjectMembership

    user_id = None      # must be provided
    project_id = None   # must be provided
    project_role = ProjectRole.PROJECT_MANAGER
    status = MembershipStatus.ACTIVE
    invited_by = None   # must be provided


class CameraFactory(BaseFactory):
    class Meta:
        model = Camera

    name = factory.LazyFunction(lambda: f"{fake.company()} Cam")
    vendor = factory.LazyFunction(lambda: fake.company())
    model = factory.LazyFunction(lambda: f"Model-{fake.bothify('??-###')}")
    serial_number = factory.LazyFunction(lambda: fake.unique.bothify("SN-########"))
    onvif_supported = False
    ptz_supported = False
    connection_type = "rtsp"
    registry_status = RegistryStatus.draft
    site_id = None      # must be provided
    created_by = None   # must be provided


class NotificationFactory(BaseFactory):
    class Meta:
        model = Notification

    user_id = None      # must be provided
    type = "system_alert"
    title = factory.LazyFunction(fake.sentence)
    message = factory.LazyFunction(fake.paragraph)
    is_read = False
    category = "general"
    priority = "medium"


class ProjectReportFactory(BaseFactory):
    class Meta:
        model = ProjectReport

    project_id = None   # must be provided
    report_type = "ppe"
    period_label = factory.LazyFunction(lambda: f"2025-W{fake.random_int(1, 52):02d}")
    period_start = factory.LazyFunction(
        lambda: __import__("datetime").date(2025, 1, 1)
    )
    period_end = factory.LazyFunction(
        lambda: __import__("datetime").date(2025, 1, 31)
    )
    status = ReportStatus.READY
    frequency = "weekly"
    triggered_by = "manual"
    triggered_by_user_id = None
