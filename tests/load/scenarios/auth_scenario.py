"""
Load Test Scenario — Authentication Flow

Simulates high-frequency login and token refresh cycles under load.
Used as a standalone TaskSet or imported into locustfile.py.
"""
import uuid
from locust import TaskSet, task, between


def _random_email():
    return f"auth_load_{uuid.uuid4().hex[:8]}@loadtest.com"


class AuthScenario(TaskSet):
    """
    Authentication scenario: login → get profile → refresh → logout.
    Models a session lifecycle from start to finish.
    """

    def on_start(self):
        self._token = None
        self._do_login()

    def _do_login(self):
        resp = self.client.post("/auth/login", json={
            "identifier": "admin@constructionsight.ai",
            "password": "Admin123!",
        }, headers={"X-CSRFToken": "test", "Origin": "http://localhost:5173"},
            name="AUTH: login")
        if resp.status_code == 200:
            self._token = resp.json().get("access_token")

    def _headers(self):
        return {"Authorization": f"Bearer {self._token}"} if self._token else {}

    @task(5)
    def get_own_profile(self):
        with self.client.get("/users/me", headers=self._headers(),
                             catch_response=True, name="AUTH: GET /users/me") as resp:
            if resp.status_code == 401:
                self._do_login()
                resp.failure("Session expired")

    @task(2)
    def attempt_token_refresh(self):
        self.client.post("/auth/refresh",
                         headers={"X-CSRFToken": "test", "Origin": "http://localhost:5173"},
                         name="AUTH: POST /auth/refresh")

    @task(1)
    def logout_and_relogin(self):
        self.client.post("/auth/logout",
                         headers={**self._headers(),
                                  "X-CSRFToken": "test",
                                  "Origin": "http://localhost:5173"},
                         name="AUTH: POST /auth/logout")
        self._token = None
        self._do_login()
