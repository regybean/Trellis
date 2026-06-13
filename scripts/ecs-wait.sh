#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# ECS Service Stability Wait Script (CI/CD only)
# ============================================================================

if [ "${CI:-false}" != "true" ]; then
  echo "ERROR: This script is designed for CI/CD only."
  exit 1
fi

SERVICE_NAME="${1:-}"
ENVIRONMENT="${2:-}"

if [ -z "$SERVICE_NAME" ] || [ -z "$ENVIRONMENT" ]; then
  echo "Usage: ecs-wait.sh <service-name> <staging|production>"
  exit 1
fi

REGION="${AWS_REGION:-eu-west-2}"
CLUSTER_NAME="trellis-cluster"

echo ""
echo "🔍 Waiting for ECS service to become stable"
echo "Service:     $SERVICE_NAME"
echo "Environment: $ENVIRONMENT"
echo "Region:      $REGION"
echo ""

# ----------------------------------------------------------------------------
# OIDC validation
# ----------------------------------------------------------------------------

if [ -z "${BITBUCKET_STEP_OIDC_TOKEN:-}" ]; then
  echo "ERROR: BITBUCKET_STEP_OIDC_TOKEN not found."
  echo "Ensure 'oidc: true' is enabled for this pipeline step."
  exit 1
fi

case "$ENVIRONMENT" in
  staging)
    if [ -z "${AWS_STAGING_ID:-}" ]; then
      echo "ERROR: AWS_STAGING_ID is not set."
      exit 1
    fi
    AWS_ACCOUNT_ID="$AWS_STAGING_ID"
    ROLE_NAME="Staging-Bitbucket-ECS-Deploy-Role"
    ;;
  production)
    if [ -z "${AWS_PRODUCTION_ID:-}" ]; then
      echo "ERROR: AWS_PRODUCTION_ID is not set."
      exit 1
    fi
    AWS_ACCOUNT_ID="$AWS_PRODUCTION_ID"
    ROLE_NAME="Production-Bitbucket-ECS-Deploy-Role"
    ;;
  *)
    echo "ERROR: Environment must be 'staging' or 'production'"
    exit 1
    ;;
esac

# ----------------------------------------------------------------------------
# Setup AWS OIDC
# ----------------------------------------------------------------------------

mkdir -p /.aws-oidc
AWS_WEB_IDENTITY_TOKEN_FILE=/.aws-oidc/web_identity_token
echo "${BITBUCKET_STEP_OIDC_TOKEN}" > "$AWS_WEB_IDENTITY_TOKEN_FILE"
chmod 400 "$AWS_WEB_IDENTITY_TOKEN_FILE"

export AWS_WEB_IDENTITY_TOKEN_FILE
export AWS_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${ROLE_NAME}"
export AWS_DEFAULT_REGION="$REGION"

# ----------------------------------------------------------------------------
# Sanity check AWS access
# ----------------------------------------------------------------------------

echo "🔐 Verifying AWS access..."
aws sts get-caller-identity > /dev/null

# ----------------------------------------------------------------------------
# Optional: assert a deployment exists (extra safety)
# ----------------------------------------------------------------------------

DEPLOYMENT_COUNT=$(aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --query 'services[0].deployments | length(@)' \
  --output text)

if [ "$DEPLOYMENT_COUNT" -lt 1 ]; then
  echo "❌ No ECS deployments found for service $SERVICE_NAME"
  exit 1
fi

echo "📦 Active deployments: $DEPLOYMENT_COUNT"
echo ""

# ----------------------------------------------------------------------------
# Wait for service stability with progress and timeout
# ----------------------------------------------------------------------------

TIMEOUT_SECONDS=300  # 5 minutes
POLL_INTERVAL=10     # Check every 10 seconds
ELAPSED=0

echo "⏳ Waiting for ECS service stability (timeout: ${TIMEOUT_SECONDS}s)..."
echo ""

while true; do
  # Get current service status
  SERVICE_JSON=$(aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME" \
    --output json)

  # Extract deployment info
  RUNNING_COUNT=$(echo "$SERVICE_JSON" | jq -r '.services[0].runningCount // 0')
  DESIRED_COUNT=$(echo "$SERVICE_JSON" | jq -r '.services[0].desiredCount // 0')
  PENDING_COUNT=$(echo "$SERVICE_JSON" | jq -r '.services[0].pendingCount // 0')
  
  # Get primary deployment status
  PRIMARY_STATUS=$(echo "$SERVICE_JSON" | jq -r '.services[0].deployments[] | select(.status == "PRIMARY") | .rolloutState // "UNKNOWN"')
  PRIMARY_RUNNING=$(echo "$SERVICE_JSON" | jq -r '.services[0].deployments[] | select(.status == "PRIMARY") | .runningCount // 0')
  PRIMARY_DESIRED=$(echo "$SERVICE_JSON" | jq -r '.services[0].deployments[] | select(.status == "PRIMARY") | .desiredCount // 0')
  
  # Count active deployments
  ACTIVE_DEPLOYMENTS=$(echo "$SERVICE_JSON" | jq -r '.services[0].deployments | length')

  # Calculate progress percentage
  if [ "$DESIRED_COUNT" -gt 0 ]; then
    PROGRESS=$((RUNNING_COUNT * 100 / DESIRED_COUNT))
  else
    PROGRESS=0
  fi

  # Show current status
  TIMESTAMP=$(date '+%H:%M:%S')
  echo "[$TIMESTAMP] ⏱️  ${ELAPSED}s/${TIMEOUT_SECONDS}s | 🚀 Running: ${RUNNING_COUNT}/${DESIRED_COUNT} (${PROGRESS}%) | ⏳ Pending: ${PENDING_COUNT} | 📦 Deployments: ${ACTIVE_DEPLOYMENTS} | Status: ${PRIMARY_STATUS}"

  # Check if service is stable
  if [ "$PRIMARY_STATUS" = "COMPLETED" ] && [ "$RUNNING_COUNT" -eq "$DESIRED_COUNT" ] && [ "$ACTIVE_DEPLOYMENTS" -eq 1 ]; then
    echo ""
    echo "✅ ECS service is stable"
    echo "   Running: ${RUNNING_COUNT}/${DESIRED_COUNT} tasks"
    echo ""
    exit 0
  fi

  # Check for failed deployment
  if [ "$PRIMARY_STATUS" = "FAILED" ]; then
    echo ""
    echo "❌ ECS deployment failed"
    echo ""
    echo "Recent ECS events:"
    echo "$SERVICE_JSON" | jq -r '.services[0].events[0:10] | .[] | "  [\(.createdAt)] \(.message)"'
    exit 1
  fi

  # Check timeout
  if [ "$ELAPSED" -ge "$TIMEOUT_SECONDS" ]; then
    echo ""
    echo "❌ Timeout: ECS service failed to stabilize within ${TIMEOUT_SECONDS}s"
    echo ""
    echo "Current state:"
    echo "  Running:  ${RUNNING_COUNT}/${DESIRED_COUNT}"
    echo "  Pending:  ${PENDING_COUNT}"
    echo "  Status:   ${PRIMARY_STATUS}"
    echo ""
    echo "Recent ECS events:"
    echo "$SERVICE_JSON" | jq -r '.services[0].events[0:10] | .[] | "  [\(.createdAt)] \(.message)"'
    exit 1
  fi

  # Wait before next poll
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done