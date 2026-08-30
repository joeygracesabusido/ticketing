"""Decimal helpers - ensures money handled as Decimal(10,2) string."""
from decimal import Decimal, ROUND_HALF_UP

TWOPLACES = Decimal("0.01")


def to_decimal(value) -> Decimal:
    """Convert value to Decimal quantized to 2 places."""
    if isinstance(value, Decimal):
        return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)
    return Decimal(str(value)).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def quantize_price(value: Decimal | str | float | int) -> Decimal:
    return to_decimal(value)


def format_price(value: Decimal) -> str:
    return format(to_decimal(value), ".2f")
