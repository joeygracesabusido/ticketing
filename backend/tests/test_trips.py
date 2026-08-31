import pytest
import datetime
from app.graphql.schema import schema


def _dt(year, month, day, hour=12, minute=0):
    return datetime.datetime(year, month, day, hour, minute, tzinfo=datetime.timezone.utc)


@pytest.mark.asyncio
async def test_search_trips_empty_returns_list(db, mock_request_factory):
    """searchTrips on empty DB returns empty list."""
    req = mock_request_factory()
    query = """
    query {
      searchTrips(originPortId: "1", destinationPortId: "2", departureDate: "2026-09-10") {
        id
      }
    }
    """
    result = await schema.execute(query, context_value={"request": req})
    assert result.errors is None, f"Errors: {result.errors}"
    assert result.data is not None
    assert isinstance(result.data["searchTrips"], list)
    assert result.data["searchTrips"] == []


@pytest.mark.asyncio
async def test_search_trips_returns_matching_trip(db, mock_request_factory):
    """Create ports, route, vessel, trip and verify searchTrips finds it by date."""
    from app.services.port_service import create_port
    from app.services.route_service import create_route
    from app.services.vessel_service import create_vessel
    from app.services.trip_service import create_trip

    # Create ports
    p1 = await create_port(db, code="MNL", name="Manila North", city="Manila", province="Metro Manila")
    p2 = await create_port(db, code="CEB", name="Cebu Port", city="Cebu City", province="Cebu")
    # Create route MNL->CEB
    route = await create_route(db, code="MNL-CEB", origin_port_id=p1.id, destination_port_id=p2.id, distance_km=500, estimated_duration_minutes=720)
    vessel = await create_vessel(db, code="SFX", name="MV St. Francis", registration_number="REG-SFX-001", capacity=1000, vehicle_capacity=50)
    # Trip on 2026-09-10
    dep = _dt(2026, 9, 10, 12, 0)
    arr = dep + datetime.timedelta(hours=12)
    trip = await create_trip(
        db,
        route_id=route.id,
        vessel_id=vessel.id,
        departure_port_id=p1.id,
        arrival_port_id=p2.id,
        departure_at=dep,
        arrival_at=arr,
        status="SCHEDULED",
    )
    req = mock_request_factory()
    query = f'''
    query {{
      searchTrips(originPortId: "{p1.id}", destinationPortId: "{p2.id}", departureDate: "2026-09-10") {{
        id departureAt arrivalAt status
        route {{ code }}
        vessel {{ code name }}
        departurePort {{ code city }}
        arrivalPort {{ code city }}
      }}
    }}
    '''
    result = await schema.execute(query, context_value={"request": req})
    assert result.errors is None, f"Errors: {result.errors}"
    assert len(result.data["searchTrips"]) == 1
    found = result.data["searchTrips"][0]
    assert found["id"] == trip.id
    assert found["route"]["code"] == "MNL-CEB"
    assert found["vessel"]["code"] == "SFX"


@pytest.mark.asyncio
async def test_search_trips_filters_by_date_no_match(db, mock_request_factory):
    """searchTrips should return empty for non-matching date."""
    from app.services.port_service import create_port
    from app.services.route_service import create_route
    from app.services.vessel_service import create_vessel
    from app.services.trip_service import create_trip

    p1 = await create_port(db, code="MNL", name="Manila", city="Manila", province="Metro Manila")
    p2 = await create_port(db, code="CEB", name="Cebu", city="Cebu", province="Cebu")
    route = await create_route(db, code="MNL-CEB", origin_port_id=p1.id, destination_port_id=p2.id)
    vessel = await create_vessel(db, code="STH", name="MV St. Therese", registration_number="REG-STH-002", capacity=1000)
    dep = _dt(2026, 9, 10, 12, 0)
    arr = dep + datetime.timedelta(hours=12)
    await create_trip(db, route_id=route.id, vessel_id=vessel.id, departure_port_id=p1.id, arrival_port_id=p2.id, departure_at=dep, arrival_at=arr)

    req = mock_request_factory()
    # Search different date
    query = f'''
    query {{
      searchTrips(originPortId: "{p1.id}", destinationPortId: "{p2.id}", departureDate: "2026-09-11") {{
        id
      }}
    }}
    '''
    result = await schema.execute(query, context_value={"request": req})
    assert result.errors is None
    assert result.data["searchTrips"] == []


