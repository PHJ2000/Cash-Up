import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Layout } from '../components/Layout';
import { useLocation } from '../hooks/useLocation';
import { useAppState } from '../state/AppStateContext';

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
  const startingRef = useRef(false);
  const fallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileCaptureRef = useRef<HTMLInputElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [simpleCaptureMode, setSimpleCaptureMode] = useState(false);
  const [everReady, setEverReady] = useState(false);
  const cameraReadyRef = useRef(false);
  const cameraErrorRef = useRef<string | null>(null);

  const hasLiveStream = useCallback(
    () => streamRef.current?.getTracks().some((track) => track.readyState === 'live') ?? false,
    []
  );

  const startCamera = useCallback(async () => {
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
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
    if (hasLiveStream() && !cameraErrorRef.current) {
      setCameraReady(true);
      setCameraLoading(false);
      setCameraError(null);
      setSimpleCaptureMode(false);
      setEverReady(true);
      return;
    }
    if (startingRef.current) return;
    startingRef.current = true;
    setCameraReady(false);
    setCameraLoading(true);
    setCameraError(null);
    try {
      setSimpleCaptureMode(false);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      const [track] = stream.getVideoTracks();
      if (track) {
        track.onended = () => {
          setCameraReady(false);
          setCameraLoading(false);
        };
      }
      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        const markReady = () => {
          setCameraReady(true);
          setCameraLoading(false);
          setCameraError(null);
          setSimpleCaptureMode(false);
          setEverReady(true);
          if (fallbackTimeoutRef.current) {
            clearTimeout(fallbackTimeoutRef.current);
            fallbackTimeoutRef.current = null;
          }
        };
        video.onloadedmetadata = () => {
          markReady();
          void video.play().catch(() => {});
        };
        video.onloadeddata = markReady;
        video.onerror = () => {
          setCameraReady(false);
          setCameraLoading(false);
          setCameraError('카메라 미리보기를 불러오지 못했어요.');
        };
        const playPromise = video.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise.catch(() => {
            /* autoplay restrictions */
          });
        }
        if (fallbackTimeoutRef.current) {
          clearTimeout(fallbackTimeoutRef.current);
          fallbackTimeoutRef.current = null;
        }
        fallbackTimeoutRef.current = setTimeout(() => {
          if (!cameraReadyRef.current) {
            setSimpleCaptureMode(true);
            setCameraLoading(false);
            setCameraError(null);
          }
        }, 4000);
      }
    } catch (err) {
      setCameraError('카메라 접근이 어렵습니다. 권한을 확인해주세요.');
      setCameraLoading(false);
      setCameraReady(false);
      setSimpleCaptureMode(true);
    } finally {
      startingRef.current = false;
    }
  }, [hasLiveStream]);

  useEffect(() => {
    startCamera();
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        (!hasLiveStream() || cameraErrorRef.current) &&
        !startingRef.current
      ) {
        startCamera();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      startingRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [hasLiveStream, startCamera]);

  useEffect(() => {
    cameraReadyRef.current = cameraReady;
  }, [cameraReady]);

  useEffect(() => {
    cameraErrorRef.current = cameraError;
  }, [cameraError]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!user || !festival) return;
      setPreview(URL.createObjectURL(file));
      setMessage(null);
      setError(null);
      setUploading(true);
      try {
        const res = await api.uploadPhoto({
          userId: user.id,
          festivalId: festival.id,
          file,
          lat: coords?.lat,
          lng: coords?.lng,
          fallbackLat: festival.centerLat ?? undefined,
          fallbackLng: festival.centerLng ?? undefined
        });
        setMessage(res.message);
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
    if (simpleCaptureMode) {
      fileCaptureRef.current?.click();
      return;
    }
    if (!cameraReady || !videoRef.current) {
      setError('카메라가 준비되지 않았어요. 다시 시도 또는 갤러리에서 선택을 이용해주세요.');
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
            <div className="relative overflow-hidden rounded-2xl border border-beach-sky bg-black">
              <div className="relative aspect-[4/3] w-full text-white">
                {!simpleCaptureMode && (
                  <>
                    <video
                      ref={videoRef}
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                      playsInline
                      muted
                      autoPlay
                    ></video>
                    {(cameraLoading || !everReady) && !cameraError && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 px-6 text-center text-sm">
                        <p>카메라 연결 중입니다...</p>
                        <button
                          type="button"
                          onClick={startCamera}
                          className="rounded-xl bg-white/90 px-4 py-2 text-xs font-semibold text-beach-navy"
                        >
                          다시 시도
                        </button>
                      </div>
                    )}
                    {cameraError && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 px-4 text-center text-sm text-white">
                        <p>{cameraError}</p>
                        <p className="mt-1 text-xs text-white/70">갤러리 업로드로 대체하거나 권한을 허용해주세요.</p>
                      </div>
                    )}
                    {everReady && !cameraError && !cameraLoading && (
                      <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-3 text-[11px] text-white/90 bg-gradient-to-t from-black/50 via-black/20 to-transparent">
                        <p>프레임을 맞춘 뒤 '실시간 촬영'을 눌러주세요.</p>
                      </div>
                    )}
                  </>
                )}
                {simpleCaptureMode && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black text-center text-sm text-white">
                    <p className="text-base font-semibold">실시간 미리보기 없이 촬영</p>
                    <p className="text-xs text-white/70">
                      일부 기기에서 미리보기가 차단되었습니다. 촬영 버튼을 누르면 기본 카메라 UI가 열려 사진이 업로드됩니다.
                    </p>
                    <button
                      type="button"
                      onClick={() => fileCaptureRef.current?.click()}
                      className="rounded-xl bg-white/90 px-4 py-2 text-xs font-semibold text-beach-navy"
                    >
                      카메라 열기
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleCapture}
              disabled={uploading || (!cameraReady && !simpleCaptureMode)}
              className="flex-1 rounded-2xl border border-transparent bg-gradient-to-r from-beach-sea via-beach-mint to-beach-sky px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-[1.05] disabled:brightness-[0.7] disabled:cursor-not-allowed"
            >
              {uploading ? '촬영 중...' : '실시간 촬영'}
            </button>
            <label className="flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-beach-sky bg-white/70 px-4 py-3 text-center text-sm text-beach-navy shadow-sm active:scale-[0.99]">
              <span className="text-sm font-semibold">갤러리에서 선택</span>
              <span className="text-xs text-beach-navy/60">단일 사진만 업로드 가능</span>
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
              <input
                ref={fileCaptureRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>
          <p className="text-xs text-beach-navy/60">같은 사진을 반복 업로드하거나 연속 촬영은 제한될 수 있어요.</p>
        </Card>
        {locationError && (
          <Card className="border border-amber-200 bg-amber-50">
            <p className="text-xs text-amber-800">{locationError}</p>
            <p className="text-xs text-amber-700 mt-1">위치 정보가 없어도 촬영은 가능합니다.</p>
          </Card>
        )}
        {!locationError && (
          <p className="text-xs text-beach-navy/60">{locationLoading ? '위치 확인 중...' : locationText}</p>
        )}

        {preview && (
          <Card className="space-y-2">
            <p className="text-sm text-beach-navy/70">업로드 미리보기</p>
            <img src={preview} alt="preview" className="w-full rounded-xl object-cover shadow" />
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
