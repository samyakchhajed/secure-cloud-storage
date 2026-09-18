"""
Files Module — Pure Business Logic Handler
Zero boto3 or AWS SDK imports. All AWS communication routed through adapters.
"""

import json
import uuid
import datetime
from typing import Dict, Any, Optional

from common.response import success, created, bad_request, unauthorized, forbidden, not_found, server_error
from common.auth import get_user_identity
from files.adapters import S3StorageAdapter, DynamoDBFilesAdapter


def lambda_handler(event: dict, context: Any) -> dict:
    """
    Main Lambda entry point for File operations.
    Dispatches to appropriate pure Python handlers.
    """
    try:
        user_id, email = get_user_identity(event)
        if not user_id:
            return unauthorized('Authentication required. Missing valid JWT token.')

        http_context = event.get('requestContext', {}).get('http', {})
        method = http_context.get('method') or event.get('httpMethod', 'GET')
        raw_path = http_context.get('path') or event.get('rawPath') or event.get('path', '')

        storage = S3StorageAdapter()
        db = DynamoDBFilesAdapter()

        # Route matching
        if method == 'POST' and raw_path.endswith('/upload-url'):
            return handle_get_upload_url(event, user_id, storage, db)

        elif method == 'POST' and raw_path.endswith('/confirm'):
            return handle_confirm_upload(event, user_id, db)

        elif method == 'GET' and (raw_path.endswith('/files') or raw_path.endswith('/files/')):
            return handle_list_files(event, user_id, db)

        elif method == 'GET' and '/download-url' in raw_path:
            file_id = extract_file_id_from_path(raw_path, '/download-url')
            return handle_get_download_url(file_id, user_id, email, storage, db)

        elif method == 'DELETE' and '/api/files/' in raw_path:
            file_id = raw_path.split('/api/files/')[-1].split('/')[0]
            return handle_delete_file(file_id, user_id, storage, db)

        return not_found(f'No route matches {method} {raw_path}')

    except Exception as exc:
        return server_error(f'An unexpected error occurred: {str(exc)}')


def extract_file_id_from_path(path: str, suffix: str) -> str:
    # Example: /api/files/file_123/download-url -> file_123
    prefix = '/api/files/'
    start = path.find(prefix) + len(prefix)
    end = path.find(suffix)
    return path[start:end]


def handle_get_upload_url(
    event: dict,
    user_id: str,
    storage: S3StorageAdapter,
    db: DynamoDBFilesAdapter
) -> dict:
    """Validates quota and generates a 5-minute presigned PUT URL with SSE-S3."""
    body = parse_json_body(event)
    file_name = body.get('fileName', '').strip()
    size_bytes = int(body.get('sizeBytes', 0))
    content_type = body.get('contentType', 'application/octet-stream')
    folder_id = body.get('folderId') or None

    if not file_name:
        return bad_request('fileName is required.')
    if size_bytes <= 0:
        return bad_request('sizeBytes must be greater than 0.')

    # Check user quota
    quota = db.get_user_quota(user_id)
    if quota['usedBytes'] + size_bytes > quota['quotaBytes']:
        available_mb = round((quota['quotaBytes'] - quota['usedBytes']) / 1024 / 1024, 1)
        return bad_request(f'Storage quota exceeded. Available space: {available_mb} MB.')

    file_id = f'file_{uuid.uuid4().hex[:12]}'
    s3_key = f'objects/{user_id}/{file_id}/{file_name}'

    presigned_url = storage.generate_presigned_put_url(
        s3_key=s3_key,
        content_type=content_type,
        expires_in=300
    )

    return success({
        'fileId': file_id,
        'fileName': file_name,
        's3Key': s3_key,
        'sizeBytes': size_bytes,
        'contentType': content_type,
        'folderId': folder_id,
        'presignedUrl': presigned_url,
        'expiresInSeconds': 300,
        'headers': {
            'x-amz-server-side-encryption': 'AES256'
        }
    })


