"""
Folders Module — AWS Adapters
Isolates DynamoDB communication for folder creation and deletion.
"""

import os
import boto3
from typing import Dict, Any, Optional


class DynamoDBFoldersAdapter:
    def __init__(self, table_name: Optional[str] = None):
        self.table_name = table_name or os.environ.get('METADATA_TABLE_NAME', '')
        self.dynamodb = boto3.resource('dynamodb')
        self.table = self.dynamodb.Table(self.table_name)

    def create_folder(
        self,
        user_id: str,
        folder_id: str,
        folder_name: str,
        parent_folder_id: Optional[str],
        created_at: str
    ) -> None:
        self.table.put_item(
            Item={
                'PK': f'USER#{user_id}',
                'SK': f'FOLDER#{folder_id}',
                'folderId': folder_id,
                'userId': user_id,
                'folderName': folder_name,
                'parentFolderId': parent_folder_id,
                'createdAt': created_at
            }
        )

    def delete_folder(self, user_id: str, folder_id: str) -> None:
        self.table.delete_item(
            Key={'PK': f'USER#{user_id}', 'SK': f'FOLDER#{folder_id}'}
        )

    def is_folder_empty(self, user_id: str, folder_id: str) -> bool:
        # Check files
        files_resp = self.table.query(
            KeyConditionExpression='PK = :pk AND begins_with(SK, :skPrefix)',
            ExpressionAttributeValues={
                ':pk': f'USER#{user_id}',
                ':skPrefix': 'FILE#'
            }
        )
        if any(f.get('folderId') == folder_id for f in files_resp.get('Items', [])):
            return False

        # Check subfolders
        folders_resp = self.table.query(
            KeyConditionExpression='PK = :pk AND begins_with(SK, :skPrefix)',
            ExpressionAttributeValues={
                ':pk': f'USER#{user_id}',
                ':skPrefix': 'FOLDER#'
            }
        )
        if any(f.get('parentFolderId') == folder_id for f in folders_resp.get('Items', [])):
            return False

        return True
