# Cognito Module — User Pool & App Client for Email/Password Authentication

resource "aws_cognito_user_pool" "pool" {
  name = "scs-user-pool-${var.environment}"

  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your Secure Cloud Storage Verification Code"
    email_message        = "Your verification code is {####}. Please enter this code to activate your account."
  }

  schema {
    attribute_data_type = "String"
    name                = "email"
    required            = true
    mutable             = true
  }

  tags = {
    Name        = "Secure Cloud Storage Cognito Pool"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

resource "aws_cognito_user_pool_client" "client" {
  name         = "scs-web-client-${var.environment}"
  user_pool_id = aws_cognito_user_pool.pool.id

  generate_secret = false # Web client without secret

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  prevent_user_existence_errors = "ENABLED"
}