def handle_confirm_upload(
    event: dict,
    user_id: str,
    db: DynamoDBFilesAdapter
) -> dict:
    """Records the uploaded file metadata in DynamoDB and updates the storage quota."""
    body = parse_json_body(event)
    file_id = body.get('fileId')
    file_name = body.get('fileName', '').strip()
    size_bytes = int(body.get('sizeBytes', 0))
    content_type = body.get('contentType', 'application/octet-stream')
    folder_id = body.get('folderId') or None

    if not file_id or not file_name:
        return bad_request('fileId and fileName are required.')

    s3_key = f'objects/{user_id}/{file_id}/{file_name}'
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    db.save_file_metadata(
        user_id=user_id,
        file_id=file_id,
        file_name=file_name,
        s3_key=s3_key,
        size_bytes=size_bytes,
        content_type=content_type,
        folder_id=folder_id,
        created_at=now_iso
    )

    return created({
        'fileId': file_id,
        'fileName': file_name,
        'sizeBytes': size_bytes,
        'contentType': content_type,
        'folderId': folder_id,
        'createdAt': now_iso
    })


def handle_list_files(
    event: dict,
    user_id: str,
    db: DynamoDBFilesAdapter
) -> dict:
    """Lists folders and files in the requested directory along with breadcrumbs."""
    query_params = event.get('queryStringParameters') or {}
    folder_id = query_params.get('folderId') or None

    folders = db.list_folders_in_folder(user_id, folder_id)
    files = db.list_files_in_folder(user_id, folder_id)

    # Build breadcrumb trail
    breadcrumbs = [{'id': None, 'name': 'My Drive'}]
    if folder_id:
        curr = db.get_folder_by_id(user_id, folder_id)
        trail = []
        while curr:
            trail.insert(0, {'id': curr.get('folderId') or folder_id, 'name': curr.get('folderName', 'Folder')})
            parent_id = curr.get('parentFolderId')
            curr = db.get_folder_by_id(user_id, parent_id) if parent_id else None
        breadcrumbs.extend(trail)

    # Format output items
    formatted_folders = [
        {
            'id': f.get('folderId') or f.get('SK', '').replace('FOLDER#', ''),
            'name': f.get('folderName', 'Folder'),
            'parentFolderId': f.get('parentFolderId'),
            'createdAt': f.get('createdAt')
        }
        for f in folders
    ]

    formatted_files = [
        {
            'id': f.get('fileId') or f.get('SK', '').replace('FILE#', ''),
            'name': f.get('fileName', 'File'),
            'sizeBytes': int(f.get('sizeBytes', 0)),
            'contentType': f.get('contentType', 'application/octet-stream'),
            'folderId': f.get('folderId'),
            'createdAt': f.get('createdAt'),
            'shares': f.get('shares', [])
        }
        for f in files
    ]

    return success({
        'currentFolderId': folder_id,
        'breadcrumbs': breadcrumbs,
        'folders': formatted_folders,
        'files': formatted_files
    })


def handle_get_download_url(
    file_id: str,
    user_id: str,
    email: Optional[str],
    storage: S3StorageAdapter,
    db: DynamoDBFilesAdapter
) -> dict:
    """
    Authorizes caller (Owner or Shared Viewer) and generates presigned GET URL.
    """
    if not file_id:
        return bad_request('fileId is required.')

    # 1. Check if caller is the owner
    file_meta = db.get_file_metadata(user_id, file_id)

    # 2. If not owner, check if file is shared with caller's email
    if not file_meta and email:
        is_shared = db.check_file_share_access(file_id, email)
        if is_shared:
            file_meta = db.get_file_by_id_any_user(file_id)

    if not file_meta:
        return forbidden('Access denied: You do not have permission to view or download this file.')

    s3_key = file_meta.get('s3Key')
    file_name = file_meta.get('fileName', 'download')

    presigned_url = storage.generate_presigned_get_url(
        s3_key=s3_key,
        download_filename=file_name,
        expires_in=300
    )

    return success({
        'fileId': file_id,
        'fileName': file_name,
        'downloadUrl': presigned_url,
        'expiresInSeconds': 300
    })


def handle_delete_file(
    file_id: str,
    user_id: str,
    storage: S3StorageAdapter,
    db: DynamoDBFilesAdapter
) -> dict:
    """Verifies file ownership, deletes S3 object, removes DynamoDB record, and reclaims quota."""
    if not file_id:
        return bad_request('fileId is required.')

    file_meta = db.get_file_metadata(user_id, file_id)
    if not file_meta:
        return not_found('File not found or access denied.')

    s3_key = file_meta.get('s3Key')
    size_bytes = int(file_meta.get('sizeBytes', 0))

    # Delete from S3 and DynamoDB
    if s3_key:
        storage.delete_object(s3_key)
    db.delete_file_metadata(user_id, file_id, size_bytes)

    return success({'message': f'File {file_id} deleted successfully.'})


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
