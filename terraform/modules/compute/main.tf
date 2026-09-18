# Compute Module — Lambda Functions & API Gateway HTTP API v2 with Cognito JWT Authorizer

# 1. Package backend code into zip archive
data "archive_file" "backend_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../backend"
  output_path = "${path.module}/build/backend.zip"
  excludes    = ["__pycache__", "*.pyc", ".pytest_cache"]
}

# 2. Auth Lambda Function (Public signup, verify, login)
resource "aws_lambda_function" "auth_lambda" {
  function_name    = "scs-auth-${var.environment}"
  role             = var.lambda_role_arn
  handler          = "auth.handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 15
  memory_size      = 128
  filename         = data.archive_file.backend_zip.output_path
  source_code_hash = data.archive_file.backend_zip.output_base64sha256

  environment {
    variables = {
      COGNITO_CLIENT_ID    = var.cognito_client_id
      COGNITO_USER_POOL_ID = var.cognito_user_pool_id
    }
  }

  tags = {
    Name        = "Secure Cloud Storage Auth Lambda"
    Environment = var.environment
  }
}

# 3. Files Lambda Function
resource "aws_lambda_function" "files_lambda" {
  function_name    = "scs-files-${var.environment}"
  role             = var.lambda_role_arn
  handler          = "files.handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 15
  memory_size      = 128
  filename         = data.archive_file.backend_zip.output_path
  source_code_hash = data.archive_file.backend_zip.output_base64sha256

  environment {
    variables = {
      METADATA_TABLE_NAME = var.dynamodb_table_name
      FILES_BUCKET_NAME   = var.s3_bucket_name
    }
  }

  tags = {
    Name        = "Secure Cloud Storage Files Lambda"
    Environment = var.environment
  }
}

# 4. Folders Lambda Function
resource "aws_lambda_function" "folders_lambda" {
  function_name    = "scs-folders-${var.environment}"
  role             = var.lambda_role_arn
  handler          = "folders.handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 10
  memory_size      = 128
  filename         = data.archive_file.backend_zip.output_path
  source_code_hash = data.archive_file.backend_zip.output_base64sha256

  environment {
    variables = {
      METADATA_TABLE_NAME = var.dynamodb_table_name
    }
  }

  tags = {
    Name        = "Secure Cloud Storage Folders Lambda"
    Environment = var.environment
  }
}

# 5. Sharing Lambda Function
resource "aws_lambda_function" "sharing_lambda" {
  function_name    = "scs-sharing-${var.environment}"
  role             = var.lambda_role_arn
  handler          = "sharing.handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 10
  memory_size      = 128
  filename         = data.archive_file.backend_zip.output_path
  source_code_hash = data.archive_file.backend_zip.output_base64sha256

  environment {
    variables = {
      METADATA_TABLE_NAME = var.dynamodb_table_name
    }
  }

  tags = {
    Name        = "Secure Cloud Storage Sharing Lambda"
    Environment = var.environment
  }
}

# 6. Quota Lambda Function
resource "aws_lambda_function" "quota_lambda" {
  function_name    = "scs-quota-${var.environment}"
  role             = var.lambda_role_arn
  handler          = "quota.handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 10
  memory_size      = 128
  filename         = data.archive_file.backend_zip.output_path
  source_code_hash = data.archive_file.backend_zip.output_base64sha256

  environment {
    variables = {
      METADATA_TABLE_NAME = var.dynamodb_table_name
    }
  }

  tags = {
    Name        = "Secure Cloud Storage Quota Lambda"
    Environment = var.environment
  }
}

# ==========================================================================
# API Gateway HTTP API (v2)
# ==========================================================================

resource "aws_apigatewayv2_api" "http_api" {
  name          = "scs-api-${var.environment}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization", "X-Amz-Date", "X-Api-Key", "X-Amz-Security-Token"]
    max_age       = 3600
  }

  tags = {
    Name        = "Secure Cloud Storage HTTP API"
    Environment = var.environment
  }
}

# Cognito JWT Authorizer
resource "aws_apigatewayv2_authorizer" "jwt_authorizer" {
  api_id           = aws_apigatewayv2_api.http_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "scs-cognito-jwt-auth"

  jwt_configuration {
    audience = [var.cognito_client_id]
    issuer   = "https://${var.cognito_user_pool_endpoint}"
  }
}

