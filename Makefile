# ConstructionSight-AI — Enterprise Test Runner
# Requires: GNU Make, Python venv activated, allure CLI installed
#
# Usage:
#   make test-all            # Full suite: backend + frontend + e2e + allure
#   make test-backend        # Backend only (no load tests)
#   make test-unit           # Unit tests only
#   make test-integration    # Integration tests only
#   make test-security       # Security tests only
#   make test-smoke          # Smoke tests only
#   make test-contract       # Contract/fuzz tests only
#   make test-coverage       # 100% strict coverage run
#   make test-load           # Main load test (headless)
#   make test-load-analytics # Analytics load test
#   make test-load-smart-query  # Smart Query load test
#   make test-load-reports   # Report generation load test
#   make test-load-cameras   # Camera verify load test
#   make test-frontend       # Frontend Vitest unit tests
#   make test-e2e            # Playwright E2E tests
#   make allure-open         # Merge + open Allure dashboard
#   make coverage-open       # Open HTML coverage report
#   make clean-reports       # Remove all report directories

BACKEND_DIR      := backend
TESTS_DIR        := tests
FRONTEND_DIR     := frontend
ALLURE_BACKEND   := $(TESTS_DIR)/accessories/reports/allure-results
ALLURE_FRONTEND  := $(FRONTEND_DIR)/allure-results
ALLURE_MERGED    := $(TESTS_DIR)/accessories/reports/allure-merged
ALLURE_REPORT    := $(TESTS_DIR)/accessories/reports/allure-report
COVERAGE_DIR     := $(TESTS_DIR)/accessories/reports/coverage
LOCUST_REPORT    := $(TESTS_DIR)/accessories/reports/locust
PDF_DIR          := $(TESTS_DIR)/accessories/reports/pdf

LOCUST_HOST     ?= http://localhost:8000
LOCUST_USERS    ?= 50
LOCUST_SPAWN    ?= 5
LOCUST_DURATION ?= 5m

.PHONY: test-all test-backend test-unit test-integration test-security \
        test-smoke test-contract test-coverage \
        test-load test-load-analytics test-load-smart-query \
        test-load-reports test-load-cameras \
        test-frontend test-e2e \
        allure-open coverage-open clean-reports

# ── Full Suite ────────────────────────────────────────────────────────────────
test-all: clean-reports test-backend test-frontend test-e2e allure-open
	@echo ""
	@echo "=== ALL TESTS COMPLETE ==="
	@echo "Allure: $(ALLURE_REPORT)/index.html"
	@echo "Coverage: $(COVERAGE_DIR)/index.html"
	@echo "PDF Reports: $(PDF_DIR)/"

# ── Backend ───────────────────────────────────────────────────────────────────
test-backend:
	pytest $(TESTS_DIR) \
	  -m "not load" \
	  --alluredir=$(ALLURE_BACKEND) \
	  --cov=$(BACKEND_DIR)/app \
	  --cov-report=html:$(COVERAGE_DIR) \
	  --cov-report=term-missing \
	  --cov-fail-under=80 \
	  -v --timeout=60 \
	  -n auto

test-unit:
	pytest $(TESTS_DIR)/unit \
	  -m unit \
	  --alluredir=$(ALLURE_BACKEND) \
	  --cov=$(BACKEND_DIR)/app \
	  --cov-report=term-missing \
	  -v --timeout=30

test-integration:
	pytest $(TESTS_DIR)/integration \
	  -m integration \
	  --alluredir=$(ALLURE_BACKEND) \
	  --cov=$(BACKEND_DIR)/app \
	  --cov-report=term-missing \
	  -v --timeout=60

test-security:
	pytest $(TESTS_DIR)/security \
	  -m security \
	  --alluredir=$(ALLURE_BACKEND) \
	  -v --timeout=30

test-smoke:
	pytest $(TESTS_DIR)/smoke \
	  -m smoke \
	  --alluredir=$(ALLURE_BACKEND) \
	  -v --timeout=30

test-contract:
	pytest $(TESTS_DIR)/contract \
	  -m contract \
	  --alluredir=$(ALLURE_BACKEND) \
	  -v --timeout=120

