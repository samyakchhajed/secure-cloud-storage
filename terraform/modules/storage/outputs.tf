output "bucket_name" {
  value       = aws_s3_bucket.files_bucket.id
  description = "Name of the private files S3 bucket"
}

output "bucket_arn" {
  value       = aws_s3_bucket.files_bucket.arn
  description = "ARN of the private files S3 bucket"
}
