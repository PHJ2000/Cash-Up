from pathlib import Path

import pytest

from app.main import compute_image_hash, normalize_bin_code, parse_hash
from app.yolo_utils import analyze_trash
from PIL import Image


def test_normalize_bin_code_variants():
    cases = {
        "trash_bin_01": "TRASH_BIN_01",
        "trash-bin-02": "TRASH_BIN_02",
        "TRASHBIN03": "TRASH_BIN_03",
        "03": "TRASH_BIN_03",
        " trash bin 4 ": "TRASH_BIN_04",
        "TRASH_BIN_10": "TRASH_BIN_10",
    }
    for raw, expected in cases.items():
        assert normalize_bin_code(raw) == expected


def test_compute_image_hash(tmp_path: Path):
    img_path = tmp_path / "white.png"
    Image.new("RGB", (8, 8), "white").save(img_path)
    hash_str = compute_image_hash(img_path)
    assert isinstance(hash_str, str)
    assert len(hash_str) == 16
    # Ensure parse_hash recovers an ImageHash
    hash_obj = parse_hash(hash_str)
    assert hash_obj is not None
    assert str(hash_obj) == hash_str


def test_parse_hash_binary_string():
    # 64 bit binary of alternating pattern
    binary = "01" * 32
    hash_obj = parse_hash(binary)
    assert hash_obj is not None
    assert str(hash_obj) == binary


def test_analyze_trash_without_model(tmp_path: Path, monkeypatch):
    img_path = tmp_path / "dummy.jpg"
    Image.new("RGB", (4, 4), "gray").save(img_path)

    monkeypatch.setattr("app.yolo_utils.YOLO", None)
    monkeypatch.setattr("app.yolo_utils._model", None)
    monkeypatch.setattr("app.yolo_utils.YOLO_REMOTE_URL", None)
    monkeypatch.setattr("app.yolo_utils.YOLO_REMOTE_API_KEY", None)

    result = analyze_trash(str(img_path))
    assert result["has_trash"] is None
    assert result["trash_count"] is None
    assert result["max_trash_confidence"] is None
    assert result["raw_detections"] is None
