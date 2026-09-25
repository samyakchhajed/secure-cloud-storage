output "frontend_bucket_name" {
  value       = aws_s3_bucket.frontend_bucket.id
  description = "Name of the frontend static assets S3 bucket"
}

output "cloudfront_distribution_id" {
  value       = ""
  description = "ID of the CloudFront distribution (empty for direct S3 website hosting)"
}

output "website_url" {
  value       = "http://${aws_s3_bucket_website_configuration.frontend_website.website_endpoint}"
  description = "Public URL of the S3 static web application"
}
