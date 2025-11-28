# Cash-Up (해운대 불꽃축제 청소 리워드 MVP)

부울경 축제 현장에서 쓰레기 줍기 인증 → 포인트 적립 → 수거함 QR로 활성화 → 쿠폰 발급까지 한 번에 처리하는 모바일 웹 + FastAPI 백엔드 모노레포입니다.

## 폴더 구조
- `src/` : Vite + React + TypeScript 모바일 웹 (Tailwind)
- `server/` : FastAPI + SQLAlchemy + SQLite API 서버

## 빠른 실행
### 1) 프론트엔드
```bash
npm install
npm run dev   # http://localhost:5173
```

### 2) 백엔드 (FastAPI + SQLite)
```bash
cd server
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env           # 필요하면 값 수정 (기본 admin 비밀번호/토큰 admin123)
python seed.py                 # 기본 축제 + 수거함 3개 생성
uvicorn app.main:app --reload --port 4000   # http://localhost:4000
```

> API 기본 경로: `http://localhost:4000/api` (프론트의 기본값). 서버 포트를 변경하면 `VITE_API_URL`을 Vite에 지정하세요.

## 주요 엔드포인트 요약
- `POST /api/auth/mock-login` : 닉네임으로 임시 계정 생성 + 토큰 발급 (모든 API는 Bearer 토큰 필요)
- `GET /api/festivals` / `GET /api/festivals/:id` : 축제 기본 설정/수거함 목록 조회
- `POST /api/festivals/:id/trash-photos` : 카메라 촬영 업로드 → 해시 중복 검사 → YOLO 분석 저장 → PENDING 포인트 적립
- `POST /api/festivals/:id/trash-bins/scan` : 위치+코드 검증 후 최근 30분 내 PENDING만 ACTIVE 전환
- `POST /api/festivals/:id/coupons` : ACTIVE 포인트 차감 후 쿠폰 발급 (예산/상한 체크)
- `GET /api/users/:id/summary|photos|coupons` : KST 기준 일일 요약/활동/쿠폰 조회
- 관리자: `POST /api/admin/login`, `POST /api/admin/festivals`, `POST /api/admin/festivals/:id/trash-bins/generate`, `GET /api/admin/festivals/:id/summary` (예산 사용량 포함)

## 관리자 기본 설정
- `.env` 예시는 `server/.env.example` 참고 (관리자 비밀번호/토큰 `admin123`)
- 시드 실행 시 기본 축제: 해운대 불꽃축제 (반경 1.2km, 1장당 100원, 1일 3,000원)

## 데모 플로우 (모바일 웹)
1. `/` 랜딩 → CTA “청소하고 리워드 받기 시작”
2. `/login` 닉네임 입력 → 임시 계정 생성
3. `/home` 오늘 PENDING/ACTIVE/상한 확인, 촬영/QR/지갑/수거함 이동 버튼
4. `/upload` 카메라 촬영(실시간) → 위치 검증 → 이미지 해시 중복 검사 → YOLO 분석 저장 → PENDING 포인트 적립
5. `/scan` 수거함 QR 코드 번호 입력 → 최근 30분 내 PENDING을 ACTIVE로 전환 (상한 적용)
6. `/wallet` ACTIVE 포인트로 제휴 상점 쿠폰 발급 → 코드 표시
7. `/activity` 업로드한 사진/상태/YOLO 감지 카운트 타임라인
8. `/admin` 관리자 로그인 → 축제 생성, 수거함 코드 생성, 실시간 대시보드

## 백엔드 스택 및 이미지/YOLO 처리
- FastAPI + SQLAlchemy + SQLite
- 이미지 처리/해싱: `Pillow`, `imagehash` (average hash, hamming distance)
- 객체 인식: **Ultralytics HUB API** 사용 (클라우드 기반 YOLOv8)
  - 로컬 GPU/고성능 CPU 불필요
  - t2.micro/t3.small EC2로 운영 가능
  - 분석 결과를 DB에 저장 (has_trash, trash_count, max_confidence, raw_detections)
- YOLO 실패/API 키 미설정 시에도 업로드는 통과하며, 분석 필드는 `null`로 기록