@pytest.mark.asyncio
async def test_search_trips_filters_by_route_no_match(db, mock_request_factory):
    """searchTrips with wrong origin/destination returns empty."""
    from app.services.port_service import create_port
    from app.services.route_service import create_route
    from app.services.vessel_service import create_vessel
    from app.services.trip_service import create_trip

    p1 = await create_port(db, code="MNL", name="Manila", city="Manila", province="Metro Manila")
    p2 = await create_port(db, code="CEB", name="Cebu", city="Cebu", province="Cebu")
    p3 = await create_port(db, code="ILO", name="Iloilo", city="Iloilo", province="Iloilo")
    route = await create_route(db, code="MNL-CEB", origin_port_id=p1.id, destination_port_id=p2.id)
    vessel = await create_vessel(db, code="SFX", name="MV St. Francis", registration_number="REG-SFX-001", capacity=1000)
    dep = _dt(2026, 9, 12, 12, 0)
    arr = dep + datetime.timedelta(hours=12)
    await create_trip(db, route_id=route.id, vessel_id=vessel.id, departure_port_id=p1.id, arrival_port_id=p2.id, departure_at=dep, arrival_at=arr)

    req = mock_request_factory()
    # Search with ILO instead of CEB
    query = f'''
    query {{
      searchTrips(originPortId: "{p1.id}", destinationPortId: "{p3.id}", departureDate: "2026-09-12") {{
        id
      }}
    }}
    '''
    result = await schema.execute(query, context_value={"request": req})
    assert result.errors is None
    assert result.data["searchTrips"] == []


@pytest.mark.asyncio
async def test_trip_by_id_returns_trip(db, mock_request_factory):
    """Trip query by id returns trip details."""
    from app.services.port_service import create_port
    from app.services.route_service import create_route
    from app.services.vessel_service import create_vessel
    from app.services.trip_service import create_trip

    p1 = await create_port(db, code="MNL", name="Manila", city="Manila", province="Metro Manila")
    p2 = await create_port(db, code="CEB", name="Cebu", city="Cebu", province="Cebu")
    route = await create_route(db, code="MNL-CEB", origin_port_id=p1.id, destination_port_id=p2.id)
    vessel = await create_vessel(db, code="MAL", name="MV Malasakit", registration_number="REG-MAL-003", capacity=1200)
    dep = _dt(2026, 9, 15, 12, 0)
    arr = dep + datetime.timedelta(hours=12)
    trip = await create_trip(db, route_id=route.id, vessel_id=vessel.id, departure_port_id=p1.id, arrival_port_id=p2.id, departure_at=dep, arrival_at=arr)

    req = mock_request_factory()
    query = f'''
    query {{
      trip(id: "{trip.id}") {{
        id departureAt arrivalAt status
        route {{ code }}
        vessel {{ code }}
        departurePort {{ code }}
        arrivalPort {{ code }}
        fareFrom
      }}
    }}
    '''
    result = await schema.execute(query, context_value={"request": req})
    assert result.errors is None, f"Errors: {result.errors}"
    assert result.data["trip"] is not None
    assert result.data["trip"]["id"] == trip.id
    assert result.data["trip"]["route"]["code"] == "MNL-CEB"
    assert result.data["trip"]["departurePort"]["code"] == "MNL"
    assert result.data["trip"]["arrivalPort"]["code"] == "CEB"


@pytest.mark.asyncio
async def test_trip_by_id_not_found_returns_null(db, mock_request_factory):
    """Querying non-existent trip returns null."""
    req = mock_request_factory()
    query = 'query { trip(id: "non-existent-id") { id } }'
    result = await schema.execute(query, context_value={"request": req})
    assert result.errors is None
    assert result.data["trip"] is None


