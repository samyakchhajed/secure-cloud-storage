"""
JWT Token Context & Identity Parser
Extracts authenticated Cognito User claims from API Gateway request contexts.
"""

from typing import Optional, Tuple


def get_user_identity(event: dict) -> Tuple[Optional[str], Optional[str]]:
    """
    Extracts (user_id, email) from the API Gateway authorizer context.
    Supports HTTP API v2 JWT authorizer and REST API Cognito authorizer formats.
    """
    request_context = event.get('requestContext', {})
    
    # 1. HTTP API v2 JWT authorizer context
    authorizer = request_context.get('authorizer', {})
    jwt_claims = authorizer.get('jwt', {}).get('claims', {})
    if jwt_claims:
        user_id = jwt_claims.get('sub')
        email = jwt_claims.get('email') or jwt_claims.get('cognito:username')
        return user_id, email

    # 2. REST API Cognito authorizer context
    claims = authorizer.get('claims', {})
    if claims:
        user_id = claims.get('sub')
        email = claims.get('email') or claims.get('cognito:username')
        return user_id, email

    # 3. Direct custom headers fallback (e.g. testing)
    headers = event.get('headers', {}) or {}
    user_id = headers.get('x-user-id') or headers.get('X-User-Id')
    email = headers.get('x-user-email') or headers.get('X-User-Email')
    return user_id, email
