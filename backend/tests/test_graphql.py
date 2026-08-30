import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.mark.asyncio
async def test_search_trips_empty():
    q = "query { searchTrips(originPortId: \"1\", destinationPortId: \"2\", departureDate: \"2026-09-10\") { id } }"
    # httpx 0.28+ requires ASGITransport, 0.27 supports app directly
    try:
        async with AsyncClient(app=app, base_url="http://test") as ac:  # type: ignore[call-arg]
            r = await ac.post("/graphql", json={"query": q})
    except TypeError:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post("/graphql", json={"query": q})
    assert r.status_code == 200
    body = r.json()
    assert "data" in body
    assert body["data"]["searchTrips"] == []
