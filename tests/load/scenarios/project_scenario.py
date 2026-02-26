"""
Load Test Scenario — Project Management Flow

Simulates a PM browsing projects, reading tasks, checking notes, and
updating task status. Models typical read-heavy project usage.
"""
import random
from locust import TaskSet, task


class ProjectScenario(TaskSet):
    """
    Project management scenario: list projects → view detail → list tasks → list notes.
    """

    def on_start(self):
        self._token = None
        self._project_ids = []
        self._do_login()
        self._load_projects()

    def _do_login(self):
        resp = self.client.post("/auth/login", json={
            "identifier": "admin@constructionsight.ai",
            "password": "Admin123!",
        }, headers={"X-CSRFToken": "test", "Origin": "http://localhost:5173"},
            name="PROJ: login")
        if resp.status_code == 200:
            self._token = resp.json().get("access_token")

    def _headers(self):
        return {"Authorization": f"Bearer {self._token}"} if self._token else {}

    def _load_projects(self):
        resp = self.client.get("/projects", headers=self._headers(),
                               name="PROJ: GET /projects (init)")
        if resp.status_code == 200:
            self._project_ids = [p["id"] for p in resp.json()]

    @task(4)
    def list_projects(self):
        resp = self.client.get("/projects", headers=self._headers(),
                               name="PROJ: GET /projects")
        if resp.status_code == 200:
            self._project_ids = [p["id"] for p in resp.json()]

    @task(3)
    def view_project_detail(self):
        if not self._project_ids:
            return
        pid = random.choice(self._project_ids)
        self.client.get(f"/projects/{pid}", headers=self._headers(),
                        name="PROJ: GET /projects/{id}")

    @task(2)
    def list_project_tasks(self):
        if not self._project_ids:
            return
        pid = random.choice(self._project_ids)
        self.client.get(f"/projects/{pid}/tasks", headers=self._headers(),
                        name="PROJ: GET /projects/{id}/tasks")

    @task(1)
    def list_project_notes(self):
        if not self._project_ids:
            return
        pid = random.choice(self._project_ids)
        self.client.get(f"/projects/{pid}/notes", headers=self._headers(),
                        name="PROJ: GET /projects/{id}/notes")

    @task(1)
    def list_project_members(self):
        if not self._project_ids:
            return
        pid = random.choice(self._project_ids)
        self.client.get(f"/projects/{pid}/members", headers=self._headers(),
                        name="PROJ: GET /projects/{id}/members")
