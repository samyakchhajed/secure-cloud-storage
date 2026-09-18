"""
Auth Module — Pure Business Logic Handler
Zero boto3 or AWS SDK imports in handler.
"""

import json
import base64
from typing import Any

from common.response import success, created, bad_request, unauthorized, not_found, server_error
from auth.adapters import CognitoAuthAdapter


def lambda_handler(event: dict, context: Any) -> dict:
    try:
        http_context = event.get('requestContext', {}).get('http', {})
        method = http_context.get('method') or event.get('httpMethod', 'POST')
        raw_path = http_context.get('path') or event.get('rawPath') or event.get('path', '')

        auth_adapter = CognitoAuthAdapter()

        if method == 'POST' and raw_path.endswith('/register'):
            return handle_register(event, auth_adapter)
        elif method == 'POST' and raw_path.endswith('/verify'):
            return handle_verify(event, auth_adapter)
        elif method == 'POST' and raw_path.endswith('/login'):
            return handle_login(event, auth_adapter)

        return not_found(f'No auth route matches {method} {raw_path}')

    except Exception as exc:
        err_str = str(exc)
        if 'UsernameExistsException' in err_str:
            return bad_request('An account with this email already exists.')
        elif 'CodeMismatchException' in err_str or 'ExpiredCodeException' in err_str:
            return bad_request('Invalid or expired verification code.')
        elif 'NotAuthorizedException' in err_str or 'UserNotFoundException' in err_str:
            return unauthorized('Incorrect email or password.')
        elif 'InvalidPasswordException' in err_str:
            return bad_request('Password does not meet security requirements.')
        elif 'UserNotConfirmedException' in err_str:
            return bad_request('User account is not verified yet. Please enter your verification code.')
        return server_error(f'Authentication error: {err_str}')


def handle_register(event: dict, adapter: CognitoAuthAdapter) -> dict:
    body = parse_json_body(event)
    email = (body.get('email') or '').strip().lower()
    password = body.get('password') or ''

    if not email or not password:
        return bad_request('email and password are required.')
    if len(password) < 8:
        return bad_request('Password must be at least 8 characters long.')

    resp = adapter.register(email, password)
    user_sub = resp.get('UserSub')

    return created({
        'message': 'Registration successful. A verification code has been sent to your email.',
        'userSub': user_sub,
        'email': email
    })


def handle_verify(event: dict, adapter: CognitoAuthAdapter) -> dict:
    body = parse_json_body(event)
    email = (body.get('email') or '').strip().lower()
    code = (body.get('code') or '').strip()

    if not email or not code:
        return bad_request('email and code are required.')

    adapter.verify(email, code)
    return success({
        'verified': True,
        'message': 'Email verified successfully. You can now log in.'
    })


def handle_login(event: dict, adapter: CognitoAuthAdapter) -> dict:
    body = parse_json_body(event)
    email = (body.get('email') or '').strip().lower()
    password = body.get('password') or ''

    if not email or not password:
        return bad_request('email and password are required.')

    auth_result = adapter.login(email, password).get('AuthenticationResult', {})
    id_token = auth_result.get('IdToken')
    access_token = auth_result.get('AccessToken')
    refresh_token = auth_result.get('RefreshToken')

    # Extract user sub from id_token payload
    user_id = extract_sub_from_jwt(id_token) or email

    return success({
        'userId': user_id,
        'email': email,
        'token': id_token,
        'accessToken': access_token,
        'refreshToken': refresh_token
    })


def extract_sub_from_jwt(jwt_token: str) -> str:
    """Decodes the unverified payload of a JWT token to extract the sub claim."""
    if not jwt_token or '.' not in jwt_token:
        return ''
    try:
        parts = jwt_token.split('.')
        payload_b64 = parts[1]
        # Pad base64 string
        rem = len(payload_b64) % 4
        if rem > 0:
            payload_b64 += '=' * (4 - rem)
        decoded_bytes = base64.urlsafe_b64decode(payload_b64)
        claims = json.loads(decoded_bytes.decode('utf-8'))
        return claims.get('sub', '')
    except Exception:
        return ''


def parse_json_body(event: dict) -> dict:
    body = event.get('body')
    if not body:
        return {}
    if isinstance(body, dict):
        return body
    try:
        return json.loads(body)
    except Exception:
        return {}
