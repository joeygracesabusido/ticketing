def test_fare_models_import():
    from app.models.passenger import PassengerType
    from app.models.fare import FareRule, FareComponent, Promotion, PromotionRule, VehicleFareRule
    assert PassengerType.__tablename__ == "passenger_types"
    assert FareRule.__tablename__ == "fare_rules"
