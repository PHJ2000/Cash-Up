#!/bin/bash
set -e  # Exit on error
set -o pipefail  # Exit on pipe failures

echo "========================================="
echo "🚀 Cash-Up Deployment Script"
echo "========================================="
echo "Started at: $(date)"
echo ""

# Error handler
error_handler() {
    echo ""
    echo "❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌"
    echo "❌ DEPLOYMENT SCRIPT FAILED!"
    echo "❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌"
    echo ""
    echo "Error occurred in: $BASH_COMMAND"
    echo "At line: $1"
    echo "Exit code: $2"
    echo ""
    echo "Current directory: $(pwd)"
    echo "Time: $(date)"
    echo ""
    exit $2
}

trap 'error_handler ${LINENO} $?' ERR

# 변수 설정
APP_DIR="/var/www/cash-up"
BACKEND_DIR="$APP_DIR/server"
FRONTEND_DIR="$APP_DIR"

# 현재 디렉토리 확인
if [ ! -d "$APP_DIR" ]; then
    echo "❌ Error: Application directory not found at $APP_DIR"
    exit 1
fi

cd $APP_DIR

echo ""
echo "📁 Current directory: $(pwd)"
echo ""

# ==========================================
# Backend 배포 (Python FastAPI)
# ==========================================
echo "========================================="
echo "🐍 Deploying Python Backend (FastAPI)"
echo "========================================="

cd $BACKEND_DIR

# Python 가상환경 생성 및 활성화
if [ ! -d "venv" ]; then
    echo "📦 Creating Python virtual environment..."
    python3.11 -m venv venv
fi

echo "🔄 Activating virtual environment..."
source venv/bin/activate

# Python 의존성 설치
echo "📥 Installing Python dependencies..."
if ! pip install --upgrade pip; then
    echo "❌ Failed to upgrade pip"
    exit 1
fi

if ! pip install -r requirements.txt; then
    echo "❌ Failed to install Python dependencies"
    echo "Requirements file content:"
    cat requirements.txt
    exit 1
fi
echo "✅ Python dependencies installed successfully"

# Ultralytics HUB API 사용 확인
if grep -q "ULTRALYTICS_API_KEY" .env 2>/dev/null; then
    echo "✅ Ultralytics HUB API configured"
else
    echo "⚠️  Warning: ULTRALYTICS_API_KEY not found in .env"
    echo "Please set up Ultralytics HUB API for YOLO detection"
    echo "See ULTRALYTICS_HUB_SETUP.md for details"
fi

# SQLite 데이터베이스 디렉토리 확인
if [ ! -d "app/db" ]; then
    mkdir -p app/db
    echo "📁 Created database directory"
fi

# uploads 디렉토리 확인
if [ ! -d "uploads" ]; then
    mkdir -p uploads
    echo "📁 Created uploads directory"
fi

# FastAPI 서비스 재시작
echo "🔄 Restarting FastAPI service..."
pm2 delete cashup-backend 2>/dev/null || true
pm2 start "uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload" --name cashup-backend

echo "✅ FastAPI backend deployed successfully!"
echo ""

# ==========================================
# Node.js Backend 배포 (Prisma + Express)
# ==========================================
echo "========================================="
echo "📦 Deploying Node.js Backend (Prisma)"
echo "========================================="

cd $BACKEND_DIR

if [ -f "package.json" ]; then
    echo "📥 Installing Node.js dependencies..."
    if ! npm install; then
        echo "❌ Failed to install Node.js dependencies"
        echo "Node version: $(node --version)"
        echo "NPM version: $(npm --version)"
        exit 1
    fi
    echo "✅ Node.js dependencies installed"

    echo "🔨 Generating Prisma Client..."
    if ! npx prisma generate; then
        echo "❌ Failed to generate Prisma client"
        exit 1
    fi
    echo "✅ Prisma client generated"

    echo "🔄 Running Prisma migrations (if needed)..."
    npx prisma migrate deploy 2>/dev/null || echo "⚠️  No migrations to run"

    if [ -f "tsconfig.json" ]; then
        echo "🔨 Building TypeScript..."
        if ! npm run build; then
            echo "❌ TypeScript build failed"
            exit 1
        fi
        echo "✅ TypeScript build successful"
    fi

    echo "🔄 Restarting Node.js service..."
    pm2 delete cashup-node 2>/dev/null || true
    pm2 start npm --name cashup-node -- start || echo "⚠️  Node.js service not started (may not be needed)"

    echo "✅ Node.js backend deployed successfully!"
