import { AdminSession, AuthSession, Coupon, Festival, Shop, Summary, TrashBin, TrashPhoto, User } from './types';

export const API_BASE = import.meta.env.VITE_API_URL || '/api';
const API_ORIGIN = API_BASE.replace(/\/api$/, '');
export const resolveImageUrl = (path: string) => (path.startsWith('http') ? path : `${API_ORIGIN}${path}`);

let authToken: string | undefined;

export const setAuthToken = (token?: string) => {
  authToken = token;
};

const withAuth = (headers: HeadersInit = {}) => ({
  ...headers,
  ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
});

const withAdminAuth = (token: string, headers: HeadersInit = {}) => ({
  ...headers,
  Authorization: `Bearer ${token}`,
  'x-admin-token': token
});

const handle = async <T>(res: Response): Promise<T> => {
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data && data.message) || '요청 중 오류가 발생했어요.');
  }
  return data as T;
};

export const api = {
  async login(nickname: string): Promise<AuthSession> {
    const res = await fetch(`${API_BASE}/auth/mock-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname })
    });
    const data = await handle<{ user: User; token: string }>(res);
    setAuthToken(data.token);
    return { user: data.user, token: data.token };
  },

  async listFestivals(): Promise<Festival[]> {
    const res = await fetch(`${API_BASE}/festivals`);
    const data = await handle<{ festivals: Festival[] }>(res);
    return data.festivals;
  },

  async getFestival(festivalId: string): Promise<{ festival: Festival; bins: TrashBin[] }> {
    const res = await fetch(`${API_BASE}/festivals/${festivalId}`);
    return handle(res);
  },

  async getSummary(userId: string, festivalId: string): Promise<{ festival: Festival; summary: Summary }> {
    const res = await fetch(`${API_BASE}/users/${userId}/summary?festivalId=${festivalId}`, {
      headers: withAuth()
    });
    return handle(res);
  },

  async getPhotos(userId: string, festivalId: string): Promise<TrashPhoto[]> {
    const res = await fetch(`${API_BASE}/users/${userId}/photos?festivalId=${festivalId}`, {
      headers: withAuth()
    });
    const data = await handle<{ photos: TrashPhoto[] }>(res);
    return data.photos;
  },

  async uploadPhoto(params: {
    userId: string;
    festivalId: string;
    file: File;
    lat?: number;
    lng?: number;
  }) {
    const form = new FormData();
    form.append('userId', params.userId);
    if (params.lat !== undefined) form.append('lat', String(params.lat));
    if (params.lng !== undefined) form.append('lng', String(params.lng));
    form.append('image', params.file);
    const res = await fetch(`${API_BASE}/festivals/${params.festivalId}/trash-photos`, {
      method: 'POST',
      headers: withAuth(),
      body: form
    });
    return handle<{
      photo: TrashPhoto;
      summary: Summary;
      message: string;
    }>(res);
  },

  async listBins(festivalId: string): Promise<TrashBin[]> {
    const res = await fetch(`${API_BASE}/festivals/${festivalId}/trash-bins`);
    const data = await handle<{ bins: TrashBin[] }>(res);
    return data.bins;
  },

  async scanBin(params: { userId: string; festivalId: string; binCode: string; lat?: number; lng?: number }) {
    const res = await fetch(`${API_BASE}/festivals/${params.festivalId}/trash-bins/scan`, {
      method: 'POST',
      headers: withAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(params)
    });
    return handle<{
      activated: number;
      convertedCount: number;
      binName: string;
      summary: Summary;
    }>(res);
  },

  async listShops(festivalId: string): Promise<Shop[]> {
    const res = await fetch(`${API_BASE}/festivals/${festivalId}/shops`);
    const data = await handle<{ shops: Shop[] }>(res);
    return data.shops;
  },

  async issueCoupon(params: { userId: string; festivalId: string; shopName: string; amount: number }) {
    const res = await fetch(`${API_BASE}/festivals/${params.festivalId}/coupons`, {
      method: 'POST',
      headers: withAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(params)
    });
    return handle<{ coupon: Coupon }>(res);
  },

  async listCoupons(userId: string, festivalId: string): Promise<Coupon[]> {
    const res = await fetch(`${API_BASE}/users/${userId}/coupons?festivalId=${festivalId}`, {
      headers: withAuth()
    });
    const data = await handle<{ coupons: Coupon[] }>(res);
    return data.coupons;
  },

  async adminLogin(adminId: string): Promise<AdminSession> {
    const res = await fetch(`${API_BASE}/admin/mock-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId })
    });
    return handle<AdminSession>(res);
  },

  async adminCreateFestival(payload: Partial<Festival> & { name: string }, token: string) {
    const res = await fetch(`${API_BASE}/admin/festivals`, {
      method: 'POST',
      headers: withAdminAuth(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    return handle<{ festival: Festival }>(res);
  },

  async adminGenerateBins(festivalId: string, count: number, token: string) {
    const res = await fetch(`${API_BASE}/admin/festivals/${festivalId}/trash-bins/generate`, {
      method: 'POST',
      headers: withAdminAuth(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ count })
    });
    return handle<{ bins: TrashBin[] }>(res);
  },

  async adminSummary(festivalId: string, token: string) {
    const res = await fetch(`${API_BASE}/admin/festivals/${festivalId}/summary`, {
      headers: withAdminAuth(token)
    });
    return handle<{
      festival: Festival;
      totalParticipants: number;
      totalPending: number;
      totalActive: number;
      budgetUsed: number;
      budgetRemaining: number;
      binUsage: { binId: string; code?: string; count: number }[];
    }>(res);
  }
};
