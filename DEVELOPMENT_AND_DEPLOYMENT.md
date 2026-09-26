# Development & Deployment Journey — Secure Cloud File Storage

This document chronicles the end-to-end engineering journey behind **Secure Cloud File Storage** on AWS — detailing architectural phases, security boundaries, and a comprehensive 22-run CI/CD diagnostic record that served as the **infrastructure hardening ground** for our cloud engineering portfolio.

---

## 1. Project Evolution & Development Phases

The application was engineered across four systematic phases, ensuring strict architectural boundaries, zero vendor lock-in on the client, and modular Infrastructure as Code.

```text
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Zero-Build Frontend & Mock Architecture           │
│  • Vanilla HTML5, modern CSS custom properties, ES Modules  │
│  • Offline development runtime with built-in mock engine    │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Phase 2: Serverless Backend & Hexagonal Design             │
│  • Pure Python business handlers isolated from AWS SDK      │
│  • Dedicated adapters.py isolating boto3 for S3 & DynamoDB  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Phase 3: Infrastructure as Code with Terraform             │
│  • Single-table DynamoDB, private S3 buckets, Cognito Pool  │
│  • 5 Python 3.12 Lambdas, HTTP API v2, least-privilege IAM  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  Phase 4: Keyless CI/CD & 22-Run Hardening Phase            │
│  • GitHub Actions OIDC integration (AWS STS WebIdentity)    │
│  • Deep debugging of OIDC claims, state, and permissions    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Phase 1: Frontend Architecture & User Experience

**Goal:** Build a clean, responsive single-page application with zero build toolchains, instant loading, and complete offline capability.

1. **Zero-Build Philosophy:** Built using standard **HTML5, Modern Vanilla CSS, and JavaScript (ES Modules)**. It requires zero npm installs, zero Node.js runtime, and runs immediately via Python's built-in HTTP server (`python -m http.server 8080`).
2. **Hash-Based SPA Router:** Implemented client-side routing (`#/`, `#/login`, `#/register`, `#/verify`, `#/files`, `#/shared`) to ensure client-side navigation functions seamlessly on static web storage without triggering 404 errors.
3. **Pluggable Mock & Real API Layer:** Created an offline API adapter ([`mock.js`](file:///frontend/src/api/mock.js)) that intercepts API calls when `window.API_BASE_URL` is empty, simulating user registration, OTP verification, login JWTs, folder hierarchy, and direct S3 uploads via browser memory blobs.
4. **Direct S3 Upload Workflow:** Implemented standard `XMLHttpRequest` PUT streaming directly to presigned S3 URLs with `x-amz-server-side-encryption: AES256` headers and real-time upload progress tracking.

---

## 3. Phase 2: Serverless Backend & Hexagonal Architecture

**Goal:** Implement robust, portable serverless handlers while enforcing strict separation between business logic and cloud provider SDKs.

1. **Hexagonal Architecture (Ports & Adapters):** Core business logic in Lambda handlers (`auth`, `files`, `folders`, `sharing`, `quota`) is written in pure **Python with zero `boto3` or AWS SDK imports**. All AWS SDK communications (Cognito IDP, S3, DynamoDB) are isolated into dedicated `adapters.py` files.
2. **Presigned S3 URL Engine:** Heavy file I/O is offloaded directly to Amazon S3. Handlers authorize user identity and quota, then generate 5-minute (300-second) presigned `PUT` URLs (for uploads with `AES256` encryption) and presigned `GET` URLs (for downloads).
3. **Multi-User Sharing with GSI1:** Implemented viewer-level file sharing by email. Handlers write sharing records to DynamoDB and query Global Secondary Index 1 (`GSI1PK = RECIPIENT#<email>`) for the dedicated "Shared with Me" view.
4. **Atomic Quota Tracking:** Implemented live quota tracking that increments storage consumption upon S3 upload confirmation and reclaims quota upon file deletion.

---

## 4. Phase 3: Infrastructure as Code (Terraform)

**Goal:** Model the entire serverless cloud infrastructure in Mumbai (`ap-south-1`) with least-privilege security and automated resource wiring.

1. **Modular IaC Layout:** Structured Terraform into 6 single-responsibility modules:
   - `modules/storage`: Private S3 files bucket with SSE-S3 default encryption (`AES256`), all 4 Block Public Access flags enabled, TLS-only bucket policy, and CORS rules.
   - `modules/database`: DynamoDB single-table with on-demand capacity (`PAY_PER_REQUEST`), Point-in-Time Recovery (PITR), and `GSI1`.
   - `modules/cognito`: Cognito User Pool with email verification codes and web client (`ALLOW_USER_PASSWORD_AUTH`).
   - `modules/iam`: Least-privilege Lambda execution role with scoped access policies for S3, DynamoDB, Cognito IDP, and CloudWatch Logs.
   - `modules/compute`: 5 Python 3.12 Lambda functions, HTTP API Gateway v2 with Cognito JWT Authorizer, and 14 integration routes.
   - `modules/frontend`: S3 static hosting bucket configured for direct SPA website hosting.
2. **Automated Resource Wiring:** Injected dynamic bucket names, table names, user pool IDs, and client IDs directly into Lambda environment variables from Terraform's internal dependency graph.

---

## 5. Phase 4: CI/CD Automation, Keyless Security & AWS Setup

**Goal:** Automate cloud provisioning and deployment with modern, keyless security via GitHub Actions OpenID Connect (OIDC).

### 1. IAM User Bootstrap Policy
To bootstrap the AWS account without granting root-level permissions, an initial IAM policy was attached to the administrator IAM user allowing management of the OIDC Identity Provider and CI/CD roles:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateOpenIDConnectProvider",
        "iam:GetOpenIDConnectProvider",
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:PutRolePolicy",
        "iam:GetRole"
      ],
      "Resource": "*"
    }
  ]
}
```

### 2. OIDC Identity Provider Configuration
* **Provider URL:** `https://token.actions.githubusercontent.com`
* **Audience:** `sts.amazonaws.com`

