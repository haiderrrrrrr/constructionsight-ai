"""
Load Tests — Locust performance test suite for ConstructionSight-AI.

Simulates realistic concurrent user load across auth, project, and camera flows.

Run with:
    locust -f tests/load/locustfile.py \\
           --host=http://localhost:8000 \\
           --users=50 --spawn-rate=5 \\
           --run-time=5m \\
           --html=tests/reports/locust/report.html \\
           --headless
"""
import uuid
import random
from locust import HttpUser, task, between, events


def _random_email():
    return f"loadtest_{uuid.uuid4().hex[:10]}@loadtest.com"


class AuthUser(HttpUser):
    """Simulates authentication flows — signup, login, profile access, logout."""

    wait_time = between(1, 3)
    host = "http://localhost:8000"

    def on_start(self):
        """Log in once when the simulated user starts."""
        self._access_token = None
        self._login()

    def _login(self):
        resp = self.client.post("/auth/login", json={
            "identifier": "admin@constructionsight.ai",
            "password": "Admin123!",
        }, headers={"X-CSRFToken": "test", "Origin": "http://localhost:5173"})
        if resp.status_code == 200:
            self._access_token = resp.json().get("access_token")

    def _auth_header(self):
        return {"Authorization": f"Bearer {self._access_token}"} if self._access_token else {}

    @task(3)
    def get_profile(self):
        with self.client.get("/users/me", headers=self._auth_header(),
                             catch_response=True, name="GET /users/me") as resp:
            if resp.status_code == 401:
                self._login()
                resp.failure("Token expired — re-logged in")

    @task(1)
    def list_notifications(self):
        self.client.get("/notifications", headers=self._auth_header(),
                        name="GET /notifications")

    @task(1)
    def list_invitations(self):
        self.client.get("/invitations/me", headers=self._auth_header(),
                        name="GET /invitations/me")


class ProjectUser(HttpUser):
    """Simulates project browsing and task management."""

    wait_time = between(2, 5)
    host = "http://localhost:8000"

    def on_start(self):
        self._access_token = None
        self._project_ids = []
        self._login()
        self._load_projects()

    def _login(self):
        resp = self.client.post("/auth/login", json={
            "identifier": "admin@constructionsight.ai",
            "password": "Admin123!",
        }, headers={"X-CSRFToken": "test", "Origin": "http://localhost:5173"})
        if resp.status_code == 200:
            self._access_token = resp.json().get("access_token")

    def _auth_header(self):
        return {"Authorization": f"Bearer {self._access_token}"} if self._access_token else {}

    def _load_projects(self):
        resp = self.client.get("/projects", headers=self._auth_header(),
                               name="GET /projects (setup)")
        if resp.status_code == 200:
            self._project_ids = [p["id"] for p in resp.json()]

    @task(4)
    def list_projects(self):
        self.client.get("/projects", headers=self._auth_header(), name="GET /projects")

    @task(2)
    def get_project_detail(self):
        if self._project_ids:
            pid = random.choice(self._project_ids)
            self.client.get(f"/projects/{pid}", headers=self._auth_header(),
                            name="GET /projects/{id}")

    @task(1)
    def list_tasks(self):
        if self._project_ids:
            pid = random.choice(self._project_ids)
            self.client.get(f"/projects/{pid}/tasks", headers=self._auth_header(),
                            name="GET /projects/{id}/tasks")


class AdminUser(HttpUser):
    """Simulates admin dashboard operations — camera and user management."""

    wait_time = between(3, 8)
    host = "http://localhost:8000"

    def on_start(self):
        self._access_token = None
        self._login()

    def _login(self):
        resp = self.client.post("/auth/login", json={
            "identifier": "admin@constructionsight.ai",
            "password": "Admin123!",
        }, headers={"X-CSRFToken": "test", "Origin": "http://localhost:5173"})
        if resp.status_code == 200:
            self._access_token = resp.json().get("access_token")

    def _auth_header(self):
        return {"Authorization": f"Bearer {self._access_token}"} if self._access_token else {}

    @task(3)
    def list_cameras(self):
        self.client.get("/admin/cameras", headers=self._auth_header(),
                        name="GET /admin/cameras")

    @task(2)
    def list_admin_projects(self):
        self.client.get("/admin/projects", headers=self._auth_header(),
                        name="GET /admin/projects")

    @task(1)
    def list_users(self):
        self.client.get("/admin/users", headers=self._auth_header(),
                        name="GET /admin/users")

    @task(1)
    def user_stats(self):
        self.client.get("/admin/users/stats", headers=self._auth_header(),
                        name="GET /admin/users/stats")
