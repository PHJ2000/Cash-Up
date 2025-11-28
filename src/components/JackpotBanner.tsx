import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!festival) return;

    fetch(`/api/festivals/${festival.id}/jackpot`)
      .then((res) => res.json())
      .then((data) => setJackpot(data))
      .catch(() => {});
  }, [festival]);

  return (
    <Card className="bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-600 text-white">
      <div className="flex items-center justify-between">
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
