# ConstructionSight AI

ConstructionSight AI is a full-stack construction safety platform for project teams that need PPE monitoring, site analytics, camera management, incident reporting, and AI-assisted querying across construction-site data.

## Features

- Real-time PPE and safety monitoring pipeline for construction cameras
- Project, zone, camera, task, and team management workflows
- Role-based authentication with secure token handling
- Incident and notification services for safety events
- Risk analytics, dashboard aggregation, and reporting workflows
- Smart Query assistant for natural-language analysis over project data
- BIM workspace support for model-backed site visualization
- Backend test coverage for security, contracts, schemas, services, smoke checks, and load scenarios
- React dashboard with project operations, analytics, reports, BIM, and AI assistant views

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, Vite, Material UI, Bootstrap, TanStack Query |
| Backend | FastAPI, SQLAlchemy, Pydantic |
| Database | PostgreSQL |
| Async/Workers | Celery, Redis, APScheduler |
| Computer Vision | PyTorch, Ultralytics YOLO, OpenCV |
| AI/Retrieval | LangGraph, FAISS, BM25, sentence-transformers |
| Reporting | ReportLab, WeasyPrint, Plotly, Pandas |
| Testing | Pytest, Vitest, Playwright, Schemathesis, Locust |

## Project Structure

```text
.
|-- backend/                     FastAPI app, services, schemas, ML pipeline
|-- frontend/                    React + Vite dashboard
|-- tests/                       Unit, contract, security, smoke, and load tests
|-- data/                        Sample data and static resources
|-- Database Backup + Demo Video/ Reference project artifacts
|-- Makefile                     Test and development shortcuts
|-- StartingCommands.md          Local startup and environment notes
|-- vercel.json                  Frontend deployment configuration
`-- README.md
```

## Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app_stream:app --reload --host 127.0.0.1 --port 8000
```

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Default local URLs:

| Service | URL |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend API | `http://localhost:8000` |
| API Docs | `http://localhost:8000/docs` |

## Environment Variables

Create backend and frontend environment files based on the services you enable.

Backend:

```env
DATABASE_URL=
SECRET_KEY=
REDIS_URL=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
GEMINI_API_KEY=
```

Frontend:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## Testing

Run backend tests:

```bash
pytest
```

Run frontend tests:

```bash
cd frontend
npm run test
```

Run frontend production build:

```bash
cd frontend
npm run build
```

## Deployment

The frontend can be deployed as a Vite application. The backend should run as a persistent Python service because it includes API routes, database access, background processing, AI/ML dependencies, and long-running workers.
