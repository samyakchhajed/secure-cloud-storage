output "user_pool_id" {
  value       = aws_cognito_user_pool.pool.id
  description = "ID of the Cognito User Pool"
}

output "user_pool_arn" {
  value       = aws_cognito_user_pool.pool.arn
  description = "ARN of the Cognito User Pool"
}

output "user_pool_endpoint" {
  value       = aws_cognito_user_pool.pool.endpoint
  description = "Endpoint of the Cognito User Pool"
}

output "client_id" {
  value       = aws_cognito_user_pool_client.client.id
  description = "ID of the Cognito App Client"
}
