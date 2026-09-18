# Development & Deployment Journey — Secure Cloud File Storage

This document chronicles the end-to-end engineering process behind **Secure Cloud File Storage** — from initial requirements and architecture planning to cloud infrastructure provisioning and CI/CD automation.

---

## Project Evolution & Development Phases

The project is structured into five sequential, disciplined phases:

```text
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Zero-Build Frontend & Mock Architecture           │
│  • Vanilla HTML5, modern responsive CSS, ES Modules SPA     │
│  • Local development runtime with built-in mock simulation  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Phase 2: Hexagonal Serverless Backend                      │
│  • Pure Python business logic isolated from AWS SDK (boto3) │
│  • Presigned S3 URL generators + DynamoDB single-table CRUD │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Phase 3: Infrastructure as Code with Terraform             │
│  • Private S3 bucket (SSE-S3, BPA), DynamoDB, Cognito, IAM  │
│  • HTTP API Gateway v2 + Lambda functions + CloudFront OAC  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Phase 4: Keyless CI/CD & Automated Cloud Deployment        │
│  • GitHub Actions OIDC integration (AWS STS WebIdentity)    │
│  • Manual deploy.yaml & safe destroy.yaml teardown pipeline │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Phase 5: Security Verification & Final Documentation       │
│  • Matrix verification of isolation, sharing, and presign  │
│  • Comprehensive architectural records & summaries          │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Frontend Architecture & User Experience

**Goal:** Create a clean, responsive, Google Drive-style user interface with zero build dependencies, no client-side AWS SDKs, and full offline interactivity.

1. **Zero-Build Philosophy:** Built using pure *HTML5, Vanilla CSS, and modern JavaScript (ES Modules)*. Runs immediately in any browser using Python’s built-in HTTP server (`python -m http.server 8080`).
2. **Hash-Based SPA Routing:** A lightweight client-side router (`#/`, `#/login`, `#/register`, `#/verify`, `#/files`, `#/shared`) ensures deep linking without requiring server-side routing rules or 404 workarounds on static S3/CloudFront storage.
3. **Pluggable Mock & Real API Layer:** Created an offline API adapter (`mock.js`) that mimics realistic asynchronous execution delays, user signup OTPs, JWT session retention, folder hierarchy navigation, direct file uploads, and viewer sharing. Switching between local mock simulation and live AWS infrastructure is as simple as setting `window.API_BASE_URL`.
4. **Clean Design System:** Light, distraction-free aesthetic with intuitive breadcrumb navigation, drag-and-drop file upload modal with live upload progress, share dialog with recipient email management, and a live storage quota widget.

---

## Phase 2: Hexagonal Serverless Backend

**Goal:** Implement robust, portable cloud file storage handlers while enforcing strict architectural boundaries.

1. **Hexagonal Architecture (Ports & Adapters):** Core business logic in Lambda handlers (`files`, `folders`, `sharing`, `quota`) is written in pure *Python without importing `boto3`*. All AWS SDK interactions (S3, DynamoDB, Cognito) are isolated into dedicated `adapters.py` files.
2. **Time-Limited Presigned URLs:** Files are never proxied through API Gateway or Lambda. The backend issues short-lived presigned S3 URLs (300-second TTL) for direct client-to-S3 transfers.
3. **Access Authorization Verification:** Before issuing any presigned download URL or deletion command, the backend checks DynamoDB to verify the caller's Cognito identity (`sub` or email) matches the file owner or an authorized viewer.
4. **Zero-Cost Storage Encryption:** Default S3 bucket encryption is set to **SSE-S3 (`AES256`)**, eliminating customer-managed KMS key fees while ensuring strong data-at-rest encryption.

---

## Phase 3: Infrastructure as Code (Terraform)

**Goal:** Code the entire serverless cloud infrastructure in Terraform with least-privilege security and automated resource wiring.

1. **Modular IaC Layout:** Structured into 6 focused modules:
   - `modules/storage`: Private S3 bucket with SSE-S3 encryption, TLS-only bucket policy, and all 4 Block Public Access flags enabled.
   - `modules/database`: DynamoDB single-table with on-demand capacity (`PAY_PER_REQUEST`) and GSI1 for recipient shares.
   - `modules/cognito`: Cognito User Pool with email verification and App Client.
   - `modules/iam`: Fine-grained IAM execution roles with strict ARN-scoped permissions (no broad wildcards).
   - `modules/compute`: Python 3.12 Lambda functions and API Gateway HTTP API v2 with built-in Cognito JWT Authorizer.
   - `modules/frontend`: S3 static hosting bucket, CloudFront Origin Access Control (OAC), and CDN distribution.
2. **Automated Resource Wiring:** Injected all bucket names, table names, and Cognito pool IDs directly into Lambda environment variables from Terraform's internal dependency graph.

---

## Phase 4: CI/CD Automation & Keyless Cloud Deployment

**Goal:** Automate provisioning, packaging, and deployments with modern, keyless security.

1. **Keyless Authentication via GitHub OIDC:** Configured GitHub Actions to authenticate to AWS using *OpenID Connect (OIDC)* and AWS Security Token Service (`sts:AssumeRoleWithWebIdentity`). This eliminates long-lived static AWS access keys.
2. **Manual Deployment Pipeline (`deploy.yaml`):**
   - Packages Lambda Python source files into clean ZIP bundles.
   - Runs `terraform init`, `terraform validate`, and `terraform apply` targeting *Mumbai (`ap-south-1`)*.
   - Injects the deployed API Gateway URL and Cognito IDs into `frontend/config.js`.
   - Syncs static assets to S3 and triggers a CloudFront CDN cache invalidation.
3. **Safe Teardown Pipeline (`destroy.yaml`):** Implemented a one-click teardown workflow with an explicit `"destroy"` confirmation gate, ensuring cloud resources can be torn down immediately to maintain zero ongoing costs.

---

## Running Locally (Frontend)

```sh
cd frontend
python -m http.server 8080
# Open http://localhost:8080 in your browser
```

No npm, no Node.js, no install step. Runs entirely on the local mock API.

To connect to live AWS infrastructure: set `API_BASE_URL` in `frontend/config.js` or `frontend/src/api/client.js`.
