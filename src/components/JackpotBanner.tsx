import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAppState } from '../state/AppStateContext';
import { Card } from './Card';

type JackpotState = {
  current_amount: number;
  last_winner_name: string | null;
  last_draw_date?: string | null;
};

export const JackpotBanner = () => {
  const { festival } = useAppState();
  const [jackpot, setJackpot] = useState<JackpotState>({
    current_amount: 0,
    last_winner_name: null,
    last_draw_date: null,
  });
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    if (!festival) return;

    api
      .getJackpot(festival.id)
      .then((data) => setJackpot(data))
      .catch((err) => {
        console.error('Failed to load jackpot', err);
        setJackpot((prev) => ({ ...prev, current_amount: 0, last_winner_name: null }));
      });
  }, [festival]);

  useEffect(() => {
    if (!jackpot.last_draw_date) return;
    // 새로운 추첨이 감지되면 짧게 하이라이트
    setCelebrate(true);
    const timer = setTimeout(() => setCelebrate(false), 4000);
    return () => clearTimeout(timer);
  }, [jackpot.last_draw_date]);

  return (
    <Card
      className={`relative overflow-hidden bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-600 text-white ${
        celebrate ? 'ring-4 ring-white/70 shadow-xl animate-pulse' : ''
      }`}
    >
      {celebrate && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10 text-lg font-bold drop-shadow">
          🎉 잭팟 당첨!
        </div>
      )}
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-sm opacity-90">🎰 이번 주 잭팟</p>
          <p className="text-3xl font-bold">{jackpot.current_amount.toLocaleString()}원</p>
          {jackpot.last_winner_name && (
            <p className="mt-1 text-xs opacity-75">최근: {jackpot.last_winner_name}</p>
          )}
        </div>
        <div className="text-right text-xs">
          <p className="opacity-90">매주 일요일</p>
          <p className="opacity-75">쓰레기 줍고 당첨!</p>
        </div>
      </div>
    </Card>
  );
};
