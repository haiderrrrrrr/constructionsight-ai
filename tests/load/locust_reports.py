"""
Load Tests — Report generation and listing performance test.

Simulates concurrent PM users generating and listing project reports.

Run with:
    locust -f tests/load/locust_reports.py \\
           --host=http://localhost:8000 \\
           --users=10 --spawn-rate=1 \\
           --run-time=5m \\
           --html=tests/accessories/reports/locust/reports_report.html \\
           --headless

SLA targets:
    - POST /projects/{id}/reports/export: p95 < 30s
    - GET  /projects/{id}/reports:         p95 < 1s
    - GET  /projects/{id}/reports/{id}:    p95 < 500ms
"""
import random
import time
from locust import HttpUser, task, between


class ReportUser(HttpUser):
    """
    Simulates a PM generating and checking project reports.

    on_start: logs in and picks an active project.
    Tasks: generate report (slow, weight 1), list reports (weight 3).
    """

    wait_time = between(10, 30)  # Report generation is resource-intensive

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
            self._access_token = resp.json().get("access_token")

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

    @task(1)
    def generate_report(self):
        """Trigger a report export and poll until it leaves generating state."""
        if not self._project_id:
            return

        # Trigger generation
        with self.client.post(
            f"/projects/{self._project_id}/reports/export",
            json={
                "report_type": "ppe",
                "start_date": "2025-01-01",
                "end_date": "2025-01-31",
            },
            headers=self._auth_header(),
            catch_response=True,
            timeout=60,
            name="POST /projects/{id}/reports/export",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")
                return
            if resp.status_code not in (200, 202):
                # 400/422 are acceptable (date validation etc.) — not a perf failure
                return

            # If we got a report id, poll its status
            report_id = None
            try:
                data = resp.json()
                report_id = data.get("id") or data.get("report_id")
            except Exception:
                pass

        if report_id:
            # Poll until ready (max 10 iterations)
            for _ in range(10):
                time.sleep(2)
                status_resp = self.client.get(
                    f"/projects/{self._project_id}/reports/{report_id}",
                    headers=self._auth_header(),
                    name="GET /projects/{id}/reports/{report_id} (poll)",
                )
                if status_resp.status_code == 200:
                    status = status_resp.json().get("status", "")
                    if status != "generating":
                        break

    @task(3)
    def list_reports(self):
        """List reports for the project — should be fast (DB query)."""
        if not self._project_id:
            return
        with self.client.get(
            f"/projects/{self._project_id}/reports",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /projects/{id}/reports",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    @task(2)
    def list_reports_paginated(self):
        """List reports with pagination parameters."""
        if not self._project_id:
            return
        page = random.randint(1, 3)
        with self.client.get(
            f"/projects/{self._project_id}/reports?page={page}&per_page=10",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /projects/{id}/reports?page={n}",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")