else
    echo "⚠️  No Node.js package.json found, skipping Node backend deployment"
fi

echo ""

# ==========================================
# Frontend 배포 (React + Vite)
# ==========================================
echo "========================================="
echo "⚛️  Building Frontend (React)"
echo "========================================="

cd $FRONTEND_DIR

echo "📥 Installing frontend dependencies..."
if ! npm install; then
    echo "❌ Failed to install frontend dependencies"
    echo "Node version: $(node --version)"
    echo "NPM version: $(npm --version)"
    echo "Package.json location: $(pwd)/package.json"
    exit 1
fi
echo "✅ Frontend dependencies installed"

echo "🔨 Building React application..."
if ! npm run build; then
    echo "❌ Frontend build failed"
    echo "Check Vite configuration and build errors above"
    echo "Environment variables:"
    cat .env.production 2>/dev/null || echo "No .env.production file"
    exit 1
fi

if [ ! -d "dist" ]; then
    echo "❌ Error: Build failed - dist directory not found!"
    echo "Current directory: $(pwd)"
    ls -la
    exit 1
fi

echo "✅ Frontend built successfully!"
echo "📦 Build output:"
du -sh dist/
ls -lh dist/
echo ""

# ==========================================
# Nginx 설정
# ==========================================
echo "========================================="
echo "🌐 Configuring Nginx"
echo "========================================="

# Nginx 설정 파일이 있는지 확인
if [ -f "$APP_DIR/nginx.conf" ]; then
    # Nginx 설정이 아직 활성화되지 않은 경우에만 설정
    if [ ! -L /etc/nginx/sites-enabled/cashup ]; then
        echo "📝 Setting up Nginx configuration..."
        sudo cp $APP_DIR/nginx.conf /etc/nginx/sites-available/cashup
        sudo ln -sf /etc/nginx/sites-available/cashup /etc/nginx/sites-enabled/cashup

        # 기본 사이트 비활성화 (선택사항)
        sudo rm -f /etc/nginx/sites-enabled/default

        echo "✅ Nginx configuration created"
    else
        echo "🔄 Updating existing Nginx configuration..."
        sudo cp $APP_DIR/nginx.conf /etc/nginx/sites-available/cashup
    fi

    # Nginx 설정 테스트
    echo "🧪 Testing Nginx configuration..."
    if sudo nginx -t; then
        echo "🔄 Reloading Nginx..."
        sudo systemctl reload nginx
        echo "✅ Nginx reloaded successfully!"
    else
        echo "❌ Error: Nginx configuration test failed!"
        exit 1
    fi
else
    echo "⚠️  Warning: nginx.conf not found at $APP_DIR/nginx.conf"
    echo "Please create the Nginx configuration file manually"
fi

echo ""

# ==========================================
# PM2 설정 저장
# ==========================================
echo "💾 Saving PM2 process list..."
pm2 save

# PM2 startup 스크립트 생성 (처음 한 번만 실행 필요)
# pm2 startup 명령은 수동으로 실행해야 합니다

echo ""
echo "========================================="
echo "✅ Deployment Completed Successfully!"
echo "========================================="
echo ""
echo "📊 Service Status:"
pm2 status

echo ""
echo "🔗 Access your application:"
echo "   - Frontend: http://$(curl -s ifconfig.me)"
echo "   - Backend API: http://$(curl -s ifconfig.me)/api/health"
echo ""
echo "📝 Useful commands:"
echo "   - View logs: pm2 logs"
echo "   - Restart services: pm2 restart all"
echo "   - Stop services: pm2 stop all"
echo ""
echo "========================================="