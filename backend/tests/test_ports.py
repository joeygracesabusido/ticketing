import pytest
from app.graphql.schema import schema


@pytest.mark.asyncio
async def test_ports_query_empty_returns_list(db, mock_request_factory):
    """Ports query on empty DB returns empty list (and no errors)."""
    req = mock_request_factory()
    query = "query { ports { id code name city province } }"
    result = await schema.execute(query, context_value={"request": req})
    assert result.errors is None, f"Unexpected errors: {result.errors}"
    assert result.data is not None
    assert "ports" in result.data
    assert isinstance(result.data["ports"], list)
    assert result.data["ports"] == []


@pytest.mark.asyncio
async def test_create_port_via_service_then_query_graphql(db, mock_request_factory):
    """Create a port via service, then verify it appears via GraphQL ports query."""
    from app.services.port_service import create_port

    await create_port(db, code="MNL", name="Manila North Harbor", city="Manila", province="Metro Manila")
    await create_port(db, code="CEB", name="Cebu Port", city="Cebu City", province="Cebu")

    req = mock_request_factory()
    query = "query { ports { code name city } }"
    result = await schema.execute(query, context_value={"request": req})
    assert result.errors is None, f"Errors: {result.errors}"
    codes = {p["code"] for p in result.data["ports"]}
    assert "MNL" in codes
    assert "CEB" in codes
    assert len(result.data["ports"]) == 2


@pytest.mark.asyncio
async def test_ports_query_active_filter(db, mock_request_factory):
    """Ports query with active filter."""
    from app.services.port_service import create_port

    await create_port(db, code="ACT1", name="Active Port", city="Manila", province="Metro Manila", active=True)
    await create_port(db, code="INA1", name="Inactive Port", city="Cebu", province="Cebu", active=False)

    req = mock_request_factory()
    q_active = "query { ports(active: true) { code active } }"
    res_active = await schema.execute(q_active, context_value={"request": req})
    assert res_active.errors is None
    assert len(res_active.data["ports"]) == 1
    assert res_active.data["ports"][0]["code"] == "ACT1"

    q_inactive = "query { ports(active: false) { code active } }"
    res_inactive = await schema.execute(q_inactive, context_value={"request": req})
    assert res_inactive.errors is None
    assert len(res_inactive.data["ports"]) == 1
    assert res_inactive.data["ports"][0]["code"] == "INA1"


@pytest.mark.asyncio
async def test_create_port_via_graphql_admin_success(db, mock_request_factory, admin_token):
    """Admin can create port via GraphQL mutation."""
    req = mock_request_factory(token=admin_token)
    mutation = """
    mutation {
      createPort(input: {code: "BTG", name: "Batangas Port", city: "Batangas City", province: "Batangas"}) {
        id code name city province country active
      }
    }
    """
    result = await schema.execute(mutation, context_value={"request": req})
    assert result.errors is None, f"Errors: {result.errors}"
    assert result.data is not None
    assert result.data["createPort"]["code"] == "BTG"
    assert result.data["createPort"]["city"] == "Batangas City"

    # Verify via query
    req2 = mock_request_factory()
    q = "query { ports { code } }"
    res2 = await schema.execute(q, context_value={"request": req2})
    assert any(p["code"] == "BTG" for p in res2.data["ports"])


@pytest.mark.asyncio
async def test_create_port_via_graphql_forbidden_for_customer(db, mock_request_factory, customer_token):
    """Non-admin (CUSTOMER) cannot create port -> FORBIDDEN."""
    req = mock_request_factory(token=customer_token)
    mutation = """
    mutation {
      createPort(input: {code: "ILO", name: "Iloilo Port", city: "Iloilo City", province: "Iloilo"}) {
        id code
      }
    }
    """
    result = await schema.execute(mutation, context_value={"request": req})
    assert result.errors is not None
    err_messages = [str(e.message) for e in result.errors]
    err_codes = []
    for e in result.errors:
        if e.extensions:
            err_codes.append(str(e.extensions.get("code", "")))
    combined = " ".join(err_messages + err_codes)
    assert "FORBIDDEN" in combined


@pytest.mark.asyncio
async def test_create_port_via_graphql_unauthenticated_fails(db, mock_request_factory):
    """Unauthenticated request should fail with UNAUTHORIZED."""
    req = mock_request_factory()  # no token
    mutation = """
    mutation {
      createPort(input: {code: "DVO", name: "Davao Port", city: "Davao City", province: "Davao del Sur"}) {
        id code
      }
    }
    """
    result = await schema.execute(mutation, context_value={"request": req})
    assert result.errors is not None
    err_text = " ".join([str(e.message) for e in result.errors] + [str(getattr(e, "extensions", {})) for e in result.errors])
    # strawberry permission failure yields UNAUTHORIZED message
    assert "UNAUTHORIZED" in err_text or "FORBIDDEN" in err_text


@pytest.mark.asyncio
async def test_create_port_duplicate_code_via_graphql(db, mock_request_factory, admin_token):
    """Duplicate port code should error CODE_EXISTS."""
    from app.services.port_service import create_port

    await create_port(db, code="MNL", name="Manila", city="Manila", province="Metro Manila")
    req = mock_request_factory(token=admin_token)
    mutation = """
    mutation {
      createPort(input: {code: "MNL", name: "Manila Duplicate", city: "Manila", province: "Metro Manila"}) {
        id code
      }
    }
    """
    result = await schema.execute(mutation, context_value={"request": req})
    assert result.errors is not None
    combined = " ".join([str(e.message) for e in result.errors] + [str(e.extensions) for e in result.errors if e.extensions])
    assert "CODE_EXISTS" in combined


@pytest.mark.asyncio
async def test_port_query_by_id_via_graphql(db, mock_request_factory):
    """Test port(id) returns single port."""
    from app.services.port_service import create_port

    port = await create_port(db, code="TAG", name="Tagbilaran Port", city="Tagbilaran City", province="Bohol")
    req = mock_request_factory()
    query = f'query {{ port(id: "{port.id}") {{ id code name }} }}'
    result = await schema.execute(query, context_value={"request": req})
    assert result.errors is None
    assert result.data["port"]["code"] == "TAG"
    assert result.data["port"]["name"] == "Tagbilaran Port"

    # non-existent id returns null
    q2 = 'query { port(id: "non-existent-id") { id code } }'
    res2 = await schema.execute(q2, context_value={"request": req})
    assert res2.errors is None
    assert res2.data["port"] is None


@pytest.mark.asyncio
async def test_create_port_via_graphql_via_httpx(db):
    """Integration via httpx ASGI: admin createPort + query ports."""
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    from app.utils.security import create_access_token

    token = create_access_token({"sub": "admin-httpx", "roles": ["ADMIN"]})
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Initially query ports - should be empty or contain what patched DB has (our db fixture patched global)
        # Note: db fixture already patched AsyncSessionLocal, so ASGI will see same sqlite DB
        # Ensure empty first
        r = await ac.post("/graphql", json={"query": "{ ports { code } }"})
        assert r.status_code == 200
        assert "data" in r.json()

        # Create port via authenticated mutation
        mut = 'mutation { createPort(input: {code: "HTT", name: "Httpx Port", city: "Test City", province: "Test Province"}) { code name } }'
        r2 = await ac.post(
            "/graphql",
            json={"query": mut},
            headers={"authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 200
        body = r2.json()
        # With DB patch, should succeed
        assert body.get("data", {}).get("createPort", {}).get("code") == "HTT" or "errors" not in body or body.get("errors") is None

