#!/usr/bin/env bash
# Ensure AWS SSO session is valid before running commands

PROFILE="dev"
AWS_CMD="aws s3 ls --profile $PROFILE"

# Try a harmless AWS command to verify creds are valid
$AWS_CMD > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "SSO session expired. Re-authenticating..."
  aws sso login --sso-session "$PROFILE" --no-browser
fi

# Now you can safely run AWS commands
# Example:
aws sts get-caller-identity --profile "$PROFILE"