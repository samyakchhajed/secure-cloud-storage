"""
Folders Module — Pure Business Logic Handler
Zero boto3 or AWS SDK imports.
"""

import json
import uuid
import datetime
from typing import Any

from common.response import success, created, bad_request, unauthorized, not_found, server_error
from common.auth import get_user_identity
from folders.adapters import DynamoDBFoldersAdapter


def lambda_handler(event: dict, context: Any) -> dict:
    try:
        user_id, _ = get_user_identity(event)
        if not user_id:
            return unauthorized('Authentication required. Missing valid JWT token.')

        http_context = event.get('requestContext', {}).get('http', {})
        method = http_context.get('method') or event.get('httpMethod', 'GET')
        raw_path = http_context.get('path') or event.get('rawPath') or event.get('path', '')

        db = DynamoDBFoldersAdapter()

        if method == 'POST':
            return handle_create_folder(event, user_id, db)
        elif method == 'DELETE':
            folder_id = raw_path.split('/api/folders/')[-1].split('/')[0]
            return handle_delete_folder(folder_id, user_id, db)

        return not_found(f'No route matches {method} {raw_path}')

    except Exception as exc:
        return server_error(f'An unexpected error occurred: {str(exc)}')


def handle_create_folder(event: dict, user_id: str, db: DynamoDBFoldersAdapter) -> dict:
    body = parse_json_body(event)
    name = body.get('name', '').strip()
    parent_folder_id = body.get('parentFolderId') or None

    if not name:
        return bad_request('Folder name is required.')

    folder_id = f'folder_{uuid.uuid4().hex[:12]}'
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    db.create_folder(
        user_id=user_id,
        folder_id=folder_id,
        folder_name=name,
        parent_folder_id=parent_folder_id,
        created_at=now_iso
    )

    return created({
        'id': folder_id,
        'name': name,
        'parentFolderId': parent_folder_id,
        'createdAt': now_iso
    })


def handle_delete_folder(folder_id: str, user_id: str, db: DynamoDBFoldersAdapter) -> dict:
    if not folder_id:
        return bad_request('folderId is required.')

    if not db.is_folder_empty(user_id, folder_id):
        return bad_request('Folder is not empty. Please delete all internal files and subfolders first.')

    db.delete_folder(user_id, folder_id)
    return success({'message': f'Folder {folder_id} deleted successfully.'})


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
