def test_models_import():
    from app.models import user, port, route, vessel, accommodation, trip
    assert user.User.__tablename__ == "users"
