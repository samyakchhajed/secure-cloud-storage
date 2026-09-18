output "frontend_bucket_name" {
  value       = aws_s3_bucket.frontend_bucket.id
  description = "Name of the frontend static assets S3 bucket"
}

output "cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.frontend_cdn.id
  description = "ID of the CloudFront distribution"
}

output "website_url" {
  value       = "https://${aws_cloudfront_distribution.frontend_cdn.domain_name}"
  description = "CloudFront URL of the deployed web application"
}
