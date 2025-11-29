# 쓰레기 인식용 카메라 코드 정리

## 개요
- 카메라는 두 화면에서 쓰입니다: 쓰레기 사진을 찍어 YOLO로 판별하는 `src/pages/MissionUpload.tsx`, 수거함 QR/코드를 읽는 `src/pages/Scan.tsx`.
- 공통 요구: `https`/`localhost` 보안 컨텍스트, `navigator.mediaDevices.getUserMedia` 지원, 환경 광각 카메라(`facingMode: 'environment'`) 우선.

## 쓰레기 촬영·업로드 (`src/pages/MissionUpload.tsx`)
- 카메라 확보: `useEffect`에서 `getUserMedia({ video: { facingMode: 'environment' } })` 요청 → `videoRef`에 스트림을 붙여 `play()` 실행. `cameraLoading`, `cameraReady`, `cameraError`로 상태를 나누고, 언마운트 시 `streamRef`의 모든 트랙을 `stop()`해서 리소스를 해제.
- 캡처·업로드 흐름: `handleCapture` → `captureSnapshot`이 `<video>` 프레임을 `<canvas>`로 그린 뒤 `toBlob`으로 `File`을 생성 → `uploadFile`이 `api.uploadPhoto`에 `userId`, `festivalId`, `lat/lng`와 함께 업로드. 업로드 전 상태를 초기화하고, 성공 시 미리보기(`preview`)와 서버 응답 메시지 표시.
- YOLO 결과 표시: 응답의 `photo.yoloRaw`를 `normalizeDetections`로 표준화(클래스명/신뢰도/박스 좌표) 후, `imageWidth/Height` 기준으로 퍼센트 좌표를 계산해 미리보기 이미지 위에 바운딩 박스를 그립니다. `trashCount`, `maxTrashConfidence`도 함께 노출.
- UI/에러 처리: `cameraLoading` 시 덮개 메시지, `cameraError` 시 갤러리 업로드 유도. 실시간 촬영이 불가능할 때를 대비해 `accept="image/*" capture="environment"` 입력을 제공해 기기 기본 카메라/갤러리로 대체.

## 수거함 QR 스캔 (`src/pages/Scan.tsx`)
- 초기화: `startScanner`에서 보안 컨텍스트와 `getUserMedia` 지원 여부를 확인 후 `QrScanner` 인스턴스를 생성. `highlightScanRegion`, `highlightCodeOutline`, `preferredCamera: 'environment'` 옵션으로 스캔 영역을 표시.
- 스캔 동작: 인식 콜백에서 `binCode`/`lastScanned`를 갱신하고 일시 `pause()` 후 400ms 뒤 `start()` 재개해 중복 스캔을 방지. 상태 값 `scanningActive`, `scannerError`, `starting`으로 UI 오버레이를 제어.
- 정리: 언마운트 시 `scannerRef.current.stop()`과 `destroy()`로 카메라 스트림과 워커를 정리. 권한 거부나 `https` 미지원 시 에러 메시지를 띄우고 수동 입력을 안내.

## 변경 시 주의 사항
- `getUserMedia`는 사용자 제스처 없이 거부될 수 있으므로, 권한 실패 시 graceful fallback(파일 업로드, 재시도 버튼)을 유지하거나 개선합니다.
- 해상도나 비율을 바꾸면 `captureSnapshot`의 캔버스 크기 계산과 YOLO 박스 정규화 로직(`imageWidth/Height` 기준 퍼센트 변환)을 함께 확인합니다.
- 카메라 리소스를 점유하므로 새로운 카메라 기능을 추가할 때는 기존 `stop()` 호출과 충돌하지 않도록 언마운트 정리를 보장합니다.
