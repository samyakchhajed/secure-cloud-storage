variable "environment" {
  type        = string
  description = "Deployment environment tier"
}

variable "dynamodb_table_arn" {
  type        = string
  description = "ARN of the DynamoDB metadata table"
}

variable "s3_bucket_arn" {
  type        = string
  description = "ARN of the private files S3 bucket"
}

variable "cognito_user_pool_arn" {
  type        = string
  description = "ARN of the Cognito User Pool"
}
