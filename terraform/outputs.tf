output "website_url" {
  value       = module.frontend.website_url
  description = "Public URL of the CloudFront static web application"
}

output "api_gateway_url" {
  value       = module.compute.api_endpoint
  description = "Base URL of the API Gateway HTTP API"
}

output "cognito_user_pool_id" {
  value       = module.cognito.user_pool_id
  description = "ID of the Cognito User Pool"
}

output "cognito_client_id" {
  value       = module.cognito.client_id
  description = "ID of the Cognito App Client"
}

output "s3_files_bucket" {
  value       = module.storage.bucket_name
  description = "Private S3 bucket name for encrypted user files"
}

output "s3_frontend_bucket" {
  value       = module.frontend.frontend_bucket_name
  description = "S3 bucket name for frontend static assets"
}

output "cloudfront_distribution_id" {
  value       = module.frontend.cloudfront_distribution_id
  description = "ID of the CloudFront distribution"
}
