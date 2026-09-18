"""
Standard API Gateway HTTP Response Builder
Provides uniform CORS headers, HTTP status codes, and Decimal JSON serialization.
"""

import json
from decimal import Decimal

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
}


class DecimalEncoder(json.JSONEncoder):
    """Encodes DynamoDB Decimal types to standard Python int or float."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super().default(obj)


def build_response(status_code: int, body: dict) -> dict:
    """Builds a standard API Gateway response."""
    return {
        'statusCode': status_code,
        'headers': CORS_HEADERS,
        'body': json.dumps(body, cls=DecimalEncoder)
    }


def success(data: dict = None, status_code: int = 200) -> dict:
    return build_response(status_code, data or {'success': True})


def created(data: dict) -> dict:
    return build_response(201, data)


def bad_request(message: str) -> dict:
    return build_response(400, {'error': message})


def unauthorized(message: str = 'Unauthorized') -> dict:
    return build_response(401, {'error': message})


def forbidden(message: str = 'Forbidden') -> dict:
    return build_response(403, {'error': message})


def not_found(message: str = 'Resource not found') -> dict:
    return build_response(404, {'error': message})


def server_error(message: str = 'Internal server error') -> dict:
    return build_response(500, {'error': message})
