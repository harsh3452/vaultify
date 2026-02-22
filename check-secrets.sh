#!/bin/bash
# Pre-commit security check script
# Run this before committing to ensure no secrets are exposed

echo ""
echo "🔐 Security Pre-Commit Check"
echo "=============================="
echo ""

# Check if sensitive files would be committed
echo "📋 Checking for sensitive files..."

SENSITIVE_FILES=(
    "backend/.env"
    "backend/firebase-admin-sdk.json"
    "frontend/.env"
    "test-password-reset.html"
    "test-password-reset-debug.html"
    "update-firebase-config.bat"
)

FOUND_ISSUES=0

for file in "${SENSITIVE_FILES[@]}"; do
    if git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
        echo "❌ CRITICAL: $file is tracked by git and will be committed!"
        echo "   Fix: git rm --cached $file"
        FOUND_ISSUES=1
    fi
done

if [ $FOUND_ISSUES -eq 0 ]; then
    echo "✅ No sensitive files are being tracked"
fi

echo ""
echo "🔍 Checking staged files for secrets..."

# Check staged files for common secret patterns
if git diff --cached --name-only | grep -q .; then
    # Patterns to search for
    if git diff --cached | grep -iE "(password.*=.{6,}|api.?key.*=|private.?key.*=|secret.*=)" | grep -v "placeholder\|example\|YOUR_"; then
        echo "⚠️  WARNING: Potential secrets found in staged changes!"
        echo "   Review the output above carefully"
        FOUND_ISSUES=1
    else
        echo "✅ No obvious secrets found in staged changes"
    fi
else
    echo "ℹ️  No files staged for commit"
fi

echo ""
echo "📊 Staged files that will be committed:"
git diff --cached --name-only | sed 's/^/   /'

echo ""
if [ $FOUND_ISSUES -eq 0 ]; then
    echo "✅ Security check passed!"
    echo ""
    exit 0
else
    echo "❌ Security check FAILED!"
    echo "   Fix the issues above before committing"
    echo ""
    exit 1
fi