@pytest.mark.asyncio
async def test_search_trips_via_httpx_asgi(db):
    """Verify searchTrips via httpx ASGI client also works with patched DB."""
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    from app.services.port_service import create_port
    from app.services.route_service import create_route
    from app.services.vessel_service import create_vessel
    from app.services.trip_service import create_trip

    p1 = await create_port(db, code="MNL", name="Manila", city="Manila", province="Metro Manila")
    p2 = await create_port(db, code="CEB", name="Cebu", city="Cebu", province="Cebu")
    route = await create_route(db, code="MNL-CEB", origin_port_id=p1.id, destination_port_id=p2.id)
    vessel = await create_vessel(db, code="SFX", name="MV St. Francis", registration_number="REG-SFX-001", capacity=1000)
    dep = _dt(2026, 9, 20, 12, 0)
    arr = dep + datetime.timedelta(hours=12)
    await create_trip(db, route_id=route.id, vessel_id=vessel.id, departure_port_id=p1.id, arrival_port_id=p2.id, departure_at=dep, arrival_at=arr)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        q = f'query {{ searchTrips(originPortId: "{p1.id}", destinationPortId: "{p2.id}", departureDate: "2026-09-20") {{ id }} }}'
        r = await ac.post("/graphql", json={"query": q})
        assert r.status_code == 200
        body = r.json()
        assert "data" in body
        assert len(body["data"]["searchTrips"]) == 1


@pytest.mark.asyncio
async def test_create_trip_via_graphql_admin_and_forbidden(db, mock_request_factory, admin_token, customer_token):
    """Test createTrip mutation: admin success vs customer forbidden."""
    from app.services.port_service import create_port
    from app.services.route_service import create_route
    from app.services.vessel_service import create_vessel

    p1 = await create_port(db, code="MNL", name="Manila", city="Manila", province="Metro Manila")
    p2 = await create_port(db, code="CEB", name="Cebu", city="Cebu", province="Cebu")
    route = await create_route(db, code="MNL-CEB", origin_port_id=p1.id, destination_port_id=p2.id)
    vessel = await create_vessel(db, code="SFX", name="MV St. Francis", registration_number="REG-SFX-001", capacity=1000)

    dep = _dt(2026, 9, 25, 12, 0).isoformat()
    arr = _dt(2026, 9, 26, 0, 0).isoformat()

    # Customer should be forbidden
    req_cust = mock_request_factory(token=customer_token)
    mut_customer = f'''
    mutation {{
      createTrip(input: {{
        routeId: "{route.id}",
        vesselId: "{vessel.id}",
        departurePortId: "{p1.id}",
        arrivalPortId: "{p2.id}",
        departureAt: "{dep}",
        arrivalAt: "{arr}"
      }}) {{ id }}
    }}
    '''
    res_cust = await schema.execute(mut_customer, context_value={"request": req_cust})
    assert res_cust.errors is not None
    assert any("FORBIDDEN" in str(e.message) or "FORBIDDEN" in str(e.extensions) for e in res_cust.errors)

    # Admin should succeed
    req_admin = mock_request_factory(token=admin_token)
    mut_admin = f'''
    mutation {{
      createTrip(input: {{
        routeId: "{route.id}",
        vesselId: "{vessel.id}",
        departurePortId: "{p1.id}",
        arrivalPortId: "{p2.id}",
        departureAt: "{dep}",
        arrivalAt: "{arr}"
      }}) {{ id departureAt route {{ code }} vessel {{ code }} }}
    }}
    '''
    res_admin = await schema.execute(mut_admin, context_value={"request": req_admin})
    assert res_admin.errors is None, f"Admin createTrip errors: {res_admin.errors}"
    assert res_admin.data["createTrip"]["route"]["code"] == "MNL-CEB"

    # Verify search finds it
    req2 = mock_request_factory()
    q = f'query {{ searchTrips(originPortId: "{p1.id}", destinationPortId: "{p2.id}", departureDate: "2026-09-25") {{ id }} }}'
    res_search = await schema.execute(q, context_value={"request": req2})
    assert len(res_search.data["searchTrips"]) == 1