### 3. Repository-Scoped OIDC Trust Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": [
        "sts:AssumeRoleWithWebIdentity",
        "sts:TagSession"
      ],
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:samyakchhajed@<USER_ID>/secure-cloud-storage@<REPO_ID>:*"
        }
      }
    }
  ]
}
```

### 4. CI/CD Role Permissions Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TerraformStateAndArtifactsStorage",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:PutBucketPolicy",
        "s3:GetBucketPolicy",
        "s3:DeleteBucketPolicy",
        "s3:PutBucketVersioning",
        "s3:GetBucketVersioning",
        "s3:PutBucketPublicAccessBlock",
        "s3:GetBucketPublicAccessBlock",
        "s3:PutBucketCors",
        "s3:GetBucketCors",
        "s3:PutBucketWebsite",
        "s3:GetBucketWebsite",
        "s3:DeleteBucketWebsite",
        "s3:PutEncryptionConfiguration",
        "s3:GetEncryptionConfiguration",
        "s3:PutBucketTagging",
        "s3:GetBucketTagging"
      ],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Sid": "DynamoDBManagement",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DeleteTable",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "dynamodb:DescribeTimeToLive",
        "dynamodb:UpdateContinuousBackups",
        "dynamodb:TagResource",
        "dynamodb:UntagResource",
        "dynamodb:ListTagsOfResource"
      ],
      "Resource": "arn:aws:dynamodb:ap-south-1:<ACCOUNT_ID>:table/*"
    },
    {
      "Sid": "CognitoUserPoolManagement",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:CreateUserPool",
        "cognito-idp:DeleteUserPool",
        "cognito-idp:DescribeUserPool",
        "cognito-idp:UpdateUserPool",
        "cognito-idp:CreateUserPoolClient",
        "cognito-idp:DeleteUserPoolClient",
        "cognito-idp:DescribeUserPoolClient",
        "cognito-idp:UpdateUserPoolClient",
        "cognito-idp:TagResource",
        "cognito-idp:UntagResource",
        "cognito-idp:ListTagsForResource"
      ],
      "Resource": "*"
    },
    {
      "Sid": "LambdaFunctionManagement",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:GetFunctionCodeSigningConfig",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:ListVersionsByFunction",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:GetPolicy",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:ListTags"
      ],
      "Resource": "arn:aws:lambda:ap-south-1:<ACCOUNT_ID>:function:*"
    },
    {
      "Sid": "APIGatewayManagement",
      "Effect": "Allow",
      "Action": [
        "apigateway:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchLogsGroupManagement",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:DescribeLogGroups",
        "logs:ListTagsForResource",
        "logs:PutRetentionPolicy",
        "logs:DeleteRetentionPolicy",
        "logs:TagResource",
        "logs:UntagResource"
      ],
      "Resource": "arn:aws:logs:ap-south-1:<ACCOUNT_ID>:log-group:*"
    },
    {
      "Sid": "IAMRoleAndPolicyManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:GetRole",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:GetRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:TagRole",
        "iam:CreatePolicy",
        "iam:GetPolicy",
        "iam:GetPolicyVersion",
        "iam:CreatePolicyVersion",
        "iam:DeletePolicyVersion",
        "iam:DeletePolicy",
        "iam:ListPolicyVersions",
        "iam:TagPolicy"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAMPassRoleForLambda",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "*"
    }
  ]
}
```

