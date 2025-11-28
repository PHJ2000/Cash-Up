import base64
import hmac
import math
import os
import re
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

import random
import imagehash
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import BASE_DIR, create_db_and_tables, get_db
from .yolo_utils import analyze_trash
from .models import (
    BinScan,
    Coupon,
    Festival,
    JackpotEntry,
    JackpotPool,
    JackpotWinner,
    TrashBin,
    TrashPhoto,
    User,
    UserDailySummary,
)

load_dotenv()

PHOTO_STATUS_PENDING = "PENDING"
PHOTO_STATUS_ACTIVE = "ACTIVE"

COUPON_STATUS_ISSUED = "ISSUED"

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "admin123")
DEFAULT_FESTIVAL_ID = os.getenv("FESTIVAL_ID")
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")

KST = ZoneInfo("Asia/Seoul")
PENDING_ACTIVATION_MINUTES = 30

UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True, parents=True)

app = FastAPI(title="Cash Up API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


def get_today() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    to_rad = math.pi / 180
    r = 6371_000
    phi1 = lat1 * to_rad
    phi2 = lat2 * to_rad
    dphi = (lat2 - lat1) * to_rad
    dlambda = (lon2 - lon1) * to_rad
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def is_inside_festival(
    festival: Festival, lat: Optional[float] = None, lng: Optional[float] = None
) -> bool:
    if festival.center_lat is None or festival.center_lng is None:
        return True
    if lat is None or lng is None:
        return False
    distance = haversine_distance(lat, lng, festival.center_lat, festival.center_lng)
    radius = festival.radius_meters or 1500
    return distance <= radius


def ensure_summary(db: Session, user_id: str, festival_id: str) -> UserDailySummary:
    today = get_today()
    summary = (
        db.execute(
            select(UserDailySummary).where(
                UserDailySummary.user_id == user_id,
                UserDailySummary.festival_id == festival_id,
                UserDailySummary.date == today,
            )
        )
        .scalars()
        .first()
    )
    if summary:
        return summary
    summary = UserDailySummary(user_id=user_id, festival_id=festival_id, date=today)
    db.add(summary)
    db.commit()
    db.refresh(summary)
    return summary


def get_budget_usage(db: Session, festival_id: str) -> int:
    photo_points = (
        db.execute(
            select(func.coalesce(func.sum(TrashPhoto.points), 0)).where(TrashPhoto.festival_id == festival_id)
        ).scalar_one()
        or 0
    )
    coupon_points = (
        db.execute(select(func.coalesce(func.sum(Coupon.amount), 0)).where(Coupon.festival_id == festival_id)).scalar_one()
        or 0
    )
    return int(photo_points + coupon_points)


def ensure_budget_room(db: Session, festival: Festival, needed: int):
    used = get_budget_usage(db, festival.id)
    if used + needed > festival.budget:
        raise HTTPException(status_code=400, detail={"message": "오늘 리워드 예산이 모두 소진되었습니다."})


def hamming_distance(a: str, b: str) -> int:
    if len(a) != len(b):
        return max(len(a), len(b))
    return sum(ch1 != ch2 for ch1, ch2 in zip(a, b))


def compute_image_hash(file_path: Path) -> str:
    with Image.open(file_path) as img:
        hash_val = imagehash.average_hash(img)
    return str(hash_val)


def parse_hash(value: str):
    """Return imagehash.ImageHash or None for stored string formats."""
    if not value:
        return None
    try:
        if re.fullmatch(r"[0-9a-fA-F]+", value):
            return imagehash.hex_to_hash(value)
        if len(value) == 64 and set(value).issubset({"0", "1"}):
            hex_str = f"{int(value, 2):016x}"
            return imagehash.hex_to_hash(hex_str)
    except Exception:
        return None
    return None


def create_token(user_id: str) -> str:
    issued_at = str(int(time.time()))
    payload = f"{user_id}:{issued_at}".encode()
    signature = hmac.new(SECRET_KEY.encode(), payload, "sha256").hexdigest()
    token = base64.urlsafe_b64encode(payload + b":" + signature.encode()).decode()
    return token


def verify_token(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        user_id, issued_at, signature = raw.split(":")
        payload = f"{user_id}:{issued_at}".encode()
        expected = hmac.new(SECRET_KEY.encode(), payload, "sha256").hexdigest()
        if not hmac.compare_digest(expected, signature):
            return None
        # 30일 만료
        if int(time.time()) - int(issued_at) > 60 * 60 * 24 * 30:
            return None
        return user_id
    except Exception:
        return None


def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        http_error(401, "인증이 필요합니다.")
    token = authorization.split(" ", 1)[1]
    user_id = verify_token(token)
    if not user_id:
        http_error(401, "토큰이 유효하지 않습니다.")
    return user_id


def require_admin(token: Optional[str]):
    if token != ADMIN_TOKEN:
        http_error(401, "관리자 인증이 필요합니다.")


def http_error(status: int, message: str):
    raise HTTPException(status_code=status, detail={"message": message})


def normalize_bin_code(bin_code: Optional[str]) -> Optional[str]:
    if bin_code is None:
        return None
    code = str(bin_code).strip().upper().replace("-", "_").replace(" ", "")
    match = re.search(r"(\d+)$", code)
    if match and (code.isdigit() or code.startswith("TRASHBIN") or code.startswith("TRASH_BIN")):
        return f"TRASH_BIN_{int(match.group(1)):02d}"
    return code


def serialize_festival(festival: Festival):
    return {
        "id": festival.id,
        "name": festival.name,
        "budget": festival.budget,
        "perUserDailyCap": festival.per_user_daily_cap,
        "perPhotoPoint": festival.per_photo_point,
        "centerLat": festival.center_lat,
        "centerLng": festival.center_lng,
        "radiusMeters": festival.radius_meters,
    }


def serialize_bin(bin_obj: TrashBin):
    return {
        "id": bin_obj.id,
        "code": bin_obj.code,
        "name": bin_obj.name,
        "description": bin_obj.description,
        "latitude": bin_obj.latitude,
        "longitude": bin_obj.longitude,
    }


def serialize_photo(photo: TrashPhoto):
    return {
        "id": photo.id,
        "userId": photo.user_id,
        "festivalId": photo.festival_id,
        "imageUrl": photo.image_url,
        "status": photo.status,
        "points": photo.points,
        "hasTrash": photo.has_trash,
        "trashCount": photo.trash_count,
        "maxTrashConfidence": photo.max_trash_confidence,
        "yoloRaw": photo.yolo_raw,
        "createdAt": photo.created_at.isoformat(),
    }


def serialize_coupon(coupon: Coupon):
    return {
        "id": coupon.id,
        "shopName": coupon.shop_name,
        "amount": coupon.amount,
        "code": coupon.code,
        "status": coupon.status,
        "createdAt": coupon.created_at.isoformat(),
    }


@app.on_event("startup")
def on_startup():
    create_db_and_tables()


def get_db_dep():
    with get_db() as db:
        yield db


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/auth/mock-login")
def mock_login(payload: dict, db: Session = Depends(get_db_dep)):
    nickname = payload.get("nickname")
    if not nickname:
        http_error(400, "닉네임을 입력해 ")
    user = User(provider="mock", provider_user_id=str(time.time_ns()), display_name=nickname)
    db.add(user)
    db.flush()
    db.refresh(user)
    token = create_token(user.id)
    return {"user": {"id": user.id, "displayName": user.display_name}, "token": token}


@app.get("/api/festivals")
def list_festivals(db: Session = Depends(get_db_dep)):
    festivals = (
        db.execute(select(Festival).order_by(Festival.created_at.desc())).scalars().all()
    )
    return {"festivals": [serialize_festival(f) for f in festivals]}


@app.get("/api/festivals/{festival_id}")
def get_festival(festival_id: str, db: Session = Depends(get_db_dep)):
    festival = db.get(Festival, festival_id)
    if not festival:
        http_error(404, "축제를 찾을 수 없습니다.")
    bins = (
        db.execute(
            select(TrashBin).where(TrashBin.festival_id == festival_id).order_by(TrashBin.code.asc())
        )
        .scalars()
        .all()
    )
    return {"festival": serialize_festival(festival), "bins": [serialize_bin(b) for b in bins]}


@app.get("/api/festivals/{festival_id}/trash-bins")
def list_bins(festival_id: str, db: Session = Depends(get_db_dep)):
    bins = (
        db.execute(
            select(TrashBin).where(TrashBin.festival_id == festival_id).order_by(TrashBin.code.asc())
        )
        .scalars()
        .all()
    )
    return {"bins": [serialize_bin(b) for b in bins]}


@app.get("/api/users/{user_id}/summary")
def get_summary(
    user_id: str,
    festivalId: Optional[str] = None,
    db: Session = Depends(get_db_dep),
    current_user_id: str = Depends(get_current_user_id),
):
    if current_user_id != user_id:
        http_error(403, "본인 정보만 조회할 수 있습니다.")
    festival_id = festivalId or DEFAULT_FESTIVAL_ID
    if not festival_id:
        http_error(400, "festivalId가 필요합니다.")
    festival = db.get(Festival, festival_id)
    user = db.get(User, user_id)
    if not festival:
        http_error(404, "축제를 찾을 수 없습니다.")
    if not user:
        http_error(404, "유저를 찾을 수 없습니다.")
    summary = ensure_summary(db, user_id, festival_id)
    return {"festival": serialize_festival(festival), "summary": {
        "totalPending": summary.total_pending,
        "totalActive": summary.total_active,
        "totalConsumed": summary.total_consumed,
        "cap": festival.per_user_daily_cap,
    }}


@app.get("/api/users/{user_id}/photos")
def list_photos(
    user_id: str,
    festivalId: Optional[str] = None,
    db: Session = Depends(get_db_dep),
    current_user_id: str = Depends(get_current_user_id),
):
    if current_user_id != user_id:
        http_error(403, "본인 정보만 조회할 수 있습니다.")
    festival_id = festivalId or DEFAULT_FESTIVAL_ID
    if not festival_id:
        http_error(400, "festivalId가 필요합니다.")
    photos = (
        db.execute(
            select(TrashPhoto)
            .where(TrashPhoto.user_id == user_id, TrashPhoto.festival_id == festival_id)
            .order_by(TrashPhoto.created_at.desc())
        )
        .scalars()
        .all()
    )
    return {"photos": [serialize_photo(p) for p in photos]}


@app.post("/api/festivals/{festival_id}/trash-photos")
def upload_photo(
    festival_id: str,
    userId: str = Form(None),
    lat: Optional[str] = Form(None),
    lng: Optional[str] = Form(None),
    image: UploadFile = File(...),
    db: Session = Depends(get_db_dep),
    current_user_id: str = Depends(get_current_user_id),
):
    user_id = userId or current_user_id
    if user_id != current_user_id:
        http_error(403, "본인 계정으로만 업로드할 수 있습니다.")
    user = db.get(User, user_id)
    festival = db.get(Festival, festival_id)
    if not user:
        http_error(404, "유저를 찾을 수 없습니다.")
    if not festival:
        http_error(404, "축제를 찾을 수 없습니다.")

    latitude = float(lat) if lat is not None else None
    longitude = float(lng) if lng is not None else None
    if not is_inside_festival(festival, latitude, longitude):
        http_error(400, "축제장 안에서만 참여할 수 있어요.")

    one_minute_ago = datetime.utcnow() - timedelta(minutes=1)
    recent_count = (
        db.execute(
            select(func.count(TrashPhoto.id)).where(
                TrashPhoto.user_id == user_id,
                TrashPhoto.created_at >= one_minute_ago,
            )
        )
        .scalar_one()
    )
    if recent_count >= 5:
        http_error(429, "조금 쉬었다가 다시 시도해주세요.")

    extension = Path(image.filename or "").suffix or ".jpg"
    file_name = f"{int(time.time())}-{int(time.time_ns() % 1e6)}{extension}"
    save_path = UPLOAD_DIR / file_name
    with save_path.open("wb") as buffer:
        shutil.copyfileobj(image.file, buffer)

    new_hash = compute_image_hash(save_path)
    new_hash_obj = parse_hash(new_hash)
    recent_photos = (
        db.execute(
            select(TrashPhoto)
            .where(TrashPhoto.user_id == user_id)
            .order_by(TrashPhoto.created_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )
    for photo in recent_photos:
        existing_hash = parse_hash(photo.hash) if photo.hash else None
        if existing_hash and new_hash_obj:
            distance = new_hash_obj - existing_hash
        else:
            distance = hamming_distance(photo.hash, new_hash)
        if distance <= 5:
            save_path.unlink(missing_ok=True)
            http_error(400, "같은 사진으로는 다시 적립할 수 없어요.")

    yolo_result = analyze_trash(str(save_path))

    summary = ensure_summary(db, user_id, festival_id)
    today_total = summary.total_pending + summary.total_active + summary.total_consumed
    if today_total >= festival.per_user_daily_cap:
        save_path.unlink(missing_ok=True)
        http_error(400, "오늘 한도가 모두 사용되었습니다.")

    try:
        ensure_budget_room(db, festival, festival.per_photo_point)
    except HTTPException:
        save_path.unlink(missing_ok=True)
        raise

    photo = TrashPhoto(
        user_id=user_id,
        festival_id=festival_id,
        image_url=f"/uploads/{file_name}",
        hash=new_hash,
        status=PHOTO_STATUS_PENDING,
        points=festival.per_photo_point,
        has_trash=yolo_result.get("has_trash") if isinstance(yolo_result, dict) else None,
        trash_count=yolo_result.get("trash_count") if isinstance(yolo_result, dict) else None,
        max_trash_confidence=yolo_result.get("max_trash_confidence") if isinstance(yolo_result, dict) else None,
        yolo_raw=yolo_result.get("raw_detections") if isinstance(yolo_result, dict) else None,
    )
    db.add(photo)
    summary.total_pending += festival.per_photo_point
    db.flush()
    db.refresh(photo)
    db.refresh(summary)

    # 잭팟 풀 업데이트 및 참가 등록
    jackpot_pool = (
        db.execute(select(JackpotPool).where(JackpotPool.festival_id == festival_id)).scalar_one_or_none()
    )
    if not jackpot_pool:
        jackpot_pool = JackpotPool(festival_id=festival_id)
        db.add(jackpot_pool)
        db.flush()

    contribution = int(festival.per_photo_point * jackpot_pool.contribution_rate)
    jackpot_pool.current_amount += contribution

    now_kst = datetime.now(KST)
    week_key = f"{now_kst.year}-W{now_kst.isocalendar()[1]:02d}"
    entry = (
        db.execute(
            select(JackpotEntry).where(
                JackpotEntry.user_id == user_id,
                JackpotEntry.festival_id == festival_id,
                JackpotEntry.week_key == week_key,
            )
        ).scalar_one_or_none()
    )
    if entry:
        entry.entry_count += 1
    else:
        db.add(
            JackpotEntry(
                user_id=user_id,
                festival_id=festival_id,
                week_key=week_key,
            )
        )
    db.flush()

    return {
        "photo": serialize_photo(photo),
        "summary": {
            "totalPending": summary.total_pending,
            "totalActive": summary.total_active,
            "totalConsumed": summary.total_consumed,
        },
        "message": f"+{festival.per_photo_point}원 지급 대기 상태로 적립되었어요.",
    }


@app.post("/api/festivals/{festival_id}/trash-bins/scan")
def scan_bin(
    festival_id: str,
    payload: dict,
    db: Session = Depends(get_db_dep),
    current_user_id: str = Depends(get_current_user_id),
):
    user_id = payload.get("userId") or current_user_id
    if user_id != current_user_id:
        http_error(403, "본인 계정으로만 인증할 수 있습니다.")
    bin_code = normalize_bin_code(payload.get("binCode"))
    lat = payload.get("lat")
    lng = payload.get("lng")
    if not user_id or not bin_code:
        http_error(400, "userId와 binCode가 필요합니다.")

    festival = db.get(Festival, festival_id)
    bin_obj = (
        db.execute(
            select(TrashBin).where(TrashBin.festival_id == festival_id, TrashBin.code == bin_code)
        )
        .scalars()
        .first()
    )
    user = db.get(User, user_id)
    if not festival:
        http_error(404, "축제를 찾을 수 없습니다.")
    if not bin_obj:
        http_error(404, "수거함을 찾을 수 없습니다.")
    if not user:
        http_error(404, "유저를 찾을 수 없습니다.")

    latitude = float(lat) if lat is not None else None
    longitude = float(lng) if lng is not None else None
    if not is_inside_festival(festival, latitude, longitude):
        http_error(400, "축제장 안에서만 참여할 수 있어요.")

    if get_budget_usage(db, festival_id) >= festival.budget:
        http_error(400, "오늘 리워드 예산이 모두 소진되었습니다.")

    summary = ensure_summary(db, user_id, festival_id)
    remaining_cap = max(0, festival.per_user_daily_cap - (summary.total_active + summary.total_consumed))
    if remaining_cap <= 0:
        http_error(400, "오늘 한도가 모두 사용되었습니다.")

    cutoff = datetime.utcnow() - timedelta(minutes=PENDING_ACTIVATION_MINUTES)
    pending_photos = (
        db.execute(
            select(TrashPhoto)
            .where(
                TrashPhoto.user_id == user_id,
                TrashPhoto.festival_id == festival_id,
                TrashPhoto.status == PHOTO_STATUS_PENDING,
                TrashPhoto.created_at >= cutoff,
            )
            .order_by(TrashPhoto.created_at.asc())
        )
        .scalars()
        .all()
    )
    if not pending_photos:
        http_error(400, "최근 30분 내 지급 대기 포인트가 없습니다.")

    activated = 0
    ids_to_activate = []
    for photo in pending_photos:
        if activated + photo.points > remaining_cap:
            break
        activated += photo.points
        ids_to_activate.append(photo.id)

    if not ids_to_activate:
        http_error(400, "오늘 한도를 모두 사용했습니다.")

    db.execute(
        TrashPhoto.__table__.update()
        .where(TrashPhoto.id.in_(ids_to_activate))
        .values(status=PHOTO_STATUS_ACTIVE)
    )
    summary.total_pending -= activated
    summary.total_active += activated
    db.add(BinScan(festival_id=festival_id, bin_id=bin_obj.id, user_id=user_id))
    db.flush()
    db.refresh(summary)

    return {
        "activated": activated,
        "convertedCount": len(ids_to_activate),
        "binName": bin_obj.name,
        "summary": {
            "totalPending": summary.total_pending,
            "totalActive": summary.total_active,
            "totalConsumed": summary.total_consumed,
            "cap": festival.per_user_daily_cap,
        },
    }


@app.get("/api/festivals/{festival_id}/shops")
def list_shops(festival_id: str):
    shops = [
        {"shopName": "OO 떡볶이", "amount": 2000, "description": "2,000원 이상 결제 시 2,000원 할인"},
        {"shopName": "OO 카페", "amount": 3000, "description": "아메리카노 포함 전체 3,000원 할인"},
        {"shopName": "OO 편의점", "amount": 1500, "description": "간식류 1,500원 할인"},
    ]
    return {"shops": shops}


@app.post("/api/festivals/{festival_id}/coupons")
def issue_coupon(
    festival_id: str,
    payload: dict,
    db: Session = Depends(get_db_dep),
    current_user_id: str = Depends(get_current_user_id),
):
    user_id = payload.get("userId") or current_user_id
    if user_id != current_user_id:
        http_error(403, "본인 계정으로만 쿠폰을 발급할 수 있습니다.")
    shop_name = payload.get("shopName")
    amount = payload.get("amount")
    amount_int = int(amount) if amount is not None else None
    if not user_id or not shop_name or amount_int is None:
        http_error(400, "요청 파라미터가 부족합니다.")

    festival = db.get(Festival, festival_id)
    if not festival:
        http_error(404, "축제를 찾을 수 없습니다.")

    ensure_summary(db, user_id, festival_id)
    summary = (
        db.execute(
            select(UserDailySummary).where(
                UserDailySummary.user_id == user_id,
                UserDailySummary.festival_id == festival_id,
                UserDailySummary.date == get_today(),
            )
        )
        .scalars()
        .first()
    )
    if not summary:
        http_error(400, "요약 정보를 찾을 수 없습니다.")
    if summary.total_active < amount_int:
        http_error(400, "사용 가능 포인트가 부족합니다.")

    ensure_budget_room(db, festival, amount_int)

    code = f"HDFEST-{amount_int}-{str(int(time.time_ns()))[-6:]}".upper()
    summary.total_active -= amount_int
    summary.total_consumed += amount_int
    coupon = Coupon(
        user_id=user_id,
        festival_id=festival_id,
        shop_name=shop_name,
        amount=amount_int,
        code=code,
        status=COUPON_STATUS_ISSUED,
    )
    db.add(coupon)
    db.flush()
    db.refresh(coupon)
    return {"coupon": serialize_coupon(coupon)}


@app.get("/api/users/{user_id}/coupons")
def list_coupons(
    user_id: str,
    festivalId: Optional[str] = None,
    db: Session = Depends(get_db_dep),
    current_user_id: str = Depends(get_current_user_id),
):
    if current_user_id != user_id:
        http_error(403, "본인 정보만 조회할 수 있습니다.")
    festival_id = festivalId or DEFAULT_FESTIVAL_ID
    if not festival_id:
        http_error(400, "festivalId가 필요합니다.")
    coupons = (
        db.execute(
            select(Coupon)
            .where(Coupon.user_id == user_id, Coupon.festival_id == festival_id)
            .order_by(Coupon.created_at.desc())
        )
        .scalars()
        .all()
    )
    return {"coupons": [serialize_coupon(c) for c in coupons]}


@app.post("/api/admin/login")
def admin_login(payload: dict):
    password = payload.get("password")
    if password != ADMIN_PASSWORD:
        http_error(401, "비밀번호가 올바르지 않습니다.")
    return {"token": ADMIN_TOKEN}


@app.post("/api/admin/festivals")
def create_festival(
    payload: dict, x_admin_token: Optional[str] = Header(None), db: Session = Depends(get_db_dep)
):
    require_admin(x_admin_token or payload.get("token"))
    name = payload.get("name")
    budget = payload.get("budget")
    per_user_daily_cap = payload.get("perUserDailyCap")
    per_photo_point = payload.get("perPhotoPoint")
    center_lat = float(payload.get("centerLat")) if payload.get("centerLat") is not None else None
    center_lng = float(payload.get("centerLng")) if payload.get("centerLng") is not None else None
    radius_meters = int(payload.get("radiusMeters")) if payload.get("radiusMeters") is not None else None
    if not name or budget is None or per_user_daily_cap is None or per_photo_point is None:
        http_error(400, "필수 필드가 누락되었습니다.")
    festival = Festival(
        name=name,
        budget=int(budget),
        per_user_daily_cap=int(per_user_daily_cap),
        per_photo_point=int(per_photo_point),
        center_lat=center_lat,
        center_lng=center_lng,
        radius_meters=radius_meters,
    )
    db.add(festival)
    db.flush()
    db.refresh(festival)
    return {"festival": serialize_festival(festival)}


@app.post("/api/admin/festivals/{festival_id}/trash-bins/generate")
def generate_bins(
    festival_id: str,
    payload: dict,
    x_admin_token: Optional[str] = Header(None),
    db: Session = Depends(get_db_dep),
):
    require_admin(x_admin_token or payload.get("token"))
    count = payload.get("count")
    parsed_count = int(count) if count is not None else None
    if not parsed_count or parsed_count <= 0:
        http_error(400, "생성할 수거함 수를 입력해 주세요.")
    festival = db.get(Festival, festival_id)
    if not festival:
        http_error(404, "축제를 찾을 수 없습니다.")
    existing = (
        db.execute(select(func.count(TrashBin.id)).where(TrashBin.festival_id == festival_id)).scalar_one()
    )
    bins = []
    for idx in range(parsed_count):
        seq = existing + idx + 1
        code = f"TRASH_BIN_{str(seq).zfill(2)}"
        bin_obj = TrashBin(
            festival_id=festival_id,
            code=code,
            name=f"공식 수거함 #{seq}",
            description="축제 운영팀 배치",
        )
        db.add(bin_obj)
        bins.append(bin_obj)
    db.flush()
    for bin_obj in bins:
        db.refresh(bin_obj)
    return {"bins": [serialize_bin(b) for b in bins]}


@app.get("/api/admin/festivals/{festival_id}/summary")
def admin_summary(
    festival_id: str, x_admin_token: Optional[str] = Header(None), db: Session = Depends(get_db_dep)
):
    require_admin(x_admin_token)
    festival = db.get(Festival, festival_id)
    if not festival:
        http_error(404, "축제를 찾을 수 없습니다.")

    photos_group = (
        db.execute(
            select(TrashPhoto.status, func.sum(TrashPhoto.points)).where(TrashPhoto.festival_id == festival_id).group_by(
                TrashPhoto.status
            )
        )
        .all()
    )
    bin_usage = (
        db.execute(
            select(BinScan.bin_id, func.count(BinScan.bin_id))
            .where(BinScan.festival_id == festival_id)
            .group_by(BinScan.bin_id)
        )
        .all()
    )
    distinct_users = (
        db.execute(
            select(func.count(func.distinct(TrashPhoto.user_id))).where(TrashPhoto.festival_id == festival_id)
        ).scalar_one()
    )

    bins = (
        db.execute(select(TrashBin).where(TrashBin.festival_id == festival_id)).scalars().all()
    )
    bin_lookup = {b.id: b for b in bins}

    total_pending = 0
    total_active = 0
    for status, total in photos_group:
        if status == PHOTO_STATUS_PENDING:
            total_pending = total or 0
        if status == PHOTO_STATUS_ACTIVE:
            total_active = total or 0

    usage = [
        {"binId": bin_id, "count": count, "code": bin_lookup.get(bin_id).code if bin_lookup.get(bin_id) else None}
        for bin_id, count in bin_usage
    ]

    return {
        "festival": serialize_festival(festival),
        "totalParticipants": int(distinct_users or 0),
        "totalPending": int(total_pending or 0),
        "totalActive": int(total_active or 0),
        "budgetUsed": get_budget_usage(db, festival_id),
        "budgetRemaining": max(0, festival.budget - get_budget_usage(db, festival_id)),
        "binUsage": usage,
    }


@app.get("/api/festivals/{festival_id}/jackpot")
def get_jackpot(festival_id: str, db: Session = Depends(get_db_dep)):
    pool = db.execute(select(JackpotPool).where(JackpotPool.festival_id == festival_id)).scalar_one_or_none()
    if not pool:
        return {"current_amount": 0, "last_winner_name": None}

    last_winner_name = None
    if pool.last_winner_id:
        winner = db.get(User, pool.last_winner_id)
        if winner:
            last_winner_name = winner.display_name

    return {
        "current_amount": pool.current_amount,
        "last_winner_name": last_winner_name,
        "last_draw_date": pool.last_draw_date,
    }


@app.post("/api/admin/festivals/{festival_id}/jackpot/draw")
def draw_jackpot(
    festival_id: str,
    x_admin_token: Optional[str] = Header(None),
    db: Session = Depends(get_db_dep),
):
    require_admin(x_admin_token)
    pool = db.execute(select(JackpotPool).where(JackpotPool.festival_id == festival_id)).scalar_one_or_none()
    if not pool:
        http_error(404, "잭팟 풀 없음")

    now_kst = datetime.now(KST)
    week_key = f"{now_kst.year}-W{now_kst.isocalendar()[1]:02d}"
    entries = (
        db.execute(
            select(JackpotEntry).where(
                JackpotEntry.festival_id == festival_id,
                JackpotEntry.week_key == week_key,
            )
        )
        .scalars()
        .all()
    )

    if not entries:
        http_error(400, "참가자 없음")

    users = [entry.user_id for entry in entries]
    weights = [entry.entry_count for entry in entries]
    winner_id = random.choices(users, weights=weights, k=1)[0]
    winner = db.get(User, winner_id)
    if not winner:
        http_error(404, "당첨자 정보를 찾을 수 없습니다.")

    today = now_kst.strftime("%Y-%m-%d")
    summary = (
        db.execute(
            select(UserDailySummary).where(
                UserDailySummary.user_id == winner_id,
                UserDailySummary.festival_id == festival_id,
                UserDailySummary.date == today,
            )
        ).scalar_one_or_none()
    )

    if not summary:
        summary = UserDailySummary(user_id=winner_id, festival_id=festival_id, date=today)
        db.add(summary)

    summary.total_active += pool.current_amount

    winner_record = JackpotWinner(
        user_id=winner_id,
        festival_id=festival_id,
        week_key=week_key,
        amount=pool.current_amount,
    )
    db.add(winner_record)

    awarded_amount = pool.current_amount
    pool.current_amount = pool.seed_amount
    pool.last_winner_id = winner_id
    pool.last_draw_date = today

    db.commit()

    return {
        "winner_name": winner.display_name,
        "amount": awarded_amount,
        "message": f"🎉 {winner.display_name}님 당첨! {awarded_amount:,}원",
    }