# Lambda Integrations
resource "aws_apigatewayv2_integration" "auth_integration" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth_lambda.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "files_integration" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.files_lambda.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "folders_integration" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.folders_lambda.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "sharing_integration" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sharing_lambda.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "quota_integration" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.quota_lambda.arn
  payload_format_version = "2.0"
}

# Routes — Auth (Public endpoints — No JWT Authorizer)
resource "aws_apigatewayv2_route" "auth_register" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /api/auth/register"
  target    = "integrations/${aws_apigatewayv2_integration.auth_integration.id}"
}

resource "aws_apigatewayv2_route" "auth_verify" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /api/auth/verify"
  target    = "integrations/${aws_apigatewayv2_integration.auth_integration.id}"
}

resource "aws_apigatewayv2_route" "auth_login" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /api/auth/login"
  target    = "integrations/${aws_apigatewayv2_integration.auth_integration.id}"
}

# Routes — Files (Protected by Cognito JWT Authorizer)
resource "aws_apigatewayv2_route" "files_upload_url" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /api/files/upload-url"
  target             = "integrations/${aws_apigatewayv2_integration.files_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

resource "aws_apigatewayv2_route" "files_confirm" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /api/files/confirm"
  target             = "integrations/${aws_apigatewayv2_integration.files_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

resource "aws_apigatewayv2_route" "files_list" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /api/files"
  target             = "integrations/${aws_apigatewayv2_integration.files_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

resource "aws_apigatewayv2_route" "files_download_url" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /api/files/{fileId}/download-url"
  target             = "integrations/${aws_apigatewayv2_integration.files_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

resource "aws_apigatewayv2_route" "files_delete" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "DELETE /api/files/{fileId}"
  target             = "integrations/${aws_apigatewayv2_integration.files_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

# Routes — Folders (Protected by Cognito JWT Authorizer)
resource "aws_apigatewayv2_route" "folders_create" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /api/folders"
  target             = "integrations/${aws_apigatewayv2_integration.folders_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

resource "aws_apigatewayv2_route" "folders_delete" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "DELETE /api/folders/{folderId}"
  target             = "integrations/${aws_apigatewayv2_integration.folders_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

# Routes — Sharing (Protected by Cognito JWT Authorizer)
resource "aws_apigatewayv2_route" "sharing_add" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /api/files/{fileId}/share"
  target             = "integrations/${aws_apigatewayv2_integration.sharing_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

resource "aws_apigatewayv2_route" "sharing_revoke" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "DELETE /api/files/{fileId}/share/{recipientEmail}"
  target             = "integrations/${aws_apigatewayv2_integration.sharing_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

resource "aws_apigatewayv2_route" "sharing_list" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /api/files/shared-with-me"
  target             = "integrations/${aws_apigatewayv2_integration.sharing_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

# Routes — Quota (Protected by Cognito JWT Authorizer)
resource "aws_apigatewayv2_route" "quota_get" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /api/user/quota"
  target             = "integrations/${aws_apigatewayv2_integration.quota_integration.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt_authorizer.id
  authorization_type = "JWT"
}

# Default Auto-Deploy Stage
resource "aws_apigatewayv2_stage" "default_stage" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true
}

# Lambda Permissions for API Gateway
resource "aws_lambda_permission" "api_gw_auth" {
  statement_id  = "AllowExecutionFromAPIGatewayAuth"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.arn}/*/*"
}

resource "aws_lambda_permission" "api_gw_files" {
  statement_id  = "AllowExecutionFromAPIGatewayFiles"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.files_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.arn}/*/*"
}

resource "aws_lambda_permission" "api_gw_folders" {
  statement_id  = "AllowExecutionFromAPIGatewayFolders"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.folders_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.arn}/*/*"
}

resource "aws_lambda_permission" "api_gw_sharing" {
  statement_id  = "AllowExecutionFromAPIGatewaySharing"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sharing_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.arn}/*/*"
}

resource "aws_lambda_permission" "api_gw_quota" {
  statement_id  = "AllowExecutionFromAPIGatewayQuota"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.quota_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.arn}/*/*"
}
