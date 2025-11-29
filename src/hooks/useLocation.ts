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
      },
      () => {
        setError('위치 정보를 불러오지 못했어요.');
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const locationText = coords ? `현재 위치: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : '위치 확인 필요';

  return { coords, loading, error, locationText };
};
