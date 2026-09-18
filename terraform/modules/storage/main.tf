# Storage Module — Private Files S3 Bucket with SSE-S3 & Block Public Access

resource "aws_s3_bucket" "files_bucket" {
  bucket        = "scs-files-${var.environment}-${var.aws_region}-${var.account_id}"
  force_destroy = true

  tags = {
    Name        = "Secure Cloud Storage Private Files"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# 1. Enforce Server-Side Encryption (SSE-S3 / AES256: ₹0 cost)
resource "aws_s3_bucket_server_side_encryption_configuration" "files_encryption" {
  bucket = aws_s3_bucket.files_bucket.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# 2. Block All Public Access
resource "aws_s3_bucket_public_access_block" "files_bpa" {
  bucket = aws_s3_bucket.files_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 3. Bucket CORS configuration for direct browser presigned uploads
resource "aws_s3_bucket_cors_configuration" "files_cors" {
  bucket = aws_s3_bucket.files_bucket.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag", "x-amz-server-side-encryption"]
    max_age_seconds = 3600
  }
}

# 4. Strict TLS-Only Bucket Policy
resource "aws_s3_bucket_policy" "files_tls_policy" {
  bucket     = aws_s3_bucket.files_bucket.id
  depends_on = [aws_s3_bucket_public_access_block.files_bpa]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceTLSRequestsOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.files_bucket.arn,
          "${aws_s3_bucket.files_bucket.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}
