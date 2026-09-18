# Database Module — DynamoDB Single-Table with On-Demand Capacity (Zero Idle Cost)

resource "aws_dynamodb_table" "metadata_table" {
  name         = "scs-metadata-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  # Global Secondary Index 1 (Used for folder listings and "Shared with Me" queries)
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name        = "Secure Cloud Storage Metadata"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}
