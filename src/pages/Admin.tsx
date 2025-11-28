import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Layout } from '../components/Layout';
import { useAppState } from '../state/AppStateContext';
import { AdminSession, Festival } from '../types';

type AdminSummary = {
  festival: Festival;
  totalParticipants: number;
  totalPending: number;
  totalActive: number;
  budgetUsed: number;
  budgetRemaining: number;
  binUsage: { binId: string; code?: string; count: number }[];
};

const loadAdminSession = (): AdminSession | null => {
  const raw = localStorage.getItem('cashup_admin_session');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AdminSession;
      if (parsed?.adminId && parsed?.token) return parsed;
    } catch (err) {
      console.error(err);
    }
  }
  const legacyToken = localStorage.getItem('cashup_admin_token');
  return legacyToken ? { adminId: 'legacy-admin', token: legacyToken } : null;
};

export const AdminPage = () => {
  const { festival } = useAppState();
  const [adminSession, setAdminSession] = useState<AdminSession | null>(() => loadAdminSession());
  const [adminId, setAdminId] = useState(adminSession?.adminId ?? '');
  const [newFestival, setNewFestival] = useState({
    name: '',
    budget: 5000000,
    perUserDailyCap: 3000,
    perPhotoPoint: 100,
    centerLat: 35.1587,
    centerLng: 129.1604,
    radiusMeters: 1200
  });
  const [binCount, setBinCount] = useState(3);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (adminSession?.token && festival) {
      loadSummary(festival.id, adminSession.token);
    }
  }, [festival?.id, adminSession?.token]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!adminId.trim()) {
      setError('관리자 ID를 입력해 주세요.');
      return;
    }
    try {
      const session = await api.adminLogin(adminId.trim());
      setAdminSession(session);
      localStorage.setItem('cashup_admin_session', JSON.stringify(session));
      localStorage.removeItem('cashup_admin_token');
      setMessage('관리자 로그인 완료');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인 실패');
    }
  };

  const handleLogout = () => {
    setAdminSession(null);
    setSummary(null);
    localStorage.removeItem('cashup_admin_session');
    localStorage.removeItem('cashup_admin_token');
    setMessage('관리자에서 로그아웃했어요.');
    setError(null);
  };

  const handleCreateFestival = async (e: FormEvent) => {
    e.preventDefault();
    if (!adminSession) {
      setError('관리자 로그인이 필요합니다.');
      return;
    }
    try {
      const res = await api.adminCreateFestival(newFestival, adminSession.token);
      setMessage(`축제 생성: ${res.festival.name} (${res.festival.id})`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '축제 생성 실패');
    }
  };

  const handleGenerateBins = async (e: FormEvent) => {
    e.preventDefault();
    if (!adminSession || !festival) {
      setError('관리자 로그인이 필요합니다.');
      return;
    }
    try {
      const res = await api.adminGenerateBins(festival.id, binCount, adminSession.token);
      setMessage(`${res.bins.length}개의 수거함 코드 생성 완료`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '수거함 생성 실패');
    }
  };

  const loadSummary = async (festivalId: string, adminToken: string) => {
    try {
      const res = await api.adminSummary(festivalId, adminToken);
      setSummary(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '요약 조회 실패');
    }
  };

  return (
    <Layout title="관리자" showBack>
      <div className="space-y-4">
        <Card className="space-y-2">
          <p className="text-sm font-semibold text-beach-navy">관리자 로그인</p>
          <form onSubmit={handleLogin} className="flex gap-2">
            <input
              type="text"
              className="flex-1 rounded-xl border border-beach-sky bg-white/80 px-3 py-2 text-beach-navy focus:border-beach-sea focus:outline-none"
              placeholder="admin"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
            />
            <Button type="submit" className="w-auto px-3 py-2 text-sm">
              로그인
            </Button>
          </form>
          <div className="flex items-center justify-between text-xs text-beach-navy/70">
            {adminSession ? (
              <>
                <span>로그인: {adminSession.adminId}</span>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-auto px-3 py-1 text-xs"
                  onClick={handleLogout}
                >
                  로그아웃
                </Button>
              </>
            ) : (
              <span>더미 관리자 ID로 로그인하세요.</span>
            )}
          </div>
        </Card>

        <Card className="space-y-3">
          <p className="text-sm font-semibold text-beach-navy">축제 생성</p>
          <form onSubmit={handleCreateFestival} className="space-y-2">
            <input
              className="w-full rounded-xl border border-beach-sky bg-white/80 px-3 py-2 text-beach-navy focus:border-beach-sea focus:outline-none"
              placeholder="축제 이름"
              value={newFestival.name}
              onChange={(e) => setNewFestival({ ...newFestival, name: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                className="rounded-xl border border-beach-sky bg-white/80 px-3 py-2 text-beach-navy focus:border-beach-sea focus:outline-none"
                placeholder="예산"
                value={newFestival.budget}
                onChange={(e) => setNewFestival({ ...newFestival, budget: Number(e.target.value) })}
              />
              <input
                type="number"
                className="rounded-xl border border-beach-sky bg-white/80 px-3 py-2 text-beach-navy focus:border-beach-sea focus:outline-none"
                placeholder="1인 상한"
                value={newFestival.perUserDailyCap}
                onChange={(e) => setNewFestival({ ...newFestival, perUserDailyCap: Number(e.target.value) })}
              />
              <input
                type="number"
                className="rounded-xl border border-beach-sky bg-white/80 px-3 py-2 text-beach-navy focus:border-beach-sea focus:outline-none"
                placeholder="1장당 포인트"
                value={newFestival.perPhotoPoint}
                onChange={(e) => setNewFestival({ ...newFestival, perPhotoPoint: Number(e.target.value) })}
              />
              <input
                type="number"
                className="rounded-xl border border-beach-sky bg-white/80 px-3 py-2 text-beach-navy focus:border-beach-sea focus:outline-none"
                placeholder="반경(m)"
                value={newFestival.radiusMeters}
                onChange={(e) => setNewFestival({ ...newFestival, radiusMeters: Number(e.target.value) })}
              />
              <input
                type="number"
                className="rounded-xl border border-beach-sky bg-white/80 px-3 py-2 text-beach-navy focus:border-beach-sea focus:outline-none"
                placeholder="위도"
                value={newFestival.centerLat}
                onChange={(e) => setNewFestival({ ...newFestival, centerLat: Number(e.target.value) })}
              />
              <input
                type="number"
                className="rounded-xl border border-beach-sky bg-white/80 px-3 py-2 text-beach-navy focus:border-beach-sea focus:outline-none"
                placeholder="경도"
                value={newFestival.centerLng}
                onChange={(e) => setNewFestival({ ...newFestival, centerLng: Number(e.target.value) })}
              />
            </div>
            <Button type="submit" disabled={!adminSession}>
              축제 등록
            </Button>
          </form>
        </Card>

        <Card className="space-y-3">
          <p className="text-sm font-semibold text-beach-navy">수거함 코드 생성</p>
          <form onSubmit={handleGenerateBins} className="flex items-center gap-2">
            <input
              type="number"
              className="w-24 rounded-xl border border-beach-sky bg-white/80 px-3 py-2 text-beach-navy focus:border-beach-sea focus:outline-none"
              value={binCount}
              onChange={(e) => setBinCount(Number(e.target.value))}
            />
            <Button type="submit" className="w-auto px-3 py-2 text-sm" disabled={!adminSession || !festival}>
              생성
            </Button>
          </form>
          <p className="text-xs text-beach-navy/60">현재 축제: {festival?.name ?? '없음'} ({festival?.id ?? 'ID 없음'})</p>
        </Card>

        <Card className="space-y-2">
          <p className="text-sm font-semibold text-beach-navy">실시간 대시보드</p>
          {summary ? (
            <div className="space-y-2">
              <p className="text-sm text-beach-navy/80">참여 인원: {summary.totalParticipants}명</p>
              <p className="text-sm text-beach-navy/80">총 PENDING: {summary.totalPending}원</p>
              <p className="text-sm text-beach-navy/80">총 ACTIVE: {summary.totalActive}원</p>
              <p className="text-sm text-beach-navy/80">
                예산 사용: {summary.budgetUsed.toLocaleString()} / {summary.festival.budget.toLocaleString()}원 (잔여{' '}
                {summary.budgetRemaining.toLocaleString()}원)
              </p>
              <div className="space-y-1">
                <p className="text-xs text-beach-navy/60">QR별 이용량</p>
                {summary.binUsage.map((item) => (
                  <div key={item.binId} className="rounded-lg bg-white/80 px-3 py-2 text-sm text-beach-navy">
                    {item.code ?? item.binId}: {item.count}회
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-beach-navy/70">요약을 보려면 관리자 로그인 후 축제를 선택하세요.</p>
          )}
          {adminSession?.token && festival && (
            <Button
              variant="secondary"
              className="w-auto px-3 py-2 text-sm"
              onClick={() => loadSummary(festival.id, adminSession.token)}
            >
              새로고침
            </Button>
          )}
        </Card>

        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Layout>
  );
};
