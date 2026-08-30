from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config.settings import get_settings
from strawberry.fastapi import GraphQLRouter
from app.graphql.schema import schema

settings = get_settings()

graphql_app = GraphQLRouter(schema)

app = FastAPI(title="Ferry Ticketing API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(graphql_app, prefix="/graphql")
