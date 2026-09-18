output "table_name" {
  value       = aws_dynamodb_table.metadata_table.name
  description = "Name of the DynamoDB metadata single-table"
}

output "table_arn" {
  value       = aws_dynamodb_table.metadata_table.arn
  description = "ARN of the DynamoDB metadata table"
}
