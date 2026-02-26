#!/bin/bash
set -e

# Build the frontend
echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

# Prepare backend/public
echo "Preparing backend/public..."
rm -rf backend/public
mkdir -p backend/public

# Copy build files to backend/public
echo "Copying build files..."
cp -r frontend/build/client/* backend/public/

echo "Build complete! Backend is ready to serve the UI."
