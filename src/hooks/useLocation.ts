import { useEffect, useState } from 'react';

type Coords = { lat: number; lng: number };

export const useLocation = () => {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('이 기기에서는 위치 정보를 사용할 수 없어요.');
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLoading(false);
        setError(null);
      },
      (err) => {
        const errorMsg =
          err.code === err.PERMISSION_DENIED
            ? 'HTTP 환경에서는 위치 권한이 차단됩니다. HTTPS로 접속하거나 위치 없이 촬영하세요.'
            : err.code === err.TIMEOUT
            ? '위치 정보 요청 시간이 초과되었습니다. 위치 없이 촬영하세요.'
            : '위치 정보를 불러올 수 없습니다. 위치 없이 촬영하세요.';
        setError(errorMsg);
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const locationText = coords ? `현재 위치: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : '위치 확인 필요';

  return { coords, loading, error, locationText };
};
