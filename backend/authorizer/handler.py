"""
Lambda Authorizer — Validates custom HMAC-SHA256 JWTs issued by auth handler.
This function is invoked by API Gateway before protected routes.
Returns an IAM policy allowing or denying the request.
"""

import os
import json
import hmac
import hashlib
import base64
import time
from typing import Optional, Dict, Any


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += '=' * padding
    return base64.urlsafe_b64decode(s)


def _verify_jwt(token: str, secret: str) -> Optional[Dict[str, Any]]:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        signing_input = f"{parts[0]}.{parts[1]}"
        expected_sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
        actual_sig = _b64url_decode(parts[2])
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        claims = json.loads(_b64url_decode(parts[1]))
        if claims.get('exp', 0) < int(time.time()):
            return None
        return claims
    except Exception:
        return None


def lambda_handler(event: dict, context: Any) -> dict:
    JWT_SECRET = os.environ.get('JWT_SECRET', '')

    # Extract Bearer token from Authorization header
    headers = event.get('headers') or {}
    auth_header = headers.get('authorization') or headers.get('Authorization') or ''
    token = auth_header.replace('Bearer ', '').replace('bearer ', '').strip()

    claims = _verify_jwt(token, JWT_SECRET) if token else None

    if not claims:
        # Return deny policy
        return {
            'isAuthorized': False
        }

    # Return allow with context injected back into the request
    return {
        'isAuthorized': True,
        'context': {
            'userId': claims.get('sub', ''),
            'email': claims.get('email', '')
        }
    }

