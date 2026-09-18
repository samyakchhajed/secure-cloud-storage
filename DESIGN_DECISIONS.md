# Design Decisions — Secure Cloud File Storage

This document records every significant architectural and engineering design decision made for this project, including what was chosen, what was rejected, and why. It is the authoritative reference for understanding why the system is built the way it is.

---

## Application Architecture

### Decision: No AWS-specific code in the frontend application
**Chosen:** The frontend is written strictly in pure Vanilla HTML5, modern CSS, and JavaScript (ES Modules). It communicates using standard RESTful JSON over HTTPS with standard `Authorization: Bearer <token>` headers, and performs direct-to-S3 file uploads using standard `fetch(presignedUrl, { method: 'PUT', body: file })`.
**Rejected:** Embedding AWS SDK for JavaScript (`aws-sdk`, `@aws-sdk/client-s3`, AWS Amplify, AWS Cognito Identity SDK).
**Why:**
- Eliminates multi-megabyte bundle bloat and vendor lock-in on the client.
- Prevents leaking AWS service structures or IAM complexities into client-side code.
- Keeps client interactions clean, portable, and easily mockable for local testing without cloud credentials.

### Decision: Hexagonal Architecture (Ports & Adapters) in the Backend
**Chosen:** Business logic in `backend/` handlers is pure Python with **zero `boto3` or AWS imports**. Each module has an isolated `adapters.py` that is the only file importing `boto3` and interacting with S3 or DynamoDB.
**Rejected:** Mixing `boto3` calls, DynamoDB formatting, or S3 client invocations directly into route handler logic.
**Why:**
- Enables pure, fast, cloud-agnostic unit testing without mocking complex AWS SDK objects.
- Decouples authorization rules and business logic from cloud provider primitives.

### Decision: Direct S3 Transfer via Time-Limited Presigned URLs
**Chosen:** Clients request presigned URLs from Lambda (`PUT` for upload, `GET` for download) and transfer bytes directly to/from Amazon S3. Presigned URLs are hard-capped at 5 minutes (300 seconds).
**Rejected:** Streaming file bytes through API Gateway and Lambda (payload proxying).
**Why:**
- API Gateway has a hard payload limit of 10 MB and a 29-second connection ceiling.
- Streaming large binaries through Lambda incurs unnecessary compute runtime, memory costs, and network bottlenecks.
- Presigned URLs offload heavy I/O directly to high-throughput S3 storage while retaining strict backend authorization on every URL generation request.

---

## Security & Access Control

### Decision: Default S3-Managed Encryption (SSE-S3 / `AES256`) instead of KMS
**Chosen:** Standard SSE-S3 (`AES256`) encryption applied by default on the S3 bucket.
**Rejected:** Customer-Managed KMS Key (SSE-KMS).
**Why:**
- A customer-managed KMS key incurs a minimum fixed charge of ~$1.00/month/key plus per-request API fees.
- For this project, our primary security focus is rigorous multi-user authorization, private bucket isolation, and least-privilege IAM. SSE-S3 provides AES-256 encryption at rest at **₹0 cost**, fitting our minimal test envelope (~₹0–₹10).

### Decision: All 4 S3 Block Public Access (BPA) Settings Enabled + TLS Enforcement
**Chosen:** S3 bucket has `block_public_acls`, `block_public_policy`, `ignore_public_acls`, and `restrict_public_buckets` enabled. The bucket policy explicitly denies any request where `aws:SecureTransport == false`.
**Rejected:** Public or semi-public bucket configurations.
**Why:** Guarantees zero accidental data leaks and enforces TLS encryption in transit for all presigned uploads and downloads.

### Decision: Single-Table DynamoDB Design with Global Secondary Index (GSI)
**Chosen:** A single DynamoDB table (`secure-cloud-storage-metadata`) partitioned by `USER#<userId>` / `FILE#<fileId>`, with a single GSI (`GSI1`) indexed on `RECIPIENT#<email>` for fast "Shared with Me" queries.
**Rejected:** Multiple separate tables (Users, Files, Folders, Shares).
**Why:**
- Reduces infrastructure provisioning overhead and keeps billing under a single On-Demand table (`PAY_PER_REQUEST`).
- Supports atomic folder/file metadata updates and simple index queries.

