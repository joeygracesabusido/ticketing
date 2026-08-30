import strawberry
from strawberry.permission import BasePermission
from app.utils.security import decode_token

class IsAuthenticated(BasePermission):
    message = "UNAUTHORIZED"
    def has_permission(self, source, info, **kwargs):
        request = info.context["request"]
        auth = request.headers.get("authorization","")
        if not auth.startswith("Bearer "): return False
        try:
            payload = decode_token(auth.split(" ",1)[1])
            request.state.user = payload
            return True
        except Exception:
            return False

class HasRole(BasePermission):
    def __init__(self, *roles): self.roles = roles
    def has_permission(self, source, info, **kwargs):
        user = getattr(info.context["request"].state, "user", None)
        if not user: return False
        return any(r in user.get("roles",[]) for r in self.roles)
