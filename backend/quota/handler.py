"""
Quota Module — Pure Business Logic Handler
Zero boto3 or AWS SDK imports.
"""

from typing import Any

from common.response import success, unauthorized, server_error
from common.auth import get_user_identity
from quota.adapters import DynamoDBQuotaAdapter


def lambda_handler(event: dict, context: Any) -> dict:
    try:
        user_id, email = get_user_identity(event)
        if not user_id:
            return unauthorized('Authentication required. Missing valid JWT token.')

        db = DynamoDBQuotaAdapter()
        profile = db.get_user_quota_profile(user_id)
        file_count = db.count_user_files(user_id)

        quota_bytes = profile['quotaBytes']
        used_bytes = profile['usedBytes']
        percentage = min(100, round((used_bytes / quota_bytes) * 100)) if quota_bytes > 0 else 0

        return success({
            'userId': user_id,
            'email': email,
            'quotaBytes': quota_bytes,
            'usedBytes': used_bytes,
            'fileCount': file_count,
            'percentage': percentage
        })

    except Exception as exc:
        return server_error(f'An unexpected error occurred: {str(exc)}')
