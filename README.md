# Ferry Ticketing Platform (frontend only)

Vite + React frontend. Backend removed.

## Prerequisites

- Node 20+

## Environment

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable/anon key |

## Quick Start

```bash
cd frontend && npm install && npm run dev
```

- Frontend (Vite): `http://localhost:5173`

## Project Structure

```
.
├── frontend/           # Vite frontend
├── .env.example
└── README.md
```
