# Ferry Ticketing Platform

Ferry Ticketing Platform — Phase 1-2. Python 3.12+, Decimal for money, GraphQL primary, PostgreSQL authoritative.

## Prerequisites

- Docker & Docker Compose
- Python 3.12+
- Node 20+

## Environment

Copy `.env.example` to `.env` and adjust secrets as needed:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | AsyncPG connection URL for Postgres |
| `REDIS_URL` | Redis connection URL |
| `JWT_SECRET` | Access token signing secret |
| `JWT_REFRESH_SECRET` | Refresh token signing secret |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) |
| `VITE_GRAPHQL_URL` | Frontend GraphQL endpoint |

## Quick Start (Docker)

Bring up all 4 services (postgres, redis, backend, frontend):

```bash
docker compose up --build
```

- Postgres: `localhost:5432` (user: `ferry`, db: `ferry`)
- Redis: `localhost:6379`
- Backend (FastAPI + GraphQL): `http://localhost:8000/graphql`
- Frontend (Vite): `http://localhost:5173`

Healthchecks ensure `postgres` and `redis` are ready before `backend` starts; `frontend` depends on `backend`.

Verify compose file parses:

```bash
docker compose config
```

## Project Structure

```
.
├── backend/            # FastAPI + Strawberry GraphQL service
│   └── Dockerfile
├── frontend/           # Vite frontend
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Global Constraints

- Python 3.12+
- `Decimal` for all monetary values
- GraphQL primary API surface
- PostgreSQL authoritative store