---

## 6. The 22-Run Hardening Phase: Troubleshooting & Discovery Log

During automated CI/CD setup and cloud execution, the system went through a rigorous 22-run diagnostic and hardening phase:

### Stage 1: OIDC Authentication & The Token Claim Discovery (Runs 1–12)

* **Runs 1–6 (IAM Open Wildcard Policy Rejections)**:
  * Initial workflow executions failed at AWS authentication with `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
  * Attempting to widen the trust policy with account-level open wildcards (`repo:*`) was rejected by AWS IAM, which enforces strict policy validation requiring explicit repository names.
* **Runs 7–11 (Session Tagging & CloudTrail Auditing)**:
  * Upgraded GitHub Action to `aws-actions/configure-aws-credentials@v6`.
  * Discovered the action was sending 11 role session tags by default, requiring `sts:TagSession`. Even after adding `role-skip-session-tagging: true` and auditing CloudTrail logs in `ap-south-1` and `us-east-1`, STS continued to reject the token.
* **Run 12 (Direct JWT Payload Decoding — The Root Cause)**:
  * Added a pre-authentication step in GitHub Actions to capture and base64-decode the raw OIDC token directly from `$ACTIONS_ID_TOKEN_REQUEST_TOKEN`.
  * **The Ground Truth Discovery:** GitHub's 2026 token format includes **immutable numeric account and repository ID tags (`@<USER_ID>` and `@<REPO_ID>`)** directly inside the `sub` claim:
    ```json
    {
      "actor": "samyakchhajed",
      "actor_id": "<USER_ID>",
      "aud": "sts.amazonaws.com",
      "iss": "https://token.actions.githubusercontent.com",
      "repository": "samyakchhajed/secure-cloud-storage",
      "repository_id": "<REPO_ID>",
      "sub": "repo:samyakchhajed@<USER_ID>/secure-cloud-storage@<REPO_ID>:ref:refs/heads/main"
    }
    ```
  * Because standard AWS guides match `repo:<user>/<repo>:*`, STS string matching failed every single time due to the inserted `@IDs`.
  * **Resolution:** Scoped the IAM trust policy condition to `repo:samyakchhajed@<USER_ID>/secure-cloud-storage@<REPO_ID>:*`, and OIDC authentication succeeded immediately.

---

### Stage 2: Initial Provisioning, CloudFront Holds & Ephemeral State (Runs 13–16)

* **Runs 13–14 (IAM Policy Creation & CloudFront Account Hold)**:
  * OIDC authentication succeeded, and Terraform began provisioning cloud resources.
  * Encountered missing customer-managed IAM policy lifecycle permissions (`iam:CreatePolicy`, `iam:DeletePolicy`, `iam:ListRolePolicies`).
  * AWS returned `403 AccessDenied` on CloudFront distribution creation: *“Your account must be verified before you can add new CloudFront resources”* (an automated anti-abuse hold on new AWS accounts).
  * **Architectural Transition (Option B):** Rather than waiting days for AWS Support ticket verification, transitioned `modules/frontend` to **Direct S3 Static Website Hosting** with SPA fallback (`index.html`), enabling immediate zero-cost cloud deployment.
* **Runs 15–16 (Ephemeral Runner State & Orphaned Cleanup)**:
  * Because runs failed midway on ephemeral GitHub Actions runners without a remote Terraform backend, resources created in earlier partial runs (DynamoDB table, S3 buckets, Cognito pool) were discarded from local state.
  * On subsequent runs, fresh runners collided with existing AWS resources (`ResourceInUseException`, `EntityAlreadyExists`).
  * Cleaned up orphaned resources directly in the AWS Console to restore a clean baseline.

---

### Stage 3: Lambda Creation Loop & Complete Deployment Success (Runs 17–20)

* **Runs 17–19 (The 10+ Minute PassRole Retry Loop)**:
  * Terraform hung on `aws_lambda_function: Still creating...` for over 10 minutes before timing out.
  * **Root Cause:** `iam:PassRole` in the role permissions policy had an overly restrictive condition (`iam:PassedToService: lambda.amazonaws.com`). During function creation, Terraform's provider failed evaluating the role pass condition and entered an internal 15-minute retry loop.
  * **Resolution:** Removed the condition to allow unconditional `iam:PassRole` for Lambda. *(Note: this widens PassRole beyond least-privilege; the correct fix (retry/backoff handling for IAM eventual consistency) is deferred to the ML platform.)*
* **Run 20 (100% Complete Infrastructure Deployment Success)**:
  * **All 54 Terraform resources provisioned cleanly in ~45 seconds**: S3 Storage, DynamoDB Single-Table, Cognito User Pool & App Client, 5 Python 3.12 Lambdas, HTTP API Gateway v2 with 14 routes and JWT Authorizer, and Direct S3 Static Website Hosting.
  * Runtime API endpoint automatically injected into `frontend/config.js`.
  * Static frontend assets synced to S3 and live public application URL published in GitHub Actions step summary.

---

### Stage 4: Runtime Diagnostics & Hardening Discoveries (Runs 21–22)

* **Run 21 (Cognito IDP IAM Policy Syntax Diagnosis)**:
  * Testing user registration returned an internal server error.
  * **Root Cause Diagnosed:** In AWS IAM grammar, client-level Cognito operations (`cognito-idp:SignUp`, `cognito-idp:InitiateAuth`, `cognito-idp:ConfirmSignUp`) operate on the `ClientId` level and do not accept User Pool ARNs. Restricting them to `var.cognito_user_pool_arn` caused IAM to deny the Lambda execution with `AccessDeniedException`.
  * **Diagnostic Resolution:** Splitting the IAM policy into scoped admin actions (`var.cognito_user_pool_arn`) and client auth actions (`Resource: "*"`).
* **Run 22 (API Gateway Data-Plane vs. Control-Plane Permission Boundary Diagnosis)**:
  * Testing user login returned `500 {"message":"Internal Server Error"}` with **zero CloudWatch logs** in Lambda.
  * **Root Cause Diagnosed:** In `terraform/modules/compute/main.tf`, the Lambda invocation permission `source_arn` was pointed to the API Gateway control-plane ARN (`${aws_apigatewayv2_api.http_api.arn}/*/*` -> `arn:aws:apigateway:...`). At runtime, API Gateway invokes Lambda using its data-plane execution ARN (`arn:aws:execute-api:...`). Because the ARNs did not match, AWS Lambda denied the invocation at the perimeter before Python code ever started, generating an API Gateway 500 with zero CloudWatch logs.
  * **Strategic Decision:** Rather than continuing iterative file updates and manual AWS console cleanups on SCS after 22 runs, these vital architectural findings (`execution_arn` data-plane wiring, Cognito client IAM syntax, and persistent S3 `.tfstate` backends) were documented as key engineering discoveries and deferred for direct implementation in the **ML Model & Deployment Comparison** platform.

---

## 7. Architectural Evolution: Hardening Ground for the ML Platform

This 22-run journey in Secure Cloud Storage served as the **foundational trial and infrastructure hardening ground**. Rather than simple happy-path demos, this project uncovered and solved deep, real-world cloud edge cases across AWS IAM, API Gateway v2, OIDC claims, and Terraform state lifecycles.

Every architectural lesson discovered here has been institutionalized and baked into the next project, **[ML Model & Deployment Comparison]**:
1. **Persistent S3 State Backend**: Eliminates runner state drift and unlocks 15-second in-place updates.
2. **Zero Account-ID Exposure**: S3 buckets use `random_id` 4-byte hex suffixes instead of raw account IDs.
3. **Pre-Configured Data-Plane Permissions**: API Gateway permissions use `execution_arn` from Day 1.
4. **Automated Linux Layer Packaging**: ML dependencies (`scikit-learn`, `numpy`, `pandas`) compiled cleanly in CI/CD before Terraform execution.

---

## 8. Running Locally (Frontend)

```sh
cd frontend
python -m http.server 8080
# Open http://localhost:8080 in your browser
```

No npm, no Node.js, no install step. Runs entirely on the local mock API.

To connect to live AWS infrastructure: set `API_BASE_URL` in `frontend/config.js` or `frontend/src/api/client.js`.

---

## 9. Role of AI in This Project

In the spirit of complete transparency, AI was used as an *accelerator and developer assistant* during the building of this project — similar to an advanced pair-programming tool.

- **Human-Led Architecture & Engineering:** All core system designs, trade-off decisions, UX workflows, API contracts, DynamoDB single-table keys, and security boundaries were conceived, directed, and decided by me.
- **AI as a Productivity Tool:** AI assistance was used for generating boilerplate, exploring syntax variations across Terraform and AWS SDK APIs, diagnosing OIDC token claims, and speeding up routine drafting tasks. Every piece of code, configuration, and documentation was reviewed, tested, and shaped to meet the project's strict architectural standards.
