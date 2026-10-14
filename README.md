# Ferry Ticketing Platform (frontend only)

Vite + React frontend. Backend removed.

## Prerequisites

- Node 20+

## Environment

Vite only reads `frontend/.env` (not repo-root `.env`). Copy the example there and fill real values, then restart the dev server (Vite loads env at startup):

```bash
cp .env.example frontend/.env
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
