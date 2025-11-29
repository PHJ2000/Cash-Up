import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import requests
from PIL import Image

logger = logging.getLogger(__name__)

try:
    from ultralytics import YOLO
except Exception:  # ultralytics not installed or no weights available
    YOLO = None  # type: ignore


YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "best.pt")
YOLO_REMOTE_URL = os.getenv("YOLO_REMOTE_URL")
YOLO_REMOTE_API_KEY = os.getenv("YOLO_API_KEY")
YOLO_REMOTE_IMGSZ = os.getenv("YOLO_IMGSZ", "640")
YOLO_REMOTE_CONF = os.getenv("YOLO_CONF", "0.25")
YOLO_REMOTE_IOU = os.getenv("YOLO_IOU", "0.45")

TRASH_CANDIDATE_CLASSES = {"Glass", "Metal", "Paper", "Plastic", "Waste"}

_model: Optional[Any] = None


def _load_model():
    global _model
    if _model is None and YOLO is not None:
        try:
            _model = YOLO(YOLO_MODEL_PATH)
        except Exception as exc:
            logger.warning("YOLO 모델 로드 실패: %s", exc)
            _model = None
    return _model


def _remote_available() -> bool:
    return bool(YOLO_REMOTE_URL and YOLO_REMOTE_API_KEY)


def _normalize_bbox(det: Dict[str, Any]) -> Optional[Tuple[float, float, float, float]]:
    bbox: Optional[Union[List[Any], Tuple[Any, ...]]] = (
        det.get("bbox")
        or det.get("box")
        or det.get("xyxy")
        or det.get("xyxy_list")
        or det.get("xyxyTensor")
    )
    if bbox and len(bbox) >= 4:
        try:
            return float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
        except Exception:
            return None
    alt = det.get("xywh") or det.get("xywh_list")
    if alt and len(alt) >= 4:
        try:
            x, y, w, h = float(alt[0]), float(alt[1]), float(alt[2]), float(alt[3])
            return x - w / 2, y - h / 2, x + w / 2, y + h / 2
        except Exception:
            return None
    return None


