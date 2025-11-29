import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Layout } from '../components/Layout';
import { useLocation } from '../hooks/useLocation';
import { useAppState } from '../state/AppStateContext';
import QrScanner from 'qr-scanner';
export const ScanPage = () => {
  const { user, festival, refreshSummary, bins } = useAppState();
  const { coords, loading: locationLoading, error: locationError, locationText } = useLocation();
  const [binCode, setBinCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const startingRef = useRef(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scanningActive, setScanningActive] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !festival || !binCode.trim()) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.scanBin({
        userId: user.id,
        festivalId: festival.id,
        binCode: binCode.trim(),
        lat: coords?.lat,
        lng: coords?.lng
      });
      setMessage(`공식 수거함 인증 완료! 지급 대기 ${res.activated}원 → 사용 가능 ${res.activated}원으로 전환되었습니다.`);
      await refreshSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : '인증에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const startScanner = async () => {
    if (!videoRef.current) return;
    if (!window.isSecureContext) {
      setScannerError('https 또는 localhost 환경에서만 카메라 접근이 가능합니다.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerError('브라우저가 카메라를 지원하지 않아요.');
      return;
    }
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setScannerError(null);
    try {
      if (!scannerRef.current) {
        scannerRef.current = new QrScanner(
          videoRef.current as HTMLVideoElement,
          (result) => {
            if (!result?.data) return;
            setBinCode(result.data);
            setLastScanned(result.data);
            setScannerError(null);
            scannerRef.current?.pause();
            setTimeout(() => {
              scannerRef.current
                ?.start()
                .then(() => setScanningActive(true))
                .catch(() => {});
            }, 400);
          },
          {
            highlightScanRegion: true,
            highlightCodeOutline: true,
            returnDetailedScanResult: true,
            preferredCamera: 'environment'
          }
        );
      }
      await scannerRef.current.start();
      setScanningActive(true);
      setScannerError(null);
    } catch (err: any) {
      const message =
        err?.message?.toLowerCase().includes('https') || err?.name === 'NotAllowedError'
          ? '카메라 권한을 허용하거나 https/localhost로 접속해주세요.'
          : '카메라 접근을 허용해주세요.';
      setScannerError(message);
      setScanningActive(false);
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  useEffect(() => {
    startScanner();
    return () => {
      startingRef.current = false;
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
  }, []);

  return (
    <Layout title="QR / 코드 인증" showBack>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Card className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-beach-navy/70">QR 코드에 적힌 번호를 입력하거나 카메라로 스캔해 주세요.</p>
            <p className="text-xs text-beach-navy/60">
              공식 수거함 위치: {bins.length ? `${bins[0].name} 등 ${bins.length}곳` : '등록된 수거함이 없습니다.'}
            </p>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-beach-sky bg-beach-navy/5">
            <div className="aspect-video w-full">
              <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
            </div>
            {scannerError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/65 px-4 text-center text-sm text-white">
                <p>{scannerError}</p>
                <p className="mt-1 text-xs text-white/80">수동 입력으로 진행해 주세요.</p>
              </div>
            )}
            {!scannerError && !scanningActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-sm text-white">
                <p>{starting ? '카메라 연결 중입니다...' : '카메라를 불러오고 있어요.'}</p>
                {!starting && (
                  <button
                    type="button"
                    className="mt-2 rounded-lg bg-white/90 px-3 py-1 text-[12px] font-semibold text-beach-navy"
                    onClick={startScanner}
                  >
                    다시 시도
                  </button>
                )}
              </div>
            )}
            {!scannerError && scanningActive && (
              <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-3 text-[11px] text-white/90">
                <p>카메라를 QR 코드에 가까이 대고, 자동 인식을 기다려주세요.</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-beach-navy/60">
            <span>{scanningActive ? '카메라 준비 완료' : '카메라 연결 중...'}</span>
            {lastScanned && <span className="truncate text-right text-beach-sea">최근 인식: {lastScanned}</span>}
          </div>
          <input
            className="w-full rounded-xl border border-beach-sky bg-white/80 px-4 py-3 text-beach-navy shadow-sm focus:border-beach-sea focus:outline-none"
            placeholder="예: TRASH_BIN_01"
            value={binCode}
            onChange={(e) => setBinCode(e.target.value)}
          />
          {locationError && <p className="text-xs text-rose-600">{locationError}</p>}
          <p className="text-xs text-beach-navy/60">{locationLoading ? '위치 확인 중...' : locationText}</p>
          <p className="text-xs text-beach-navy/60">축제장 내부에서만 인증 가능합니다. 가까운 수거함까지 이동 후 시도해주세요.</p>
        </Card>
        <Button type="submit" disabled={!binCode.trim() || loading}>
          {loading ? '인증 중...' : '포인트 활성화'}
        </Button>
        {message && (
          <Card className="border border-emerald-200 bg-emerald-50 text-emerald-800">
            <p className="text-sm font-semibold">{message}</p>
          </Card>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </form>
    </Layout>
  );
};
