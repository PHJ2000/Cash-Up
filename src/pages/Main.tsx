import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { JackpotBanner } from '../components/JackpotBanner';
import { Layout } from '../components/Layout';
import { useAppState } from '../state/AppStateContext';

export const MainPage = () => {
  const navigate = useNavigate();
  const { user, festival, summary } = useAppState();

  const todayUsed = (summary?.totalActive ?? 0) + (summary?.totalConsumed ?? 0);
  const cap = summary?.cap ?? festival?.perUserDailyCap ?? 3000;

  return (
    <Layout title={festival?.name ?? '캐시업'}>
      <div className="space-y-5">
        <JackpotBanner />
        <Card className="flex items-center justify-between">
          <div>
            <p className="text-sm text-beach-navy/70">{user?.displayName}님, 환영합니다</p>
            <p className="text-lg font-bold text-beach-navy">
              오늘 적립 가능 {todayUsed.toLocaleString()} / {cap.toLocaleString()}원
            </p>
          </div>
          <div className="rounded-xl bg-beach-sky/50 px-3 py-2 text-xs text-beach-navy">현장 참여 필수</div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button onClick={() => navigate('/upload')}>쓰레기 찍고 적립</Button>
          <Button variant="secondary" onClick={() => navigate('/scan')}>
            수거함 QR 찍기
          </Button>
          <Button variant="secondary" onClick={() => navigate('/wallet')}>
            내 지갑 / 쿠폰
          </Button>
          <Button variant="ghost" onClick={() => navigate('/bins')}>
            수거함 위치 보기
          </Button>
        </div>

        <Card className="space-y-3">
          <h2 className="text-lg font-semibold text-beach-navy">오늘 내 상태</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/80 p-3 shadow">
              <p className="text-xs text-beach-navy/60">PENDING</p>
              <p className="text-xl font-bold text-amber-600">{summary?.totalPending ?? 0}원</p>
            </div>
            <div className="rounded-xl bg-white/80 p-3 shadow">
              <p className="text-xs text-beach-navy/60">ACTIVE</p>
              <p className="text-xl font-bold text-emerald-600">{summary?.totalActive ?? 0}원</p>
            </div>
            <div className="rounded-xl bg-white/80 p-3 shadow">
              <p className="text-xs text-beach-navy/60">소진</p>
              <p className="text-xl font-bold text-beach-navy">{summary?.totalConsumed ?? 0}원</p>
            </div>
          </div>
        </Card>

        <Card className="space-y-2">
          <p className="text-sm font-semibold text-beach-navy">참여 방법</p>
          <ul className="space-y-1 text-sm text-beach-navy/80">
            <li>• 지금 화면에서 바로 촬영: 지급 대기 포인트 적립 (중복 사진/과거 사진 제한)</li>
            <li>• 수거함 QR 코드(숫자 입력 가능)를 찍으면 ACTIVE로 전환됩니다.</li>
            <li>• 위치 확인은 축제장 내부 참여 여부만 검증용으로 사용돼요.</li>
          </ul>
        </Card>
      </div>
    </Layout>
  );
};
