# Frontend Module — Direct S3 Static Website Hosting
# Configured for instant deployment bypassing AWS account-level CloudFront verification holds

# 1. Frontend S3 Bucket
resource "aws_s3_bucket" "frontend_bucket" {
  bucket        = "scs-frontend-${var.environment}-${var.aws_region}-${var.account_id}"
  force_destroy = true

  tags = {
    Name        = "Secure Cloud Storage Frontend"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# 2. S3 Website Configuration with SPA Fallback (index.html for routing)
resource "aws_s3_bucket_website_configuration" "frontend_website" {
  bucket = aws_s3_bucket.frontend_bucket.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

# 3. Public Access Block (permit public read policy for website hosting)
resource "aws_s3_bucket_public_access_block" "frontend_bpa" {
  bucket = aws_s3_bucket.frontend_bucket.id

  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

# 4. Public Read Bucket Policy for Website Hosting
resource "aws_s3_bucket_policy" "frontend_public_policy" {
  bucket     = aws_s3_bucket.frontend_bucket.id
  depends_on = [aws_s3_bucket_public_access_block.frontend_bpa]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend_bucket.arn}/*"
      }
    ]
  })
}
