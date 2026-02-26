"""
Load Tests — Camera management performance test.

Simulates concurrent admin users listing and verifying cameras.

Run with:
    locust -f tests/load/locust_camera.py \\
           --host=http://localhost:8000 \\
           --users=20 --spawn-rate=3 \\
           --run-time=5m \\
           --html=tests/accessories/reports/locust/camera_report.html \\
           --headless

SLA targets:
    - GET /admin/cameras:          p95 < 1s
    - GET /admin/cameras/health:   p95 < 500ms
    - POST /admin/cameras/{id}/verify: p95 < 5s
"""
import random
from locust import HttpUser, task, between


class CameraVerifyUser(HttpUser):
    """
    Simulates an admin user managing camera registry.

    on_start: logs in as admin and fetches the camera list.
    Tasks: list cameras (weight 5), check health summary (weight 3),
           verify a random camera (weight 1).
    """

    wait_time = between(2, 5)

    def on_start(self):
        self._access_token = None
        self._camera_ids = []
        self._login_and_fetch_cameras()

    def _login_and_fetch_cameras(self):
        resp = self.client.post(
            "/auth/login",
            json={
                "identifier": "admin@constructionsight.ai",
                "password": "Admin123!",
            },
            headers={"Origin": "http://localhost:5173"},
        )
        if resp.status_code == 200:
            self._access_token = resp.json().get("access_token")

        if self._access_token:
            cameras_resp = self.client.get(
                "/admin/cameras",
                headers=self._auth_header(),
                name="GET /admin/cameras (setup)",
            )
            if cameras_resp.status_code == 200:
                cameras = cameras_resp.json()
                self._camera_ids = [c["id"] for c in cameras if "id" in c]

    def _auth_header(self):
        return {"Authorization": f"Bearer {self._access_token}"} if self._access_token else {}

    def _re_login(self):
        self._login_and_fetch_cameras()

    @task(5)
    def list_cameras(self):
        """List all cameras — high-frequency read."""
        with self.client.get(
            "/admin/cameras",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /admin/cameras",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    @task(3)
    def get_camera_health_summary(self):
        """Check camera health dashboard — lightweight aggregation."""
        with self.client.get(
            "/admin/cameras/health",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /admin/cameras/health",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    @task(2)
    def get_scheduler_status(self):
        """Check camera health check scheduler status."""
        with self.client.get(
            "/admin/cameras/scheduler/status",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /admin/cameras/scheduler/status",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    @task(1)
    def verify_camera(self):
        """Trigger health verification on a random camera — triggers RTSP probe."""
        if not self._camera_ids:
            return
        camera_id = random.choice(self._camera_ids)
        with self.client.post(
            f"/admin/cameras/{camera_id}/verify",
            headers=self._auth_header(),
            catch_response=True,
            timeout=10,
            name="POST /admin/cameras/{id}/verify",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")
            elif resp.status_code not in (200, 404):
                resp.failure(f"Unexpected status: {resp.status_code}")

    @task(1)
    def get_single_camera(self):
        """Fetch a single camera's details."""
        if not self._camera_ids:
            return
        camera_id = random.choice(self._camera_ids)
        with self.client.get(
            f"/admin/cameras/{camera_id}",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /admin/cameras/{id}",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")
