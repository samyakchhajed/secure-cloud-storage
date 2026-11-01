variable "aws_region" {
  type        = string
  description = "AWS region for all resources"
  default     = "ap-south-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment tier (dev | prod)"
  default     = "dev"
}
