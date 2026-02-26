"""
Load Tests — Analytics endpoints performance test.

Simulates concurrent reads across all analytics dimensions for an active project.

Run with:
    locust -f tests/load/locust_analytics.py \\
           --host=http://localhost:8000 \\
           --users=100 --spawn-rate=10 \\
           --run-time=5m \\
           --html=tests/accessories/reports/locust/analytics_report.html \\
           --headless

SLA targets:
    - GET /projects/{id}/analytics/*/summary: p95 < 2s
    - GET /projects/{id}/analytics/*/live:    p95 < 1s
"""
import random
from locust import HttpUser, task, between


class AnalyticsUser(HttpUser):
    """
    Simulates a project member (PM or analyst) reading analytics dashboards.

    on_start: logs in as the test admin user and picks an active project.
    Each task reads a different analytics dimension or live snapshot.
    """

    wait_time = between(1, 3)

    def on_start(self):
        self._access_token = None
        self._project_id = None
        self._login_and_pick_project()

    def _login_and_pick_project(self):
        resp = self.client.post(
            "/auth/login",
            json={
                "identifier": "admin@constructionsight.ai",
                "password": "Admin123!",
            },
            headers={"Origin": "http://localhost:5173"},
        )
        if resp.status_code == 200:
            data = resp.json()
            self._access_token = data.get("access_token")

        # Pick the first active project
        if self._access_token:
            projects_resp = self.client.get(
                "/projects",
                headers=self._auth_header(),
                name="GET /projects (setup)",
            )
            if projects_resp.status_code == 200:
                projects = projects_resp.json()
                active = [p for p in projects if p.get("status") == "active"]
                if active:
                    self._project_id = active[0]["id"]

    def _auth_header(self):
        return {"Authorization": f"Bearer {self._access_token}"} if self._access_token else {}

    def _re_login(self):
        self._login_and_pick_project()

    # ── Activity analytics ──────────────────────────────────────────────────
    @task(5)
    def read_activity_summary(self):
        if not self._project_id:
            return
        with self.client.get(
            f"/projects/{self._project_id}/analytics/activity/summary",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /projects/{id}/analytics/activity/summary",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    @task(2)
    def read_activity_live(self):
        if not self._project_id:
            return
        with self.client.get(
            f"/projects/{self._project_id}/activity/live",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /projects/{id}/activity/live",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    # ── Workforce analytics ─────────────────────────────────────────────────
    @task(5)
    def read_workforce_summary(self):
        if not self._project_id:
            return
        with self.client.get(
            f"/projects/{self._project_id}/analytics/workforce/summary",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /projects/{id}/analytics/workforce/summary",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    @task(2)
    def read_workforce_live(self):
        if not self._project_id:
            return
        with self.client.get(
            f"/projects/{self._project_id}/workforce/live",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /projects/{id}/workforce/live",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    # ── PPE analytics ───────────────────────────────────────────────────────
    @task(3)
    def read_ppe_incidents(self):
        if not self._project_id:
            return
        with self.client.get(
            f"/projects/{self._project_id}/analytics/ppe/incidents",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /projects/{id}/analytics/ppe/incidents",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    # ── Equipment analytics ─────────────────────────────────────────────────
    @task(3)
    def read_equipment_summary(self):
        if not self._project_id:
            return
        with self.client.get(
            f"/projects/{self._project_id}/analytics/equipment/summary",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /projects/{id}/analytics/equipment/summary",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    # ── Risk analytics ──────────────────────────────────────────────────────
    @task(2)
    def read_risk_summary(self):
        if not self._project_id:
            return
        with self.client.get(
            f"/projects/{self._project_id}/analytics/risk/summary",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /projects/{id}/analytics/risk/summary",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")
