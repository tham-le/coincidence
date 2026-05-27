#!/bin/bash

# Global Synchronicity Timeline - Automation Script

echo "🚀 Starting Global Synchronicity Timeline Setup..."

# 1. Backend Setup
echo "📦 Installing Backend Dependencies..."
cd backend
npm install --silent

# 2. Database check
if [ ! -f "coincidence.db" ]; then
    echo "🏗️  Seeding initial database..."
    node seed.js
fi
cd ..

# 3. Frontend Build
echo "🏗️  Building the UI (This makes the site visible)..."
cd frontend
npm install --silent
npm run build --silent
cd ..

# 4. Launch
echo "🌟 Success! The site is now visible."
echo "📡 Open: http://localhost:3000"

cd backend
node server.js