def _parse_remote_detections(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    candidates = payload.get("detections") or payload.get("predictions") or payload.get("boxes") or []
    if isinstance(candidates, dict):
        candidates = candidates.get("data") or candidates.get("boxes") or []
    parsed: List[Dict[str, Any]] = []
    for det in candidates:
        bbox = _normalize_bbox(det)
        if not bbox:
            continue
        class_id = det.get("class_id") or det.get("class") or det.get("cls")
        class_name = (
            det.get("class_name")
            or det.get("name")
            or det.get("label")
            or (str(class_id) if class_id is not None else "trash")
        )
        conf = det.get("confidence") or det.get("conf") or det.get("score") or 0
        parsed.append(
            {
                "class_id": class_id if class_id is not None else None,
                "class_name": class_name,
                "confidence": float(conf),
                "bbox": list(bbox),
            }
        )
    return parsed


def _call_remote_api(image_path: str) -> Optional[Dict[str, Any]]:
    if not _remote_available():
        return None
    try:
        with open(image_path, "rb") as fp:
            files = {"file": fp}
            data = {"imgsz": YOLO_REMOTE_IMGSZ, "conf": YOLO_REMOTE_CONF, "iou": YOLO_REMOTE_IOU}
            headers = {"x-api-key": YOLO_REMOTE_API_KEY}
            resp = requests.post(YOLO_REMOTE_URL, headers=headers, data=data, files=files, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.error("원격 YOLO 호출 실패: %s", exc, exc_info=True)
        return None


def analyze_trash(image_path: str) -> Dict[str, Any]:
    """Run YOLO inference. Returns detection summary but never raises."""
    image_width: Optional[int] = None
    image_height: Optional[int] = None

    try:
        with Image.open(image_path) as img:
            image_width, image_height = img.size
    except Exception:
        image_width, image_height = None, None

    if not Path(image_path).exists():
        logger.info("YOLO 분석 스킵 (이미지 없음) image_exists=%s", Path(image_path).exists())
        return {
            "has_trash": None,
            "trash_count": None,
            "max_trash_confidence": None,
            "raw_detections": None,
            "image_width": image_width,
            "image_height": image_height,
        }
    import json
    import requests


    # 1) 원격 API 시도
    if _remote_available():
        # Run inference on an image
        url = "https://predict.ultralytics.com"
        headers = {"x-api-key": "8c6ef8baabfc5a302f5c33ab28c3fbe2c8a430dbcb"}
        data = {"model": "https://hub.ultralytics.com/models/sso6A8bzyGtyAtTTOMkd", "imgsz": 640, "conf": 0.25, "iou": 0.45}
        with open(image_path, "rb") as f:
            response = requests.post(url, headers=headers, data=data, files={"file": f})    

        response.raise_for_status()
        result = response.json()
        print(result)
        # --------------- 파싱 --------------- #
        raw = result["images"][0]
        width, height = raw["shape"][1], raw["shape"][0]

        detections = []
        trash_candidates = []

        for r in raw["results"]:
            cls_id = r["class"]
            cls_name = r["name"]
            conf = r["confidence"]
            box = r["box"]  # dict: x1,x2,y1,y2

            det = {
                "class_id": cls_id,
                "class_name": cls_name,
                "confidence": conf,
                "bbox": [box["x1"], box["y1"], box["x2"], box["y2"]],
            }
            detections.append(det)

            
            trash_candidates.append(det)

        has_trash = bool(trash_candidates)
        max_conf = max((d["confidence"] for d in trash_candidates), default=None)

        return {
            "has_trash": has_trash,
            "trash_count": len(trash_candidates),
            "max_trash_confidence": max_conf,
            "raw_detections": detections,
            "image_width": width,
            "image_height": height,
            "remote": True,
        }
        '''
        remote_payload = _call_remote_api(image_path)
        if remote_payload:
            detections = _parse_remote_detections(remote_payload)
            trash_candidates = [
                detections
            ]
            print('trash_candidates:', trash_candidates)
            print(detections)
            has_trash = bool(trash_candidates)
            max_conf = max((d.get("confidence", 0) for d in trash_candidates), default=None)
            return {
                "has_trash": has_trash,
                "trash_count": len(trash_candidates),
                "max_trash_confidence": max_conf,
                "raw_detections": detections,
                "image_width": image_width,
                "image_height": image_height,
                "remote": True,
            }
        logger.warning("원격 YOLO 호출 실패, 로컬 모델로 폴백 시도")
        '''

    # 2) 로컬 모델 폴백
    model = _load_model()
    if model is None:
        logger.info("YOLO 분석 스킵 (모델 없음)")
        return {
            "has_trash": None,
            "trash_count": None,
            "max_trash_confidence": None,
            "raw_detections": None,
            "image_width": image_width,
            "image_height": image_height,
        }

    try:
        results = model(image_path, verbose=False)
        detections: List[Dict[str, Any]] = []
        trash_candidates: List[Dict[str, Any]] = []
        for res in results:
            names = res.names
            for box in res.boxes:
                cls_id = int(box.cls[0])
                cls_name = names.get(cls_id, str(cls_id)) if names else str(cls_id)
                conf = float(box.conf[0])
                bbox = [float(x) for x in box.xyxy[0].tolist()]
                det = {
                    "class_id": cls_id,
                    "class_name": cls_name,
                    "confidence": conf,
                    "bbox": bbox,
                }
                detections.append(det)
                if cls_name in TRASH_CANDIDATE_CLASSES:
                    trash_candidates.append(det)

        has_trash = bool(trash_candidates)
        max_conf = max((d["confidence"] for d in trash_candidates), default=None)
        return {
            "has_trash": has_trash,
            "trash_count": len(trash_candidates),
            "max_trash_confidence": max_conf,
            "raw_detections": detections,
            "image_width": image_width,
            "image_height": image_height,
            "remote": False,
        }
    except Exception as exc:
        logger.error("YOLO 분석 실패: %s", exc, exc_info=True)
        return {
            "has_trash": None,
            "trash_count": None,
            "max_trash_confidence": None,
            "raw_detections": None,
            "image_width": image_width,
            "image_height": image_height,
        }
