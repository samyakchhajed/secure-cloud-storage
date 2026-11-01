# Secure Cloud File Storage — Root Terraform Configuration

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state backend — configured dynamically during terraform init
  # via -backend-config flags in GitHub Actions / CLI (zero hardcoded bucket names)
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "SecureCloudStorage"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

# 1. Storage Module (Private S3 with SSE-S3 & BPA)
module "storage" {
  source      = "./modules/storage"
  environment = var.environment
  aws_region  = var.aws_region
  account_id  = data.aws_caller_identity.current.account_id
}

# 2. Database Module (DynamoDB Single-Table On-Demand)
module "database" {
  source      = "./modules/database"
  environment = var.environment
}

# 3. IAM Module (Least-Privilege Execution Role)
module "iam" {
  source             = "./modules/iam"
  environment        = var.environment
  dynamodb_table_arn = module.database.table_arn
  s3_bucket_arn      = module.storage.bucket_arn
}

# Auto-generate cryptographically secure HMAC secret for JWT signing & verification
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

# 4. Compute Module (Lambda Functions + HTTP API Gateway v2 + Lambda Authorizer)
module "compute" {
  source              = "./modules/compute"
  environment         = var.environment
  lambda_role_arn     = module.iam.lambda_role_arn
  dynamodb_table_name = module.database.table_name
  s3_bucket_name      = module.storage.bucket_name
  jwt_secret          = random_password.jwt_secret.result
}

# 5. Frontend Module (S3 Static Hosting)
module "frontend" {
  source      = "./modules/frontend"
  environment = var.environment
  aws_region  = var.aws_region
  account_id  = data.aws_caller_identity.current.account_id
}
