"""
Auth Module — Pure Business Logic Handler
Zero boto3 or AWS SDK imports in handler.
Zero-Knowledge client-side encryption and recovery key support.
"""

import json
from typing import Any

from common.response import success, created, bad_request, unauthorized, not_found, server_error
from auth.adapters import DynamoDBAuthAdapter, _hash_password


def lambda_handler(event: dict, context: Any) -> dict:
    try:
        http_context = event.get('requestContext', {}).get('http', {})
        method = http_context.get('method') or event.get('httpMethod', 'POST')
        raw_path = http_context.get('path') or event.get('rawPath') or event.get('path', '')

        adapter = DynamoDBAuthAdapter()

        if method == 'POST' and raw_path.endswith('/register'):
            return handle_register(event, adapter)
        elif method == 'POST' and raw_path.endswith('/login'):
            return handle_login(event, adapter)
        elif method == 'POST' and (raw_path.endswith('/recovery-info') or raw_path.endswith('/recovery_info')):
            return handle_recovery_info(event, adapter)
        elif method == 'POST' and (raw_path.endswith('/reset-password') or raw_path.endswith('/reset_password')):
            return handle_reset_password(event, adapter)

        return not_found(f'No auth route matches {method} {raw_path}')

    except ValueError as exc:
        err_str = str(exc)
        if 'UsernameExistsException' in err_str:
            return bad_request('An account with this email already exists.')
        elif 'NotAuthorizedException' in err_str or 'UserNotFoundException' in err_str:
            return unauthorized('Incorrect email or password.')
        return bad_request(f'Validation error: {err_str}')
    except Exception as exc:
        return server_error(f'Authentication error: {str(exc)}')


def handle_register(event: dict, adapter: DynamoDBAuthAdapter) -> dict:
    body = parse_json_body(event)
    email = (body.get('email') or '').strip().lower()
    if not email:
        return bad_request('email is required.')

    password_hash = body.get('passwordHash') or body.get('password_hash')
    password_salt = body.get('passwordSalt') or body.get('password_salt')
    wrapped_mfk_password = body.get('wrappedMfkPassword') or body.get('wrapped_mfk_password') or body.get('wrappedMfkByPassword')
    wrapped_mfk_recovery = body.get('wrappedMfkRecovery') or body.get('wrapped_mfk_recovery') or body.get('wrappedMfkByRecovery')

    # Fallback if standard password is provided directly
    if not password_hash and body.get('password'):
        password = body.get('password')
        if len(password) < 8:
            return bad_request('Password must be at least 8 characters long.')
        password_salt, password_hash = _hash_password(password)
        wrapped_mfk_password = wrapped_mfk_password or ''
        wrapped_mfk_recovery = wrapped_mfk_recovery or ''

    if not password_hash or not password_salt:
        return bad_request('passwordHash and passwordSalt are required.')

    result = adapter.register(
        email=email,
        password_hash=password_hash,
        password_salt=password_salt,
        wrapped_mfk_password=wrapped_mfk_password or '',
        wrapped_mfk_recovery=wrapped_mfk_recovery or ''
    )
    return created({
        'message': 'Registration successful. You can now log in.',
        'userId': result['userId'],
        'email': result['email']
    })


def handle_login(event: dict, adapter: DynamoDBAuthAdapter) -> dict:
    body = parse_json_body(event)
    email = (body.get('email') or '').strip().lower()
    password = body.get('password') or body.get('passwordHash') or body.get('password_hash') or ''

    if not email or not password:
        return bad_request('email and password are required.')

    result = adapter.login(email, password)
    return success({
        'userId': result['userId'],
        'email': result['email'],
        'token': result['token'],
        'passwordSalt': result.get('passwordSalt', ''),
        'wrappedMfkByPassword': result.get('wrappedMfkByPassword', '')
    })


def handle_recovery_info(event: dict, adapter: DynamoDBAuthAdapter) -> dict:
    body = parse_json_body(event)
    email = (body.get('email') or '').strip().lower()

    if not email:
        return bad_request('email is required.')

    try:
        result = adapter.get_recovery_info(email)
        return success(result)
    except ValueError as exc:
        if 'UserNotFoundException' in str(exc):
            return not_found('User not found.')
        raise


def handle_reset_password(event: dict, adapter: DynamoDBAuthAdapter) -> dict:
    body = parse_json_body(event)
    email = (body.get('email') or '').strip().lower()

    new_password_hash = body.get('newPasswordHash') or body.get('new_password_hash')
    new_password_salt = body.get('newPasswordSalt') or body.get('new_password_salt')
    new_wrapped_mfk_password = (
        body.get('newWrappedMfkPassword') or
        body.get('new_wrapped_mfk_password') or
        body.get('wrappedMfkPassword') or
        body.get('wrapped_mfk_password')
    )
    new_wrapped_mfk_recovery = (
        body.get('newWrappedMfkRecovery') or
        body.get('new_wrapped_mfk_recovery') or
        body.get('wrappedMfkRecovery') or
        body.get('wrapped_mfk_recovery')
    )

    if not email:
        return bad_request('email is required.')
    if not new_password_hash or not new_password_salt:
        return bad_request('newPasswordHash and newPasswordSalt are required.')
    if not new_wrapped_mfk_password or not new_wrapped_mfk_recovery:
        return bad_request('newWrappedMfkPassword and newWrappedMfkRecovery are required.')

    try:
        result = adapter.reset_password(
            email=email,
            new_password_hash=new_password_hash,
            new_password_salt=new_password_salt,
            new_wrapped_mfk_password=new_wrapped_mfk_password,
            new_wrapped_mfk_recovery=new_wrapped_mfk_recovery
        )
        return success({
            'message': 'Password reset successful. You can now log in.',
            'userId': result.get('userId'),
            'email': result.get('email')
        })
    except ValueError as exc:
        if 'UserNotFoundException' in str(exc):
            return not_found('User not found.')
        raise


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
