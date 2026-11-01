"""
JWT Token Context & Identity Parser
Extracts authenticated user claims injected by the custom Lambda Authorizer.
"""

from typing import Optional, Tuple


def get_user_identity(event: dict) -> Tuple[Optional[str], Optional[str]]:
    """
    Extracts (user_id, email) from the API Gateway Lambda Authorizer context.
    The custom Lambda Authorizer injects userId and email into requestContext.authorizer.lambda.
    Falls back to direct headers for local testing.
    """
    request_context = event.get('requestContext', {})
    authorizer = request_context.get('authorizer', {})

    # 1. HTTP API v2 Lambda authorizer context (payload format 2.0)
    lambda_ctx = authorizer.get('lambda', {})
    if lambda_ctx:
        user_id = lambda_ctx.get('userId')
        email = lambda_ctx.get('email')
        return user_id, email

    # 2. Legacy JWT authorizer context (kept for safety)
    jwt_claims = authorizer.get('jwt', {}).get('claims', {})
    if jwt_claims:
        user_id = jwt_claims.get('sub')
        email = jwt_claims.get('email')
        return user_id, email

    # 3. Direct custom headers fallback (local testing only)
    headers = event.get('headers', {}) or {}
    user_id = headers.get('x-user-id') or headers.get('X-User-Id')
    email = headers.get('x-user-email') or headers.get('X-User-Email')
    return user_id, email
