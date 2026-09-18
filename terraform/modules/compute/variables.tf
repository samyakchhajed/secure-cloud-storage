variable "environment" {
  type        = string
  description = "Deployment environment tier"
}

variable "lambda_role_arn" {
  type        = string
  description = "ARN of the Lambda execution role"
}

variable "dynamodb_table_name" {
  type        = string
  description = "Name of the DynamoDB metadata table"
}

variable "s3_bucket_name" {
  type        = string
  description = "Name of the private files S3 bucket"
}

variable "cognito_user_pool_id" {
  type        = string
  description = "ID of the Cognito User Pool"
}

variable "cognito_user_pool_endpoint" {
  type        = string
  description = "Endpoint of the Cognito User Pool"
}

variable "cognito_client_id" {
  type        = string
  description = "ID of the Cognito App Client"
}
