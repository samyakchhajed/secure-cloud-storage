"""
Auth Module — AWS Adapters
Isolates boto3 cognito-idp communication for registration, verification, and login.
"""

import os
import boto3
from typing import Dict, Any, Optional


class CognitoAuthAdapter:
    def __init__(self, client_id: Optional[str] = None, user_pool_id: Optional[str] = None):
        self.client_id = client_id or os.environ.get('COGNITO_CLIENT_ID', '')
        self.user_pool_id = user_pool_id or os.environ.get('COGNITO_USER_POOL_ID', '')
        self.client = boto3.client('cognito-idp')

    def register(self, email: str, password: str) -> Dict[str, Any]:
        """Registers a new user in Cognito User Pool."""
        return self.client.sign_up(
            ClientId=self.client_id,
            Username=email.strip().lower(),
            Password=password,
            UserAttributes=[
                {'Name': 'email', 'Value': email.strip().lower()}
            ]
        )

    def verify(self, email: str, code: str) -> Dict[str, Any]:
        """Confirms user email verification code."""
        return self.client.confirm_sign_up(
            ClientId=self.client_id,
            Username=email.strip().lower(),
            ConfirmationCode=code.strip()
        )

    def login(self, email: str, password: str) -> Dict[str, Any]:
        """Authenticates user with USER_PASSWORD_AUTH and returns JWT tokens."""
        return self.client.initiate_auth(
            ClientId=self.client_id,
            AuthFlow='USER_PASSWORD_AUTH',
            AuthParameters={
                'USERNAME': email.strip().lower(),
                'PASSWORD': password
            }
        )
