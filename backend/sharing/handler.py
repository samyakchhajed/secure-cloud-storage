"""
Sharing Module — Pure Business Logic Handler
Zero boto3 or AWS SDK imports.
"""

import json
import datetime
from typing import Any

from common.response import success, bad_request, unauthorized, not_found, server_error
from common.auth import get_user_identity
from sharing.adapters import DynamoDBSharingAdapter


def lambda_handler(event: dict, context: Any) -> dict:
    try:
        user_id, email = get_user_identity(event)
        if not user_id:
            return unauthorized('Authentication required. Missing valid JWT token.')

        http_context = event.get('requestContext', {}).get('http', {})
        method = http_context.get('method') or event.get('httpMethod', 'GET')
        raw_path = http_context.get('path') or event.get('rawPath') or event.get('path', '')

        db = DynamoDBSharingAdapter()

        if method == 'GET' and raw_path.endswith('/files/shared-with-me'):
            return handle_list_shared_with_me(email, db)

        elif method == 'POST' and '/share' in raw_path:
            file_id = raw_path.split('/api/files/')[-1].split('/share')[0]
            return handle_share_file(event, file_id, user_id, email, db)

        elif method == 'DELETE' and '/share/' in raw_path:
            parts = raw_path.split('/api/files/')[-1].split('/share/')
            file_id = parts[0]
            recipient_email = parts[1] if len(parts) > 1 else ''
            return handle_revoke_share(file_id, recipient_email, user_id, db)

        return not_found(f'No route matches {method} {raw_path}')

    except Exception as exc:
        return server_error(f'An unexpected error occurred: {str(exc)}')


def handle_share_file(
    event: dict,
    file_id: str,
    user_id: str,
    user_email: str,
    db: DynamoDBSharingAdapter
) -> dict:
    body = parse_json_body(event)
    recipient_email = (body.get('recipientEmail') or '').strip().lower()

    if not file_id:
        return bad_request('fileId is required.')
    if not recipient_email:
        return bad_request('recipientEmail is required.')
    if recipient_email == (user_email or '').lower():
        return bad_request('You cannot share a file with your own account.')

    file_meta = db.get_file(user_id, file_id)
    if not file_meta:
        return not_found('File not found or you do not have permission to share it.')

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    db.add_share(
        file_id=file_id,
        owner_id=user_id,
        owner_email=user_email or 'Owner',
        recipient_email=recipient_email,
        file_name=file_meta.get('fileName', 'file'),
        size_bytes=int(file_meta.get('sizeBytes', 0)),
        content_type=file_meta.get('contentType', 'application/octet-stream'),
        shared_at=now_iso
    )

    all_shares = db.list_shares_for_file(file_id)
    return success({
        'fileId': file_id,
        'sharedWith': all_shares
    })


def handle_revoke_share(
    file_id: str,
    recipient_email: str,
    user_id: str,
    db: DynamoDBSharingAdapter
) -> dict:
    if not file_id or not recipient_email:
        return bad_request('fileId and recipientEmail are required.')

    file_meta = db.get_file(user_id, file_id)
    if not file_meta:
        return not_found('File not found or access denied.')

    db.remove_share(file_id, recipient_email)
    all_shares = db.list_shares_for_file(file_id)

    return success({
        'fileId': file_id,
        'sharedWith': all_shares
    })


def handle_list_shared_with_me(recipient_email: str, db: DynamoDBSharingAdapter) -> dict:
    if not recipient_email:
        return success({'files': []})

    items = db.list_shared_with_me(recipient_email)
    formatted = [
        {
            'id': item.get('fileId'),
            'name': item.get('fileName', 'file'),
            'sizeBytes': int(item.get('sizeBytes', 0)),
            'contentType': item.get('contentType', 'application/octet-stream'),
            'ownerId': item.get('ownerId'),
            'ownerEmail': item.get('ownerEmail', 'Owner'),
            'permission': item.get('permission', 'VIEW'),
            'sharedAt': item.get('sharedAt')
        }
        for item in items
    ]
    return success({'files': formatted})


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
