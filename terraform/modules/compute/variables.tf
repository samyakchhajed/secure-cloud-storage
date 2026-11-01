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

variable "jwt_secret" {
  type        = string
  description = "HMAC secret key for signing and verifying custom JWTs"
  sensitive   = true
}
