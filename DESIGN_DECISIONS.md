# Architectural Design Decisions — Secure Cloud File Storage

This document records every significant architectural, security, and engineering design decision made for the **Secure Cloud File Storage** platform. It details what was chosen, what was explicitly rejected, and the technical rationale behind each decision.

---

## 1. Application & Frontend Architecture

### Decision: Zero AWS SDK in the Frontend Application
- **Chosen:** The frontend is written strictly in pure Vanilla HTML5, modern CSS custom properties, and JavaScript (ES Modules). It communicates using standard RESTful JSON over HTTPS with standard `Authorization: Bearer <token>` headers, and performs direct-to-S3 file uploads using standard `fetch(presignedUrl, { method: 'PUT', body: file })`.
- **Rejected:** Embedding AWS SDK for JavaScript (`aws-sdk`, `@aws-sdk/client-s3`, AWS Amplify, AWS Cognito Identity SDK).
- **Rationale:**
  - **Zero Bundle Bloat:** Eliminates multi-megabyte npm dependency trees and build-time bundlers (Webpack, Vite, Rollup).
  - **Security & Portability:** Prevents leaking AWS service structures, internal schemas, or IAM complexities into client-side code.
  - **Instant Offline Mocking:** Client interactions are completely portable and easily mockable for local offline development without cloud credentials.

### Decision: Hexagonal Architecture (Ports & Adapters) in the Backend
- **Chosen:** Business logic in backend Lambda handlers (`auth`, `files`, `folders`, `sharing`, `quota`) is written in pure Python with **zero `boto3` or AWS imports**. Each module isolates AWS SDK interactions into a dedicated `adapters.py` file.
- **Rejected:** Mixing `boto3` calls, DynamoDB formatting, or S3 client invocations directly inside route handler logic.
- **Rationale:**
  - **Testability:** Enables fast, deterministic unit testing of business rules and authorization policies without complex cloud mock frameworks (e.g., `moto`, `LocalStack`).
  - **Vendor Decoupling:** Decouples core business capabilities (quota calculations, permission checks, hierarchy traversals) from underlying cloud provider primitives.

### Decision: Direct S3 Binary Transfer via Time-Limited Presigned URLs
- **Chosen:** Clients request short-lived presigned URLs from Lambda (`PUT` for upload, `GET` for download) and transfer bytes directly to/from Amazon S3. Presigned URLs are strictly capped at 5 minutes (300 seconds).
- **Rejected:** Streaming file bytes through API Gateway and Lambda (payload proxying).
- **Rationale:**
  - **Hard Service Limits:** Amazon API Gateway enforces a hard 10 MB payload limit and a 29-second connection timeout ceiling.
  - **Compute Cost & Performance:** Streaming binary files through Lambda incurs high memory allocations, compute execution costs, and network bottlenecks.
  - **High Throughput:** Presigned URLs offload heavy I/O directly to Amazon S3's globally scalable storage infrastructure while retaining strict backend authorization on every URL generation request.

---

## 2. Security, Identity & Data Storage

### Decision: Default S3-Managed Encryption (SSE-S3 / `AES256`) Over KMS
- **Chosen:** Standard SSE-S3 (`AES256`) encryption applied by default on the S3 bucket.
- **Rejected:** Customer-Managed AWS KMS Key (SSE-KMS).
- **Rationale:**
  - **Cost Optimization:** A customer-managed KMS key incurs a fixed fee of ~$1.00/month per key plus per-request cryptographic API charges.
  - **Sufficient Security:** For this multi-user file storage application, the primary security boundary is multi-user authorization and private bucket isolation. SSE-S3 provides AES-256 encryption at rest at **₹0 cost**, fitting our minimal test envelope (~₹0–₹10).

### Decision: All 4 S3 Block Public Access (BPA) Flags + TLS Enforcement
- **Chosen:** The S3 storage bucket has `block_public_acls`, `block_public_policy`, `ignore_public_acls`, and `restrict_public_buckets` set to `true`. The bucket policy explicitly denies any request where `aws:SecureTransport == false`.
- **Rejected:** Public or semi-public bucket access policies.
- **Rationale:** Guarantees zero accidental data leaks and enforces TLS in transit for all presigned uploads and downloads.

