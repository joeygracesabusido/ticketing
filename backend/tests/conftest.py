import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.database.base import Base

# Ensure all models are imported so Base.metadata is populated
import app.models  # noqa: F401

TEST_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db(monkeypatch):
    """Async SQLAlchemy session with in-memory sqlite and patched AsyncSessionLocal."""
    engine = create_async_engine(TEST_URL, echo=False, future=True)

    # Deduplicate indexes that cause sqlite failure: ix_trips_departure_at appears twice
    # (once via column index=True, once via explicit Index in __table_args__)
    # Remove duplicates so create_all doesn't try to create same index twice
    seen = set()
    for table in Base.metadata.tables.values():
        # Work on list copy because we may mutate
        uniq = []
        dupes = []
        for idx in list(table.indexes):
            key = (table.name, idx.name)
            if key in seen or any(i.name == idx.name for i in uniq):
                dupes.append(idx)
            else:
                uniq.append(idx)
                seen.add(key)
        # Actually better: dedupe per table by index name
        name_to_keep = {}
        for idx in list(table.indexes):
            if idx.name in name_to_keep:
                # duplicate – remove the duplicate from table
                table.indexes.discard(idx)
            else:
                name_to_keep[idx.name] = idx

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False)

    # Patch the global sessionmaker used by GraphQL resolvers
    import app.database.session as session_mod

    monkeypatch.setattr(session_mod, "engine", engine)
    monkeypatch.setattr(session_mod, "AsyncSessionLocal", Session)

    # Patch modules that already imported AsyncSessionLocal directly
    import importlib

    for mod_name in [
        "app.graphql.queries.port",
        "app.graphql.queries.route",
        "app.graphql.queries.vessel",
        "app.graphql.queries.trip",
        "app.graphql.queries.accommodation",
        "app.graphql.queries.user",
        "app.graphql.mutations.port",
        "app.graphql.mutations.route",
        "app.graphql.mutations.vessel",
        "app.graphql.mutations.trip",
        "app.graphql.mutations.auth",
    ]:
        try:
            mod = importlib.import_module(mod_name)
            if hasattr(mod, "AsyncSessionLocal"):
                monkeypatch.setattr(mod, "AsyncSessionLocal", Session)
        except Exception:
            pass

    async with Session() as s:
        yield s

    await engine.dispose()


@pytest.fixture
def mock_request_factory():
    """Factory for mock Starlette-like request objects for strawberry context."""

    class MockState:
        def __init__(self):
            self.user = None

    class MockRequest:
        def __init__(self, headers=None):
            self.headers = headers or {}
            self.state = MockState()

    def _factory(token: str | None = None, headers: dict | None = None):
        h = dict(headers or {})
        if token:
            h["authorization"] = f"Bearer {token}"
        return MockRequest(headers=h)

    return _factory


@pytest.fixture
def admin_token():
    from app.utils.security import create_access_token

    return create_access_token({"sub": "admin-id", "roles": ["ADMIN"]})


@pytest.fixture
def customer_token():
    from app.utils.security import create_access_token

    return create_access_token({"sub": "cust-id", "roles": ["CUSTOMER"]})