# ── Coverage (strict 100% on covered modules) ─────────────────────────────────
test-coverage:
	pytest $(TESTS_DIR) \
	  -m "not load" \
	  --cov=$(BACKEND_DIR)/app \
	  --cov-config=.coveragerc \
	  --cov-report=html:$(COVERAGE_DIR) \
	  --cov-report=term-missing \
	  --cov-report=xml:$(COVERAGE_DIR)/coverage.xml \
	  --cov-fail-under=100 \
	  --alluredir=$(ALLURE_BACKEND) \
	  -v --timeout=60

# ── Load Tests ────────────────────────────────────────────────────────────────
test-load:
	@mkdir -p $(LOCUST_REPORT)
	locust -f $(TESTS_DIR)/load/locustfile.py \
	  --host=$(LOCUST_HOST) \
	  --users=$(LOCUST_USERS) \
	  --spawn-rate=$(LOCUST_SPAWN) \
	  --run-time=$(LOCUST_DURATION) \
	  --html=$(LOCUST_REPORT)/main_report.html \
	  --headless

test-load-analytics:
	@mkdir -p $(LOCUST_REPORT)
	locust -f $(TESTS_DIR)/load/locust_analytics.py \
	  --host=$(LOCUST_HOST) \
	  --users=100 --spawn-rate=10 \
	  --run-time=$(LOCUST_DURATION) \
	  --html=$(LOCUST_REPORT)/analytics_report.html \
	  --headless

test-load-smart-query:
	@mkdir -p $(LOCUST_REPORT)
	locust -f $(TESTS_DIR)/load/locust_smart_query.py \
	  --host=$(LOCUST_HOST) \
	  --users=20 --spawn-rate=2 \
	  --run-time=$(LOCUST_DURATION) \
	  --html=$(LOCUST_REPORT)/smart_query_report.html \
	  --headless

test-load-reports:
	@mkdir -p $(LOCUST_REPORT)
	locust -f $(TESTS_DIR)/load/locust_reports.py \
	  --host=$(LOCUST_HOST) \
	  --users=10 --spawn-rate=1 \
	  --run-time=$(LOCUST_DURATION) \
	  --html=$(LOCUST_REPORT)/reports_report.html \
	  --headless

test-load-cameras:
	@mkdir -p $(LOCUST_REPORT)
	locust -f $(TESTS_DIR)/load/locust_camera.py \
	  --host=$(LOCUST_HOST) \
	  --users=20 --spawn-rate=3 \
	  --run-time=$(LOCUST_DURATION) \
	  --html=$(LOCUST_REPORT)/camera_report.html \
	  --headless

# ── Frontend ──────────────────────────────────────────────────────────────────
test-frontend:
	cd $(FRONTEND_DIR) && \
	ALLURE_RESULTS_DIR=allure-results \
	npx vitest run \
	  --reporter=verbose \
	  --reporter=allure-vitest/reporter \
	  --coverage

test-e2e:
	cd $(FRONTEND_DIR) && \
	npx playwright test \
	  --reporter=allure-playwright \
	  --reporter=html

# ── Reports ───────────────────────────────────────────────────────────────────
allure-open:
	@mkdir -p $(ALLURE_MERGED)
	@cp -r $(ALLURE_BACKEND)/. $(ALLURE_MERGED)/ 2>/dev/null || true
	@cp -r $(ALLURE_FRONTEND)/. $(ALLURE_MERGED)/ 2>/dev/null || true
	allure generate $(ALLURE_MERGED) --clean -o $(ALLURE_REPORT)
	allure open $(ALLURE_REPORT)

coverage-open:
	@echo "Opening coverage report: $(COVERAGE_DIR)/index.html"
	python -m webbrowser $(COVERAGE_DIR)/index.html 2>/dev/null || \
	  start $(COVERAGE_DIR)/index.html 2>/dev/null || \
	  open $(COVERAGE_DIR)/index.html

clean-reports:
	@rm -rf $(ALLURE_BACKEND) $(ALLURE_MERGED) $(ALLURE_REPORT) $(LOCUST_REPORT)
	@mkdir -p $(ALLURE_BACKEND) $(ALLURE_MERGED) $(LOCUST_REPORT) $(PDF_DIR)
	@echo "Report directories cleaned."
