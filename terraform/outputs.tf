output "website_url" {
  value       = module.frontend.website_url
  description = "HTTPS URL of the S3 static web application"
}

output "api_gateway_url" {
  value       = module.compute.api_endpoint
  description = "Base URL of the API Gateway HTTP API"
}

output "s3_files_bucket" {
  value       = module.storage.bucket_name
  description = "Private S3 bucket name for encrypted user files"
}

output "s3_frontend_bucket" {
  value       = module.frontend.frontend_bucket_name
  description = "S3 bucket name for frontend static assets"
}
