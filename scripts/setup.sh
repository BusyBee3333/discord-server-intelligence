#!/bin/bash
set -e

echo "🧠 Discord Server Intelligence Setup"
echo "======================================"

# Copy example config
if [ -f config.json ]; then
  echo "⚠️  config.json already exists — skipping copy."
else
  cp config.example.json config.json
  echo "✅ Created config.json from config.example.json"
fi

# Create output directory
mkdir -p output
echo "✅ Created output/ directory"

echo ""
echo "Next steps:"
echo "  1. Edit config.json with your bot token, guild ID, and Gemini API key"
echo "  2. (Optional) Add nanoBananaPro.path to config.json for infographic generation"
echo "  3. Run: npm run analyze"
echo ""
echo "To schedule weekly (Sunday 8pm): add this to your crontab:"
echo "  0 20 * * 0 cd $(pwd) && npm run full >> output/cron.log 2>&1"
