"""
Load Test Scenario — Camera Registry Flow

Simulates admin monitoring camera health: list cameras, get individual
camera detail, check registry status. Models camera dashboard usage.
"""
import random
from locust import TaskSet, task


class CameraScenario(TaskSet):
    """
    Camera scenario: list cameras → get camera detail → check credentials.
    Read-heavy; reflects admin dashboards polling camera status.
    """

    def on_start(self):
        self._token = None
        self._camera_ids = []
        self._do_login()
        self._load_cameras()

    def _do_login(self):
        resp = self.client.post("/auth/login", json={
            "identifier": "admin@constructionsight.ai",
            "password": "Admin123!",
        }, headers={"X-CSRFToken": "test", "Origin": "http://localhost:5173"},
            name="CAM: login")
        if resp.status_code == 200:
            self._token = resp.json().get("access_token")

    def _headers(self):
        return {"Authorization": f"Bearer {self._token}"} if self._token else {}

    def _load_cameras(self):
        resp = self.client.get("/admin/cameras", headers=self._headers(),
                               name="CAM: GET /admin/cameras (init)")
        if resp.status_code == 200:
            self._camera_ids = [c["id"] for c in resp.json()]

    @task(5)
    def list_cameras(self):
        resp = self.client.get("/admin/cameras", headers=self._headers(),
                               name="CAM: GET /admin/cameras")
        if resp.status_code == 200:
            self._camera_ids = [c["id"] for c in resp.json()]

    @task(3)
    def get_camera_detail(self):
        if not self._camera_ids:
            return
        cid = random.choice(self._camera_ids)
        self.client.get(f"/admin/cameras/{cid}", headers=self._headers(),
                        name="CAM: GET /admin/cameras/{id}")

    @task(1)
    def check_admin_projects_for_camera_context(self):
        self.client.get("/admin/projects", headers=self._headers(),
                        name="CAM: GET /admin/projects")
