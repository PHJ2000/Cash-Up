import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, resolveImageUrl } from '../api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Layout } from '../components/Layout';
import { useLocation } from '../hooks/useLocation';
import { useAppState } from '../state/AppStateContext';
import { TrashPhoto } from '../types';

type NormalizedDetection = {
  className: string;
  confidence: number;
  bbox: [number, number, number, number];
};

type NormalizedDetectionSet = {
  detections: NormalizedDetection[];
  imageWidth: number | null;
  imageHeight: number | null;
};

const normalizeDetections = (raw: TrashPhoto['yoloRaw']): NormalizedDetectionSet | null => {
  if (!raw) return null;
  const rawObj = Array.isArray(raw) ? { detections: raw } : raw;
  const detections = rawObj.detections ?? rawObj.raw_detections ?? [];
  const parsed = detections
    .map((det) => {
      const bbox = det.bbox ?? [];
      if (!bbox || bbox.length !== 4) return null;
      return {
        className: det.className ?? (det as any).class_name ?? 'trash',
        confidence: det.confidence ?? 0,
        bbox: [bbox[0], bbox[1], bbox[2], bbox[3]] as [number, number, number, number],
      };
    })
    .filter(Boolean) as NormalizedDetection[];
  const width = rawObj.image_width ?? rawObj.imageWidth;
  const height = rawObj.image_height ?? rawObj.imageHeight;
  if (!parsed.length) return null;
  return {
    detections: parsed,
    imageWidth: typeof width === 'number' ? width : null,
    imageHeight: typeof height === 'number' ? height : null,
  };
};

