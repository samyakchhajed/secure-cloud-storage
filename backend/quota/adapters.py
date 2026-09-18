"""
Quota Module — AWS Adapters
DynamoDB queries for user quota and usage metrics.
"""

import os
import boto3
from typing import Dict, Any, Optional


class DynamoDBQuotaAdapter:
    def __init__(self, table_name: Optional[str] = None):
        self.table_name = table_name or os.environ.get('METADATA_TABLE_NAME', '')
        self.dynamodb = boto3.resource('dynamodb')
        self.table = self.dynamodb.Table(self.table_name)

    def get_user_quota_profile(self, user_id: str) -> Dict[str, Any]:
        resp = self.table.get_item(
            Key={'PK': f'USER#{user_id}', 'SK': 'PROFILE'}
        )
        item = resp.get('Item') or {}
        return {
            'quotaBytes': int(item.get('quotaBytes', 1073741824)),
            'usedBytes': int(item.get('usedBytes', 0))
        }

    def count_user_files(self, user_id: str) -> int:
        resp = self.table.query(
            KeyConditionExpression='PK = :pk AND begins_with(SK, :skPrefix)',
            Select='COUNT',
            ExpressionAttributeValues={
                ':pk': f'USER#{user_id}',
                ':skPrefix': 'FILE#'
            }
        )
        return resp.get('Count', 0)
