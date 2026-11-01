"""
Auth Module — AWS Adapters
DynamoDB-backed user store with HMAC-SHA256 JWT issuing.
Zero-Knowledge client-side encryption with recovery key support.
No Cognito. No external identity provider.
"""

import os
import json
import uuid
import hmac
import hashlib
import base64
import time
import boto3
from typing import Dict, Any, Optional


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += '=' * padding
    return base64.urlsafe_b64decode(s)


def _hash_password(password: str, salt: Optional[str] = None) -> tuple:
    """PBKDF2-HMAC-SHA256 password hashing using Python stdlib."""
    if salt is None:
        salt = uuid.uuid4().hex
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 260000)
    return salt, base64.b64encode(dk).decode('utf-8')


def _verify_password(password: str, salt: str, stored_hash: str) -> bool:
    # Accept direct match if client already hashed the password
    if hmac.compare_digest(password, stored_hash):
        return True
    _, computed = _hash_password(password, salt)
    return hmac.compare_digest(computed, stored_hash)


def _issue_jwt(user_id: str, email: str, secret: str, expires_in: int = 86400) -> str:
    """Issues a signed HS256 JWT."""
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    now = int(time.time())
    payload = _b64url_encode(json.dumps({
        "sub": user_id,
        "email": email,
        "iat": now,
        "exp": now + expires_in
    }).encode())
    signing_input = f"{header}.{payload}"
    sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url_encode(sig)}"


def _verify_jwt(token: str, secret: str) -> Optional[Dict[str, Any]]:
    """Verifies a HS256 JWT and returns claims, or None if invalid/expired."""
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        signing_input = f"{parts[0]}.{parts[1]}"
        expected_sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
        actual_sig = _b64url_decode(parts[2])
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        claims = json.loads(_b64url_decode(parts[1]))
        if claims.get('exp', 0) < int(time.time()):
            return None
        return claims
    except Exception:
        return None


class DynamoDBAuthAdapter:
    def __init__(self):
        self.table_name = os.environ.get('METADATA_TABLE_NAME', '')
        self.jwt_secret = os.environ.get('JWT_SECRET', '')
        self.dynamodb = boto3.resource('dynamodb')
        self.table = self.dynamodb.Table(self.table_name)

    def register(
        self,
        email: str,
        password_hash: str,
        password_salt: str,
        wrapped_mfk_password: str,
        wrapped_mfk_recovery: str
    ) -> Dict[str, Any]:
        """Creates a new user in DynamoDB with Zero-Knowledge wrapped MFKs."""
        existing = self.table.get_item(Key={'PK': f'EMAIL#{email}', 'SK': 'USER_INDEX'}).get('Item')
        if existing:
            raise ValueError('UsernameExistsException')

        user_id = f'user_{uuid.uuid4().hex[:16]}'
        now = int(time.time())

        # Write user profile
        self.table.put_item(Item={
            'PK': f'USER#{user_id}',
            'SK': 'PROFILE',
            'email': email,
            'passwordSalt': password_salt,
            'passwordHash': password_hash,
            'wrappedMfkByPassword': wrapped_mfk_password,
            'wrappedMfkByRecovery': wrapped_mfk_recovery,
            'usedBytes': 0,
            'quotaBytes': 5 * 1024 * 1024 * 1024,  # 5 GB default quota
            'fileCount': 0,
            'createdAt': now
        })

        # Write email index item for uniqueness + reverse lookup
        self.table.put_item(Item={
            'PK': f'EMAIL#{email}',
            'SK': 'USER_INDEX',
            'userId': user_id
        })
        return {'userId': user_id, 'email': email}

    def login(self, email: str, password: str) -> Dict[str, Any]:
        """Validates credentials and returns a signed JWT along with salt and wrapped MFK."""
        index_item = self.table.get_item(Key={'PK': f'EMAIL#{email}', 'SK': 'USER_INDEX'}).get('Item')
        if not index_item:
            raise ValueError('UserNotFoundException')
        user_id = index_item['userId']

        profile = self.table.get_item(Key={'PK': f'USER#{user_id}', 'SK': 'PROFILE'}).get('Item')
        if not profile:
            raise ValueError('UserNotFoundException')

        if not _verify_password(password, profile.get('passwordSalt', ''), profile.get('passwordHash', '')):
            raise ValueError('NotAuthorizedException')

        token = _issue_jwt(user_id, email, self.jwt_secret)
        return {
            'userId': user_id,
            'email': email,
            'token': token,
            'passwordSalt': profile.get('passwordSalt', ''),
            'wrappedMfkByPassword': profile.get('wrappedMfkByPassword', '')
        }

    def get_recovery_info(self, email: str) -> Dict[str, Any]:
        """Finds user by email and returns salt and MFK wrapped by recovery key."""
        index_item = self.table.get_item(Key={'PK': f'EMAIL#{email}', 'SK': 'USER_INDEX'}).get('Item')
        if not index_item:
            raise ValueError('UserNotFoundException')
        user_id = index_item['userId']

        profile = self.table.get_item(Key={'PK': f'USER#{user_id}', 'SK': 'PROFILE'}).get('Item')
        if not profile:
            raise ValueError('UserNotFoundException')

        return {
            'userId': user_id,
            'passwordSalt': profile.get('passwordSalt', ''),
            'wrappedMfkByRecovery': profile.get('wrappedMfkByRecovery', '')
        }

    def reset_password(
        self,
        email: str,
        new_password_hash: str,
        new_password_salt: str,
        new_wrapped_mfk_password: str,
        new_wrapped_mfk_recovery: str
    ) -> Dict[str, Any]:
        """Finds user by email and updates DynamoDB profile with new credentials and re-wrapped MFKs."""
        index_item = self.table.get_item(Key={'PK': f'EMAIL#{email}', 'SK': 'USER_INDEX'}).get('Item')
        if not index_item:
            raise ValueError('UserNotFoundException')
        user_id = index_item['userId']

        profile = self.table.get_item(Key={'PK': f'USER#{user_id}', 'SK': 'PROFILE'}).get('Item')
        if not profile:
            raise ValueError('UserNotFoundException')

        self.table.update_item(
            Key={'PK': f'USER#{user_id}', 'SK': 'PROFILE'},
            UpdateExpression='SET passwordHash = :ph, passwordSalt = :ps, wrappedMfkByPassword = :wmp, wrappedMfkByRecovery = :wmr',
            ExpressionAttributeValues={
                ':ph': new_password_hash,
                ':ps': new_password_salt,
                ':wmp': new_wrapped_mfk_password,
                ':wmr': new_wrapped_mfk_recovery
            }
        )

        return {'success': True, 'userId': user_id, 'email': email}

    def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Verifies JWT and returns claims. Used by the Lambda authorizer."""
        return _verify_jwt(token, self.jwt_secret)
