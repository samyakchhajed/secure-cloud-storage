# Secure Cloud File Storage

A serverless, cloud-native file storage and sharing platform on AWS engineered with a strict focus on **secure multi-user access control**, least-privilege IAM, S3 server-side encryption, and time-limited presigned transfers.

---

## Overview

Cloud file management systems must provide seamless usability while strictly preventing unauthorized access and data leaks. This project demonstrates a production-ready, multi-user storage platform where:

1. **Every file request is authorized** by serverless compute before access is granted.
2. **Heavy file I/O is offloaded directly to Amazon S3** via short-lived presigned URLs (300-second TTL), bypassing backend compute bottlenecks.
3. **The S3 storage is completely private** with all 4 Block Public Access settings enabled, TLS-only bucket policies, and default SSE-S3 AES-256 encryption.
4. **The frontend uses zero AWS SDKs** — built with zero-build Vanilla HTML5, modern CSS, and ES Modules JS for instant loading and complete portability.
5. **The backend follows Hexagonal Architecture** — pure Python business handlers isolated from cloud SDK adapters.

---

## How It Works

```text
AUTHENTICATION
Browser → Cognito → JWT

API / AUTHORIZATION
Browser → API Gateway → Lambda → DynamoDB
                              │
                              └── Authorize operation
                                      │
                                      ▼
                                Presigned S3 URL

FILE TRANSFER
Browser ─── Presigned PUT / GET ──► S3
```

The application separates authorization and data transfer into two clean phases:

1. **Authentication & Authorization:** The user logs in via Amazon Cognito to obtain a JWT token. Every subsequent API request carries this token to API Gateway, where Lambda verifies ownership or sharing permissions in DynamoDB.
2. **Direct-to-S3 Data Transfer:** Once authorized, Lambda returns a 5-minute presigned S3 URL (`PUT` for upload with `AES256` encryption, `GET` for download). The browser transfers binary bytes directly to/from S3, eliminating API Gateway payload limits and compute overhead.

---

## Key Features

### 1. Secure Authentication & User Identity
- Email and password registration with automated email verification codes via **Amazon Cognito User Pool**.
- Authenticated sessions issue standard JWT tokens passed in standard `Authorization: Bearer <token>` HTTP headers.

### 2. Direct S3 Presigned Transfers
- **Upload:** Frontend requests a presigned `PUT` URL -> Lambda verifies available user quota -> Frontend uploads directly to S3 with mandatory `AES256` encryption.
- **Download:** Frontend requests a presigned `GET` URL -> Lambda checks ownership or viewer share in DynamoDB -> Returns 5-minute presigned URL -> Frontend downloads directly from S3.

### 3. Hierarchical Folder Organization
- Organize files into nested subfolders with an interactive explorer, real-time search filtering, and dynamic breadcrumb navigation.

### 4. Granular Multi-User File Sharing
- Share individual files with other registered users by email with read-only (Viewer) access.
- Dedicated **"Shared with Me"** view powered by a DynamoDB Global Secondary Index (`GSI1`).
- File owners can review active shares and revoke access at any time.

### 5. Live Storage Quota Tracking
- Real-time tracking of account storage usage and file count against a configurable quota, displayed with a visual progress meter.

---

## Architecture Summary

The platform is built on a *serverless, pay-per-use* architecture deployed in the Mumbai (`ap-south-1`) region (compute scales to zero when inactive, with minimal baseline storage and database cost):

- **Frontend:** Zero-build single-page application (vanilla HTML5, modern CSS, ES Modules) hosted securely via *Amazon S3* and distributed globally via *Amazon CloudFront* with Origin Access Control (OAC).
- **API Surface:** *Amazon API Gateway HTTP API (v2)* with built-in CORS, Cognito JWT Authorizer, and payload format 2.0 integrations.
- **Compute Layer:** *AWS Lambda (Python 3.12)* built with a hexagonal architecture isolating pure business logic handlers from cloud adapters.
- **Data & Artifacts:** *Amazon DynamoDB* (single-table design with on-demand capacity) for metadata, folder hierarchies, and ACLs; *Amazon S3* (private SSE-S3 AES-256 encrypted) for user files.
- **Identity & Auth:** *Amazon Cognito User Pool* managing authentication, password policies, and verification tokens.
- **Security:** Keyless authentication via *GitHub Actions OpenID Connect (OIDC)* and strict least-privilege IAM policies.

---

## Screenshots

Visual walkthroughs and interface screenshots illustrating the file explorer, upload progress modal, folder creation, sharing dialog, and shared files dashboard are organized in the `screenshots/` directory.
