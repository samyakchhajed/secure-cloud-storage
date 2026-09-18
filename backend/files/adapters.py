"""
Files Module — AWS Adapters
The ONLY file in the files module that imports boto3 and interfaces with AWS resources.
"""

import os
import boto3
from typing import Dict, Any, List, Optional


class S3StorageAdapter:
    def __init__(self, bucket_name: Optional[str] = None):
        self.bucket_name = bucket_name or os.environ.get('FILES_BUCKET_NAME', '')
        self.s3_client = boto3.client('s3')

    def generate_presigned_put_url(
        self,
        s3_key: str,
        content_type: str,
        expires_in: int = 300
    ) -> str:
        """
        Generates a 5-minute presigned PUT URL requiring SSE-S3 AES-256 encryption.
        """
        params = {
            'Bucket': self.bucket_name,
            'Key': s3_key,
            'ContentType': content_type,
            'ServerSideEncryption': 'AES256'
        }
        return self.s3_client.generate_presigned_url(
            ClientMethod='put_object',
            Params=params,
            ExpiresIn=expires_in,
            HttpMethod='PUT'
        )

    def generate_presigned_get_url(
        self,
        s3_key: str,
        download_filename: str,
        expires_in: int = 300
    ) -> str:
        """
        Generates a 5-minute presigned GET URL with custom Content-Disposition header.
        """
        params = {
            'Bucket': self.bucket_name,
            'Key': s3_key,
            'ResponseContentDisposition': f'attachment; filename="{download_filename}"'
        }
        return self.s3_client.generate_presigned_url(
            ClientMethod='get_object',
            Params=params,
            ExpiresIn=expires_in,
            HttpMethod='GET'
        )

    def delete_object(self, s3_key: str) -> None:
        self.s3_client.delete_object(
            Bucket=self.bucket_name,
            Key=s3_key
        )


class DynamoDBFilesAdapter:
    def __init__(self, table_name: Optional[str] = None):
        self.table_name = table_name or os.environ.get('METADATA_TABLE_NAME', '')
        self.dynamodb = boto3.resource('dynamodb')
        self.table = self.dynamodb.Table(self.table_name)

    def get_user_quota(self, user_id: str) -> Dict[str, Any]:
        resp = self.table.get_item(
            Key={'PK': f'USER#{user_id}', 'SK': 'PROFILE'}
        )
        item = resp.get('Item')
        if not item:
            # Default profile: 1 GB quota
            return {
                'userId': user_id,
                'quotaBytes': 1073741824,
                'usedBytes': 0
            }
        return {
            'userId': user_id,
            'quotaBytes': int(item.get('quotaBytes', 1073741824)),
            'usedBytes': int(item.get('usedBytes', 0))
        }

    def save_file_metadata(
        self,
        user_id: str,
        file_id: str,
        file_name: str,
        s3_key: str,
        size_bytes: int,
        content_type: str,
        folder_id: Optional[str],
        created_at: str
    ) -> None:
        # Atomic file write & quota increment in DynamoDB
        self.table.put_item(
            Item={
                'PK': f'USER#{user_id}',
                'SK': f'FILE#{file_id}',
                'GSI1PK': f'FOLDER#{folder_id or "ROOT"}',
                'GSI1SK': f'FILE#{file_name}',
                'fileId': file_id,
                'userId': user_id,
                'fileName': file_name,
                's3Key': s3_key,
                'sizeBytes': size_bytes,
                'contentType': content_type,
                'folderId': folder_id,
                'createdAt': created_at,
                'updatedAt': created_at,
                'shares': []
            }
        )
        # Increment usedBytes in user profile
        self.table.update_item(
            Key={'PK': f'USER#{user_id}', 'SK': 'PROFILE'},
            UpdateExpression='ADD usedBytes :size SET quotaBytes = if_not_exists(quotaBytes, :defaultQuota)',
            ExpressionAttributeValues={
                ':size': size_bytes,
                ':defaultQuota': 1073741824
            }
        )

    def get_file_metadata(self, user_id: str, file_id: str) -> Optional[Dict[str, Any]]:
        resp = self.table.get_item(
            Key={'PK': f'USER#{user_id}', 'SK': f'FILE#{file_id}'}
        )
        return resp.get('Item')

    def get_file_by_id_any_user(self, file_id: str) -> Optional[Dict[str, Any]]:
        # Used to verify viewer permissions on shared files
        resp = self.table.query(
            IndexName='GSI1',
            KeyConditionExpression='GSI1SK = :fileId',
            ExpressionAttributeValues={':fileId': f'FILE#{file_id}'}
        )
        items = resp.get('Items', [])
        return items[0] if items else None

    def delete_file_metadata(self, user_id: str, file_id: str, size_bytes: int) -> None:
        self.table.delete_item(
            Key={'PK': f'USER#{user_id}', 'SK': f'FILE#{file_id}'}
        )
        # Decrement usedBytes (negative addition)
        self.table.update_item(
            Key={'PK': f'USER#{user_id}', 'SK': 'PROFILE'},
            UpdateExpression='ADD usedBytes :negSize',
            ExpressionAttributeValues={':negSize': -size_bytes}
        )

    def list_files_in_folder(self, user_id: str, folder_id: Optional[str]) -> List[Dict[str, Any]]:
        # Query items for user where PK = USER#<id>
        resp = self.table.query(
            KeyConditionExpression='PK = :pk AND begins_with(SK, :skPrefix)',
            ExpressionAttributeValues={
                ':pk': f'USER#{user_id}',
                ':skPrefix': 'FILE#'
            }
        )
        items = resp.get('Items', [])
        # Filter in-memory for folder matching
        target_folder = folder_id or None
        return [i for i in items if i.get('folderId') == target_folder]

    def list_folders_in_folder(self, user_id: str, parent_folder_id: Optional[str]) -> List[Dict[str, Any]]:
        resp = self.table.query(
            KeyConditionExpression='PK = :pk AND begins_with(SK, :skPrefix)',
            ExpressionAttributeValues={
                ':pk': f'USER#{user_id}',
                ':skPrefix': 'FOLDER#'
            }
        )
        items = resp.get('Items', [])
        target_parent = parent_folder_id or None
        return [i for i in items if i.get('parentFolderId') == target_parent]

    def get_folder_by_id(self, user_id: str, folder_id: str) -> Optional[Dict[str, Any]]:
        resp = self.table.get_item(
            Key={'PK': f'USER#{user_id}', 'SK': f'FOLDER#{folder_id}'}
        )
        return resp.get('Item')

    def check_file_share_access(self, file_id: str, recipient_email: str) -> bool:
        resp = self.table.get_item(
            Key={'PK': f'FILE#{file_id}', 'SK': f'SHARE#{recipient_email.lower()}'}
        )
        return bool(resp.get('Item'))
