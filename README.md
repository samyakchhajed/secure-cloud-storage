# Secure Cloud File Storage

A serverless, cloud-native file storage, management, and sharing platform built on Amazon Web Services (AWS). Engineered with a strict focus on **least-privilege IAM security**, **zero client-side cloud SDK bloat**, **browser-side AES-256-GCM plus server-side AES-256 encryption**, and **time-limited direct S3 presigned transfers**.

> **Note on Project Status:** This project was developed as a real-world infrastructure trial and cloud-hardening ground to uncover AWS edge cases around OIDC claims, IAM permissions, and ephemeral CI/CD state. Cognito and CloudFront were attempted first but could not be used because the AWS account quotas for those services were zero. The deployed application therefore uses a DynamoDB-backed identity store and custom HMAC-SHA256 JWT authorizer.

---

## Architecture Overview

```text
AUTHENTICATION & IDENTITY:
  User Browser ──► Auth Lambda + DynamoDB ──► Returns custom HMAC-SHA256 JWT

CONTROL-PLANE (AUTHORIZATION & METADATA):
  User Browser ──► Amazon API Gateway HTTP API v2 (Lambda Authorizer)
                         │
                         ▼
                   AWS Lambda Functions (Python 3.12)
                         │
                         ├──► Amazon DynamoDB (Single-Table Metadata & ACLs)
                         │
                         └──► Returns 5-Minute Presigned S3 URL

DATA-PLANE (DIRECT BINARY TRANSFER):
  User Browser ══════ Direct PUT (Upload) / GET (Download) ══════► Amazon S3 Private Storage
                                                                     (SSE-S3 AES-256 / BPA)
```

The system strictly decouples authorization and heavy binary transfer into two clean phases:
1. **Control-Plane Authorization:** Client requests an action using a custom HMAC-SHA256 JWT. API Gateway invokes a Lambda authorizer, which validates the token and injects the user identity; backend Lambda functions verify ownership and permission in DynamoDB.
2. **Data-Plane Direct Transfer:** Once authorized, Lambda returns a short-lived (300-second) presigned S3 URL (`PUT` for upload enforcing `AES256` encryption, `GET` for download). The browser transfers binary bytes directly to/from S3, bypassing API Gateway payload limits (10 MB ceiling) and eliminating compute runtime overhead.

---

## Core Capabilities & Engineering Highlights

- **Zero Client-Side AWS SDKs:** Built with pure Vanilla HTML5, modern CSS custom properties, and JavaScript ES Modules. No `@aws-sdk`, Amplify, or Node.js dependencies in the client bundle.
- **Hexagonal Architecture (Ports & Adapters):** Core business logic in backend Lambda handlers is written in pure Python with **zero `boto3` imports**. All AWS SDK communications are isolated exclusively in dedicated `adapters.py` files.
- **Direct S3 Presigned Transfers:** Heavy binary file transfers bypass Lambda and API Gateway entirely, utilizing 5-minute presigned URLs with mandatory `x-amz-server-side-encryption: AES256`.
- **Hierarchical Folder Structure:** Dynamic folder creation, nested navigation, path resolution, and dynamic breadcrumbs.
- **Multi-User Sharing & Granular ACLs:** Share files with other registered users by email with read-only (Viewer) permissions, backed by a dedicated **"Shared with Me"** view powered by a DynamoDB Global Secondary Index (`GSI1`).
- **Zero-Knowledge Client Encryption:** The browser encrypts file bytes with AES-256-GCM and stores only wrapped master-key material and metadata server-side; password and recovery-key wrapping use PBKDF2-SHA-256.
- **No OTP or Email Delivery:** Registration and password recovery are local application flows; the project does not generate OTPs or send verification, recovery, or notification emails.
- **Real-Time Quota Management:** Live tracking of user storage consumption (bytes) and file count against a 5 GB default quota, with real-time UI progress feedback.
- **₹0 Serverless Cost Architecture:** Deployed in Mumbai (`ap-south-1`) utilizing S3 SSE-S3 default encryption (`AES256`), On-Demand DynamoDB (`PAY_PER_REQUEST`), and S3 Static Website Hosting.
- **Keyless CI/CD Automation:** Automated cloud deployment via GitHub Actions OpenID Connect (OIDC), assuming AWS IAM roles without storing static access keys.

---

## DynamoDB Single-Table Schema

All metadata, folder hierarchies, sharing permissions, and quota tracking are stored in a single DynamoDB table (`scs-metadata-dev`):