export const MissionUploadPage = () => {
  const navigate = useNavigate();
  const { user, festival, refreshSummary } = useAppState();
  const { coords, loading: locationLoading, error: locationError, locationText } = useLocation();
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [simpleCaptureMode, setSimpleCaptureMode] = useState(false);
  const [everReady, setEverReady] = useState(false);
  const [trashCount, setTrashCount] = useState<number | null>(null);
  const [maxConfidence, setMaxConfidence] = useState<number | null>(null);
  const [normalizedDetections, setNormalizedDetections] = useState<NormalizedDetectionSet | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!window.isSecureContext) {
      setCameraError('https 또는 localhost 환경에서만 카메라를 사용할 수 있습니다.');
      setCameraLoading(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('브라우저가 카메라를 지원하지 않아요.');
      setCameraLoading(false);
      return;
    }

    const enableCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (mounted) {
          setCameraReady(true);
          setCameraLoading(false);
          setCameraError(null);
        }
      } catch (err) {
        if (!mounted) return;
        setCameraError('카메라 접근이 어렵습니다. 권한을 확인해주세요.');
        setCameraLoading(false);
        setCameraReady(false);
      }
    };

    enableCamera();

    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!user || !festival) return;
      setPreview(URL.createObjectURL(file));
      setTrashCount(null);
      setMaxConfidence(null);
      setNormalizedDetections(null);
      setImageSize(null);
      setMessage(null);
      setError(null);
      setUploading(true);
      try {
        const res = await api.uploadPhoto({
          userId: user.id,
          festivalId: festival.id,
          file,
          lat: coords?.lat,
          lng: coords?.lng
        });
        const photo = res.photo;
        setMessage(res.message);
        setPreview(resolveImageUrl(photo.imageUrl));
        setTrashCount(photo.trashCount ?? null);
        setMaxConfidence(photo.maxTrashConfidence ?? null);
        const parsed = normalizeDetections(photo.yoloRaw);
        setNormalizedDetections(parsed);
        if (parsed?.imageWidth && parsed?.imageHeight) {
          setImageSize({ width: parsed.imageWidth, height: parsed.imageHeight });
        }
        await refreshSummary();
      } catch (err) {
        setError(err instanceof Error ? err.message : '업로드 중 문제가 발생했어요.');
      } finally {
        setUploading(false);
      }
    },
    [coords?.lat, coords?.lng, festival, refreshSummary, user]
  );

  const captureSnapshot = async (): Promise<File | null> => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    const width = video.videoWidth || video.clientWidth || 1280;
    const height = video.videoHeight || video.clientHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          resolve(new File([blob], `trash-${Date.now()}.jpg`, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.92
      );
    });
  };

  const handleCapture = async () => {
    if (!cameraReady || !videoRef.current) {
      setError('카메라가 준비되지 않았어요.');
      return;
    }
    setError(null);
    const snapshot = await captureSnapshot();
    if (!snapshot) {
      setError('사진을 저장할 수 없습니다. 다시 시도해 주세요.');
      return;
    }
    await uploadFile(snapshot);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await uploadFile(file);
  };

  return (
    <Layout title="쓰레기 촬영" showBack>
      <div className="space-y-4">
        <Card className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-beach-navy/70">
              실시간 카메라로 쓰레기를 촬영하고 업로드해 주세요. 갤러리/인터넷 사진 재업로드는 허용되지 않습니다.
            </p>
            <div className="relative overflow-hidden rounded-2xl border border-beach-sky bg-beach-navy/5">
              <div className="aspect-[4/3] w-full">
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  playsInline
                  muted
                  autoPlay
                ></video>
              </div>
              {cameraLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 text-sm text-white">
                  카메라 연결 중입니다...
                </div>
              )}
              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 px-4 text-center text-sm text-white">
                  <p>{cameraError}</p>
                  <p className="mt-1 text-xs text-white/70">갤러리 업로드로 대체하세요.</p>
                </div>
              )}
              {!cameraLoading && !cameraError && (
                <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-3 text-[11px] text-white/90">
                  <p>화면을 정렬한 뒤 '실시간 촬영'을 눌러주세요.</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleCapture}
              disabled={!cameraReady || uploading}
              className="flex-1 rounded-2xl border border-transparent bg-gradient-to-r from-beach-sea via-beach-mint to-beach-sky px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-[1.05] disabled:brightness-[0.7] disabled:cursor-not-allowed"
            >
              {uploading ? '촬영 중...' : '실시간 촬영'}
            </button>
            <label className="flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-beach-sky bg-white/70 px-4 py-3 text-center text-sm text-beach-navy shadow-sm active:scale-[0.99]">
              <span className="text-sm font-semibold">갤러리에서 선택</span>
              <span className="text-xs text-beach-navy/60">단일 사진만 업로드 가능</span>
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
          <p className="text-xs text-beach-navy/60">같은 사진을 반복 업로드하거나 연속 촬영은 제한될 수 있어요.</p>
        </Card>
        {locationError && <p className="text-xs text-rose-600">{locationError}</p>}
        <p className="text-xs text-beach-navy/60">{locationLoading ? '위치 확인 중...' : locationText}</p>

        {preview && (
          <Card className="space-y-2">
            <p className="text-sm text-beach-navy/70">업로드 미리보기</p>
            <div className="relative">
              <img
                src={preview}
                alt="preview"
                className="w-full rounded-xl object-cover shadow"
                onLoad={(e) => {
                  const { naturalWidth, naturalHeight } = e.currentTarget;
                  if (naturalWidth && naturalHeight) {
                    setImageSize({ width: naturalWidth, height: naturalHeight });
                  }
                }}
              />
              {normalizedDetections && imageSize && (
                <div className="pointer-events-none absolute inset-0">
                  {normalizedDetections.detections.map((det, idx) => {
                    const baseWidth = normalizedDetections.imageWidth || imageSize.width;
                    const baseHeight = normalizedDetections.imageHeight || imageSize.height;
                    if (!baseWidth || !baseHeight) return null;
                    const [x1, y1, x2, y2] = det.bbox;
                    const left = (x1 / baseWidth) * 100;
                    const top = (y1 / baseHeight) * 100;
                    const width = ((x2 - x1) / baseWidth) * 100;
                    const height = ((y2 - y1) / baseHeight) * 100;
                    return (
                      <div
                        key={`${det.className}-${idx}`}
                        className="absolute rounded-lg border-2 border-emerald-400/90 bg-emerald-400/10 text-[10px] font-semibold text-white shadow-lg"
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                          width: `${width}%`,
                          height: `${height}%`,
                          backdropFilter: 'blur(1px)',
                        }}
                      >
                        <div className="absolute left-0 top-0 m-0.5 rounded bg-emerald-500/90 px-1 py-[1px]">
                          {det.className} {(det.confidence * 100).toFixed(0)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="text-xs text-beach-navy/70">
              감지된 쓰레기: {trashCount ?? '—'}개{' '}
              {typeof maxConfidence === 'number' && (
                <span className="text-[11px] text-beach-navy/60">(최대 신뢰도 {(maxConfidence * 100).toFixed(0)}%)</span>
              )}
            </div>
          </Card>
        )}

        {message && (
          <Card className="space-y-2 border border-emerald-200 bg-emerald-50">
            <p className="text-sm font-semibold text-emerald-700">{message}</p>
            <Button onClick={() => navigate('/scan')}>수거함 찾아가기</Button>
          </Card>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate('/home')}>
            홈으로
          </Button>
          <Button variant="ghost" onClick={() => navigate('/scan')}>
            수거함 찾기
          </Button>
        </div>
        {uploading && <p className="text-sm text-beach-navy/70">업로드 중입니다...</p>}
      </div>
    </Layout>
  );
};
