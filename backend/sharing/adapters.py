"""
Sharing Module — AWS Adapters
DynamoDB single-table and GSI queries for multi-user file sharing.
"""

import os
import boto3
from typing import Dict, Any, List, Optional


class DynamoDBSharingAdapter:
    def __init__(self, table_name: Optional[str] = None):
        self.table_name = table_name or os.environ.get('METADATA_TABLE_NAME', '')
        self.dynamodb = boto3.resource('dynamodb')
        self.table = self.dynamodb.Table(self.table_name)

    def get_file(self, owner_id: str, file_id: str) -> Optional[Dict[str, Any]]:
        resp = self.table.get_item(
            Key={'PK': f'USER#{owner_id}', 'SK': f'FILE#{file_id}'}
        )
        return resp.get('Item')

    def add_share(
        self,
        file_id: str,
        owner_id: str,
        owner_email: str,
        recipient_email: str,
        file_name: str,
        size_bytes: int,
        content_type: str,
        shared_at: str
    ) -> None:
        # Write share ACL record indexed by recipient in GSI1
        self.table.put_item(
            Item={
                'PK': f'FILE#{file_id}',
                'SK': f'SHARE#{recipient_email.lower()}',
                'GSI1PK': f'RECIPIENT#{recipient_email.lower()}',
                'GSI1SK': f'FILE#{file_id}',
                'fileId': file_id,
                'ownerId': owner_id,
                'ownerEmail': owner_email,
                'sharedWithEmail': recipient_email.lower(),
                'permission': 'VIEW',
                'fileName': file_name,
                'sizeBytes': size_bytes,
                'contentType': content_type,
                'sharedAt': shared_at
            }
        )

    def remove_share(self, file_id: str, recipient_email: str) -> None:
        self.table.delete_item(
            Key={'PK': f'FILE#{file_id}', 'SK': f'SHARE#{recipient_email.lower()}'}
        )

    def list_shares_for_file(self, file_id: str) -> List[str]:
        resp = self.table.query(
            KeyConditionExpression='PK = :pk AND begins_with(SK, :skPrefix)',
            ExpressionAttributeValues={
                ':pk': f'FILE#{file_id}',
                ':skPrefix': 'SHARE#'
            }
        )
        return [item.get('sharedWithEmail') for item in resp.get('Items', []) if item.get('sharedWithEmail')]

    def list_shared_with_me(self, recipient_email: str) -> List[Dict[str, Any]]:
        # Query GSI1 by recipient email
        resp = self.table.query(
            IndexName='GSI1',
            KeyConditionExpression='GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)',
            ExpressionAttributeValues={
                ':pk': f'RECIPIENT#{recipient_email.lower()}',
                ':skPrefix': 'FILE#'
            }
        )
        return resp.get('Items', [])
