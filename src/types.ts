export type User = {
  id: string;
  displayName: string;
};

export type AuthSession = {
  user: User;
  token: string;
};

export type Festival = {
  id: string;
  name: string;
  budget: number;
  perUserDailyCap: number;
  perPhotoPoint: number;
  centerLat?: number | null;
  centerLng?: number | null;
  radiusMeters?: number | null;
};

export type TrashBin = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type Summary = {
  totalPending: number;
  totalActive: number;
  totalConsumed: number;
  cap: number;
};

export type TrashPhoto = {
  id: string;
  userId?: string;
  festivalId?: string;
  imageUrl: string;
  status: 'PENDING' | 'ACTIVE' | 'REJECTED';
  points: number;
  hasTrash?: boolean | null;
  trashCount?: number | null;
  maxTrashConfidence?: number | null;
  yoloRaw?: YoloRaw;
  createdAt: string;
};

export type Coupon = {
  id: string;
  shopName: string;
  amount: number;
  code: string;
  status: 'ISSUED' | 'USED';
  createdAt: string;
};

export type Shop = {
  shopName: string;
  amount: number;
  description: string;
};

export type YoloDetection = {
  classId?: number;
  className?: string;
  confidence?: number;
  bbox?: number[];
};

export type YoloRaw =
  | {
      detections?: YoloDetection[];
      raw_detections?: YoloDetection[];
      image_width?: number;
      image_height?: number;
      imageWidth?: number;
      imageHeight?: number;
    }
  | YoloDetection[]
  | null;
