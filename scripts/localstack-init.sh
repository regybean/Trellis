#!/bin/bash
# LocalStack S3 Initialization Script
# This script creates the S3 bucket and configures CORS for development

set -e

echo "Waiting for LocalStack to be ready..."
# Wait for LocalStack S3 to be ready
until aws --endpoint-url=http://localhost:4566 s3 ls > /dev/null 2>&1; do
  echo "Waiting for LocalStack S3..."
  sleep 2
done

BUCKET_NAME="${S3_UPLOAD_BUCKET:-upload-temp-bucket}"

echo "Creating S3 bucket: $BUCKET_NAME"

# Create the bucket (ignore error if it already exists)
aws --endpoint-url=http://localhost:4566 s3 mb "s3://$BUCKET_NAME" 2>/dev/null || true

echo "Configuring CORS for browser uploads..."

# Configure CORS to allow browser uploads
aws --endpoint-url=http://localhost:4566 s3api put-bucket-cors \
  --bucket "$BUCKET_NAME" \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedOrigins": ["http://localhost:3000", "http://localhost:3001"],
        "AllowedMethods": ["PUT", "GET", "HEAD", "DELETE"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag", "Content-Length"],
        "MaxAgeSeconds": 3600
      }
    ]
  }'

echo "S3 bucket $BUCKET_NAME is ready for development!"
echo ""
echo "To verify:"
echo "  aws --endpoint-url=http://localhost:4566 s3 ls"
echo "  aws --endpoint-url=http://localhost:4566 s3api get-bucket-cors --bucket $BUCKET_NAME"
