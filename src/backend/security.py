from __future__ import annotations
import base64, os, hmac, time
from hashlib import pbkdf2_hmac
from typing import Dict, Any
import jwt
from .config import Settings

_ITER = 390_000
_SALT = 16

def hash_password(pw: str) -> str:
    pw = pw or ""
    salt = os.urandom(_SALT)
    dig = pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, _ITER)
    return base64.b64encode(salt + dig).decode("ascii")

def verify_password(stored: str, candidate: str) -> bool:
    if not stored or not candidate:
        return False
    raw = base64.b64decode(stored.encode("ascii"))
    salt, dig = raw[:_SALT], raw[_SALT:]
    cand = pbkdf2_hmac("sha256", candidate.encode("utf-8"), salt, _ITER)
    return hmac.compare_digest(dig, cand)

def create_access_token(sub: str) -> str:
    now = int(time.time())
    payload = {"sub": sub, "iat": now, "exp": now + Settings.ACCESS_TOKEN_TTL, "iss": "spm", "typ": "access"}
    return jwt.encode(payload, Settings.SECRET_KEY, algorithm="HS256")

def verify_access_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, Settings.SECRET_KEY, algorithms=["HS256"])