| Entity Type | Partition Key (`PK`) | Sort Key (`SK`) | `GSI1PK` | `GSI1SK` | Key Attributes |
|---|---|---|---|---|---|
| **User Profile / Quota** | `USER#<userId>` | `PROFILE` | — | — | `email`, `usedBytes`, `quotaBytes`, `fileCount`, `updatedAt` |
| **Folder Item** | `USER#<userId>` | `FOLDER#<folderId>` | — | — | `folderId`, `name`, `parentFolderId`, `path`, `createdAt` |
| **File Item** | `USER#<userId>` | `FILE#<fileId>` | — | — | `fileId`, `fileName`, `sizeBytes`, `contentType`, `folderId`, `s3Key`, `encryption`, `createdAt` |
| **File Share ACL** | `FILE#<fileId>` | `SHARE#<recipientEmail>` | `RECIPIENT#<recipientEmail>` | `FILE#<fileId>` | `ownerId`, `ownerEmail`, `fileName`, `sizeBytes`, `permission`, `createdAt` |

---

## API Surface (HTTP API v2)

| Method | Endpoint | Authorization | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Creates a DynamoDB user profile with password hash and wrapped master-key material |
| `POST` | `/api/auth/login` | Public | Validates credentials and returns a custom HMAC-SHA256 JWT |
| `POST` | `/api/auth/recovery-info` | Public | Returns recovery-key material needed for password reset |
| `POST` | `/api/auth/reset-password` | Public | Replaces password credentials and re-wraps the master file key |
| `POST` | `/api/files/upload-url` | Custom JWT | Validates quota and generates a presigned S3 `PUT` upload URL |
| `POST` | `/api/files/confirm` | Custom JWT | Confirms completed S3 upload, saves metadata, and increments quota |
| `GET` | `/api/files` | Custom JWT | Lists files and subfolders in the current folder (`?folderId=...`) |
| `GET` | `/api/files/{fileId}/download-url` | Custom JWT | Validates ownership/share and returns a presigned S3 `GET` download URL |
| `DELETE` | `/api/files/{fileId}` | Custom JWT | Deletes S3 object, removes DynamoDB record, and reclaims quota |
| `POST` | `/api/folders` | Custom JWT | Creates a new folder under an optional parent folder |
| `DELETE` | `/api/folders/{folderId}` | Custom JWT | Deletes an empty folder |
| `POST` | `/api/files/{fileId}/share` | Custom JWT | Grants read-only Viewer access to another user by email |
| `DELETE` | `/api/files/{fileId}/share/{email}` | Custom JWT | Revokes Viewer access for a recipient |
| `GET` | `/api/files/shared-with-me` | Custom JWT | Queries `GSI1` for all files shared with the authenticated user |
| `GET` | `/api/user/quota` | Custom JWT | Returns current storage usage, quota limit, and percentage |

---

## Running Locally (Zero Build & Mock Simulation)

The frontend contains a full offline in-memory simulation engine ([`frontend/src/api/mock.js`](./frontend/src/api/mock.js)) that intercepts requests when `window.API_BASE_URL` is empty, allowing complete offline development with zero cloud costs.

```sh
cd frontend
python -m http.server 8080
```
Open **`http://localhost:8080`** in any browser.

To connect to live AWS infrastructure, configure your API Gateway URL inside [`frontend/config.js`](./frontend/config.js):
```javascript
window.API_BASE_URL = 'https://<api-id>.execute-api.ap-south-1.amazonaws.com';
```

---

## Deployment & Teardown via GitHub Actions

### 1. Automated Deployment (`deploy.yaml`)
Triggered via **`workflow_dispatch`** on GitHub Actions:
- Requests an ephemeral OIDC JWT token from GitHub.
- Assumes the CI/CD IAM Role (`sts:AssumeRoleWithWebIdentity`) via `aws-actions/configure-aws-credentials@v6`.
- Initializes and executes `terraform apply` in `ap-south-1`.
- Injects the live API Gateway invoke URL into `frontend/config.js`.
- Syncs static frontend assets to the S3 hosting bucket.

### 2. Automated Teardown (`destroy.yaml`)
Triggered via **`workflow_dispatch`** with a safety gate:
- Requires entering the confirmation string **`destroy`**.
- Executes `terraform destroy` to completely remove all AWS resources, guaranteeing ₹0 lingering costs.

---

## Architectural Evolution

The deployment and diagnostic journey of this project is fully chronicled in [DEVELOPMENT_AND_DEPLOYMENT.md](./DEVELOPMENT_AND_DEPLOYMENT.md).

This project served as the **foundational trial and infrastructure hardening ground**, discovering and resolving deep edge cases across GitHub OIDC claim structures, ephemeral runner state lifecycles, and API Gateway data-plane permissions. These proven patterns are now established as the production architectural standard for the **ML Model & Deployment Comparison** platform.
