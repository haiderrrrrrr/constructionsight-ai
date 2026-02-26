"""
Load Tests — Smart Query AI assistant performance test.

Simulates concurrent PM users asking realistic questions to the AI assistant.

Run with:
    locust -f tests/load/locust_smart_query.py \\
           --host=http://localhost:8000 \\
           --users=20 --spawn-rate=2 \\
           --run-time=5m \\
           --html=tests/accessories/reports/locust/smart_query_report.html \\
           --headless

SLA targets:
    - POST /smart-query/ask: p95 < 30s (Ollama LLM calls are slow)
    - GET  /smart-query/history: p95 < 500ms
    - GET  /smart-query/suggestions: p95 < 500ms
"""
import random
from locust import HttpUser, task, between

# Realistic questions that a PM might ask on a construction site
REALISTIC_QUESTIONS = [
    "How many workers were on site yesterday?",
    "What PPE violations occurred in the last week?",
    "Which cameras detected the most incidents this month?",
    "Show me the risk score trend for the last 30 days.",
    "How many helmet violations were recorded today?",
    "Which zones had the highest workforce density?",
    "What is the current safety compliance rate?",
    "List all unresolved PPE incidents from this week.",
    "How does this week's workforce compare to last week?",
    "What equipment was most active on site this month?",
]


class SmartQueryUser(HttpUser):
    """
    Simulates a PM user interacting with the Smart Query AI assistant.

    on_start: logs in and picks an active project.
    Tasks: ask AI questions (slow, weight 1), read history (weight 2),
           get suggestions (weight 3).
    """

    wait_time = between(5, 15)  # Ollama LLM responses are slow — longer wait

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
    def ask_question(self):
        """Send a realistic question to the AI assistant."""
        if not self._project_id:
            return
        question = random.choice(REALISTIC_QUESTIONS)
        with self.client.post(
            "/smart-query/ask",
            json={"question": question, "project_id": self._project_id},
            headers=self._auth_header(),
            catch_response=True,
            timeout=60,  # Ollama can be slow
            name="POST /smart-query/ask",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")
            elif resp.status_code not in (200, 503):
                resp.failure(f"Unexpected status: {resp.status_code}")

    @task(2)
    def get_history(self):
        """Read query history — lightweight, should be fast."""
        if not self._project_id:
            return
        with self.client.get(
            f"/smart-query/history?project_id={self._project_id}",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /smart-query/history",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    @task(3)
    def get_suggestions(self):
        """Get question suggestions — should be cached and fast."""
        if not self._project_id:
            return
        with self.client.get(
            f"/smart-query/suggestions?project_id={self._project_id}",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /smart-query/suggestions",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")

    @task(1)
    def get_status(self):
        """Check Ollama + FAISS system status."""
        with self.client.get(
            "/smart-query/status",
            headers=self._auth_header(),
            catch_response=True,
            name="GET /smart-query/status",
        ) as resp:
            if resp.status_code == 401:
                self._re_login()
                resp.failure("Token expired")
