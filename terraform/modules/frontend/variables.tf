variable "environment" {
  type        = string
  description = "Deployment environment tier"
}

variable "aws_region" {
  type        = string
  description = "Target AWS region"
}

variable "account_id" {
  type        = string
  description = "AWS Account ID for globally unique bucket naming"
}