## 업로드/QR 스캔 로직 (서버)
- 업로드: 위치 검증 → 1분 5장 쿨타임 → 최근 20장 해시 비교(해밍 거리 ≤5 거절) → YOLO 결과 저장 → 페스티벌 예산/1인 상한(KST 일자) 내에서 PENDING 적립
- QR 스캔: 위치 검증 → 예산 소진 시 차단 → 최근 30분 내 PENDING만, 1인 일일 상한 내에서 ACTIVE 전환
- 쿠폰 발급: ACTIVE 차감 + 예산 잔여 확인 후 발급
- 예산 사용량: PENDING/ACTIVE 포인트 + 발급된 쿠폰 금액을 합산, 관리자 대시보드에서 `budgetUsed/budgetRemaining` 확인 가능

## 부정 행위 방어 로직
- 동일 사진 재탕 방지: Pillow+imagehash average hash → 최근 20장과 해밍 거리 5 이하 거절
- 과도한 연사 방지: 1분 내 업로드 5장 이상 시 거절
- 위치 검증: 업로드/QR 스캔 모두 축제 중심 좌표+반경 밖이면 거절
- 일일 상한: Asia/Seoul(KST) 기준 00:00~23:59, 총합(cap) 초과 시 업로드/활성화/쿠폰 발급 차단
- 예산 상한: 페스티벌 예산 소진 시 PENDING 생성/ACTIVE 전환/쿠폰 발급 차단
- YOLO 분석 데이터 축적: 현재는 차단 조건이 아니며, 추후 규칙 고도화를 위한 데이터로 저장

## 인증/보안
- `POST /api/auth/mock-login`에서 토큰 발급 → 프론트는 localStorage에 저장 후 모든 API 요청에 `Authorization: Bearer <token>` 전달
- 관리자 API는 `X-Admin-Token` 헤더로 인증
- 정적 업로드 파일은 `/uploads/*` 경로로 제공

## 환경 변수
`server/.env.example` 또는 `.env.example` 참고
```
DATABASE_URL="file:./dev.db"
PORT=4000
ADMIN_PASSWORD="admin123"
ADMIN_TOKEN="admin123"
SECRET_KEY="dev-secret-key"   # 사용자 토큰 서명 키
FESTIVAL_ID="" # 기본 축제 ID를 지정하고 싶을 때

# Ultralytics HUB API (필수)
ULTRALYTICS_API_KEY="api_your_key_here"  # https://hub.ultralytics.com 에서 발급
YOLO_MODEL_ID="yolov8n"
```

### Ultralytics HUB API 설정
자세한 설정 방법은 [ULTRALYTICS_HUB_SETUP.md](./ULTRALYTICS_HUB_SETUP.md) 참고

## 배포 (AWS EC2)

GitHub Actions를 사용한 AWS EC2 자동 배포 지원

### 빠른 시작
```bash
# 1. EC2 인스턴스 생성 및 초기 설정
# 2. GitHub Secrets 설정 (EC2_HOST, EC2_USER, EC2_SSH_KEY, ENV_PRODUCTION)
# 3. main 브랜치에 push하면 자동 배포
```

### 배포 문서
- **📖 [QUICKSTART.md](./QUICKSTART.md)** - 빠른 시작 가이드 (핵심 단계만)
- **📚 [DEPLOYMENT.md](./DEPLOYMENT.md)** - 상세 배포 가이드 (전체 설명)

### 배포 구성
- **프론트엔드**: Nginx로 정적 파일 서빙
- **백엔드 (Python)**: PM2로 FastAPI 프로세스 관리
- **백엔드 (Node.js)**: PM2로 Express 프로세스 관리 (선택사항)
- **자동 배포**: GitHub Actions workflow (`.github/workflows/deploy.yml`)

### 배포 스크립트
- `deploy.sh` - 서버 배포 자동화 스크립트
- `nginx.conf` - Nginx 리버스 프록시 설정

## 참고
- 이미지 업로드는 서버 로컬 `server/uploads`에 저장, 정적 서빙 `/uploads/*`
- QR 스캔은 숫자 코드 입력으로 대체 (카메라 라이브 스캔 라이브러리 필요 없음)
- **Ultralytics HUB API 사용으로 YOLO 모델 파일 다운로드 불필요** - EC2 비용 절감 가능
- 프로덕션 환경에서는 SSL/HTTPS 설정 필수 (Let's Encrypt 사용 권장)
- Ultralytics HUB Free Tier: 월 1,000 predictions 무료