### Decision: Single-Table DynamoDB Design with Global Secondary Index (GSI)
- **Chosen:** A single DynamoDB table (`scs-metadata-dev`) partitioned by `USER#<userId>` / `FILE#<fileId>`, with a single Global Secondary Index (`GSI1`) indexed on `RECIPIENT#<email>` for fast "Shared with Me" queries.
- **Rejected:** Multiple separate DynamoDB tables (Users, Files, Folders, Shares).
- **Rationale:**
  - **Cost & Maintenance:** Consolidates billing and provisioning under a single On-Demand table (`PAY_PER_REQUEST`).
  - **Atomic Updates:** Supports transactional metadata updates (e.g. updating quota alongside file creation) and efficient query patterns.

---

## 3. Cloud Infrastructure & CI/CD

### Decision: Direct S3 Static Website Hosting (Option B) Over CloudFront OAC
- **Chosen:** Hosting frontend static assets directly via Amazon S3 Static Website Hosting with SPA fallback routing (`index.html` configured as both index and error document).
- **Rejected:** Amazon CloudFront CDN Distribution with Origin Access Control (OAC).
- **Rationale:**
  - **Anti-Abuse Verification Holds:** AWS places automated anti-abuse verification holds on global CloudFront distribution creation for new accounts (`403 AccessDenied: Your account must be verified before you can add new CloudFront resources`).
  - **Instant Zero-Cost Deployment:** Direct S3 static hosting bypasses the verification hold completely, enabling immediate, automated, and zero-cost frontend deployment.

### Decision: Keyless GitHub Actions CI/CD via OpenID Connect (OIDC)
- **Chosen:** Authenticate GitHub Actions to AWS using `sts:AssumeRoleWithWebIdentity` with repository-scoped OIDC trust policies.
- **Rejected:** Storing static long-lived IAM user access keys (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) in GitHub Secrets.
- **Rationale:** Eliminates credential leakage risks, removes secret rotation overhead, and enforces exact immutable repository trust boundaries.

### Decision: API Gateway Data-Plane Execution ARN Scoping
- **Chosen:** Scoping Lambda invocation permissions to the API Gateway data-plane execution ARN (`aws_apigatewayv2_api.http_api.execution_arn`).
- **Rejected:** Using the API Gateway control-plane resource ARN (`aws_apigatewayv2_api.http_api.arn`).
- **Rationale:** At runtime, API Gateway invokes Lambda using the data-plane caller ARN (`arn:aws:execute-api:...`). Using the control-plane ARN (`arn:aws:apigateway:...`) causes AWS Lambda to reject incoming invocations with `403 AccessDenied` before code execution begins.

### Decision: S3 Remote State Backend as the Production Standard
- **Chosen:** Recommending a dedicated private S3 bucket for `terraform.tfstate` with state locking.
- **Rejected:** Relying on ephemeral local runner state across GitHub Actions runs.
- **Rationale:** GitHub Actions runners are ephemeral virtual machines that discard local state upon job completion. Storing state in an S3 remote backend eliminates state drift, avoids resource recreation collisions, and enables 15-second in-place infrastructure updates.

---

## 4. Explicitly Rejected Alternatives Summary

| Alternative | Reason Rejected | Selected Architecture |
|---|---|---|
| **Customer-Managed KMS Key (SSE-KMS)** | Incurs ~$1.00/month/key fee plus per-request API costs. | **Default SSE-S3 (`AES256`)** for ₹0 encryption cost. |
| **AWS SDK in Frontend** | Heavyweight bundle, leaks AWS internals, complicates mock testing. | **Zero-Build Vanilla JS / REST API** with standard Bearer JWT headers. |
| **Streaming File Bytes via Lambda** | 10 MB payload limit on API Gateway, 29s timeout, excessive Lambda compute cost. | **Direct-to-S3 Presigned URLs** (300-second TTL). |
| **Heavy Frontend Frameworks (React/Vue/Next)** | Node.js dependency hell, build tooling overhead, complex build pipelines. | **Vanilla HTML5 + Modern CSS + ES Modules** with instant loading. |
| **Multiple DynamoDB Tables** | Multiplied provisioning overhead, fragmented billing, complex cross-table transactions. | **Single-Table Design** (`PK`, `SK`, `GSI1`). |
| **Static AWS Access Keys in CI/CD** | High security risk of key exposure and ongoing credential rotation maintenance. | **Keyless GitHub Actions OIDC** (`sts:AssumeRoleWithWebIdentity`). |
| **Public S3 Bucket Access** | High risk of unauthorized data exposure. | **Private S3 Bucket with all 4 BPA flags enabled** and TLS enforcement. |
