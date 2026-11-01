# Zero-Touch Automated State & Secrets Architecture

This project is engineered for **100% automated, zero-touch deployment**. You do **not** need to manually create S3 buckets, run DynamoDB CLI commands, or generate JWT secrets.

---

## 1. Automated Remote State Backend (S3 + DynamoDB Lock)

When `deploy.yaml` or `destroy.yaml` executes in GitHub Actions:
1. It automatically queries the caller account ID and region (`scs-tfstate-<ACCOUNT_ID>-<REGION>`).
2. It checks if the S3 bucket exists:
   - If missing: It creates the bucket, enables versioning, activates SSE-S3 AES-256 encryption, and turns on all 4 Block Public Access flags.
   - If present: It skips creation and reuses the existing bucket.
3. It checks if the DynamoDB lock table (`scs-tfstate-lock`) exists:
   - If missing: It creates the table on-demand (`PAY_PER_REQUEST`) with `LockID` primary key.
   - If present: It skips creation and reuses the existing table.
4. It connects Terraform directly via dynamic `-backend-config` parameters during `terraform init -reconfigure`.

### How Failed Run Recovery Works
- Because `.tfstate` is saved to S3 after every resource provisioned, if any run is canceled or fails mid-way, state is never lost.
- On the next run, Terraform compares the code against the remote state, **automatically skips all already-created resources**, and only provisions the remaining delta.
- No `EntityAlreadyExists` or `ResourceInUseException` collisions ever occur.

---

## 2. Fully Automated Secret Generation

- **Zero manual secret generation**: The JWT secret is generated automatically inside Terraform via `resource "random_password" "jwt_secret"` (64 cryptographically secure characters) and injected into the Lambda Authorizer and Auth functions.
- You do **not** need to generate or configure a `JWT_SECRET` in GitHub Secrets.

---

## 3. Only Required GitHub Secret

The single secret needed is the OIDC IAM Role ARN so GitHub Actions can authenticate to AWS:

| Secret | Value |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/<ROLE_NAME>` |
