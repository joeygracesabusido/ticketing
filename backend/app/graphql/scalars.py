import strawberry
from decimal import Decimal

DecimalScalar = strawberry.scalar(Decimal, serialize=lambda v: str(v), parse_value=lambda v: Decimal(v))