---

## Frontend

### Decision: Vanilla HTML + JavaScript + CSS (Zero-Build, Zero-Dependency)
**Chosen:** Single `index.html` + ES module JS files (`src/app.js`, `src/api/client.js`, `src/api/mock.js`) + vanilla modern CSS (`src/index.css`). Runs locally via `python -m http.server 8080`.
**Rejected:** React, Vue, Next.js, or Vite build pipelines.
**Why:**
- Eliminates Node.js version conflicts, npm security vulnerabilities, and heavyweight build pipelines.
- Deploys as plain static files to S3 + CloudFront as-is.
- Extreme speed: loads instantly with 0 ms compilation overhead.

### Decision: Local Mock Simulation (`mock.js`)
**Chosen:** An in-memory mock client that intercepts API requests when `API_BASE_URL` is empty, simulating user registration, OTP verification, login JWTs, folder hierarchy, file uploads (with realistic blob storage in browser memory), and sharing.
**Rejected:** Requiring LocalStack or a live AWS deployment for UI development.
**Why:** Allows complete UI styling, feature verification, and interactive demonstrations entirely offline without incurring AWS costs.

### Decision: Light Theme with Clean Modern Google Drive-Style Layout
**Chosen:** Clean white/slate background palette, indigo/blue primary accents, subtle borders, card hover elevations, and responsive sidebar navigation.
**Rejected:** Cluttered multi-pane dark modes.
**Why:** Delivers a modern, intuitive, and highly functional productivity experience.

---

## Infrastructure & DevOps

### Decision: Modular Terraform in Mumbai (`ap-south-1`)
**Chosen:** Terraform with single-responsibility modules (`storage`, `database`, `cognito`, `compute`, `frontend`, `iam`). Target region defaults to `ap-south-1`.
**Rejected:** Manual AWS Console configuration or CloudFormation.
**Why:** Fully reproducible, version-controlled, and audited infrastructure.

### Decision: Keyless GitHub Actions CI/CD via OpenID Connect (OIDC)
**Chosen:** Authenticate GitHub Actions to AWS using `sts:AssumeRoleWithWebIdentity` via `AWS_ROLE_ARN`.
**Rejected:** Storing static long-lived IAM user access keys (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) in GitHub Secrets.
**Why:** Eliminates credential leakage risks, removes rotation maintenance, and enforces repository-level trust boundaries.

### Decision: Safe Teardown Workflow (`destroy.yaml`) with Confirmation Gate
**Chosen:** A manual teardown workflow requiring the user to explicitly type `"destroy"` to execute `terraform destroy`.
**Rejected:** Leaving infrastructure running indefinitely after testing.
**Why:** Guarantees zero ongoing costs after test runs by making complete cloud teardown effortless and safe.

---

## What Was Explicitly Rejected

| Idea | Reason Rejected |
|---|---|
| Customer-Managed KMS Key | Incurs ~$1.00/month key fee; SSE-S3 provides AES-256 encryption at ₹0 |
| AWS SDK in Frontend | Bloats bundle, leaks AWS internals, complicates mock testing |
| Streaming file bytes via Lambda | API Gateway 10 MB payload limit, memory/timeout cost |
| React / Vite / Node build pipeline | Adds build complexity, execution policies; Vanilla HTML/JS is fast and portable |
| Multiple DynamoDB tables | Single-table with GSI1 is cheaper, faster, and easier to maintain |
| Static AWS Access Keys in CI/CD | Insecure; replaced with keyless GitHub Actions OIDC |
| Public S3 bucket access | Insecure; private bucket with BPA and presigned URLs only |
| Complex multi-tier RBAC/inheritance | Scope kept bounded to Owner vs. Viewer to focus on AWS security fundamentals |
