import type { LocationType } from '../api/session';

interface LocationDefaults {
  location_address?: string | null;
  organizationAddress?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
}

/** 저장된 장소를 우선하고, 생성 시 기관 주소 → 상담사 주소 순서로 채운다. */
export function getLocationAddressDefault(defaults: LocationDefaults): string {
  return defaults.location_address?.trim()
    || defaults.organizationAddress?.trim()
    || [defaults.addressLine1, defaults.addressLine2].filter(Boolean).join(' ').trim();
}

export function isLocationAddressVisible(locationType: LocationType): boolean {
  return locationType === 'offline';
}

/** 온라인에서는 주소를 보내지 않고, 빈 오프라인 주소는 서버 기본값을 사용한다. */
export function getLocationAddressPayload(locationType: LocationType, address: string): string | undefined {
  if (!isLocationAddressVisible(locationType)) return undefined;
  const normalized = address.trim();
  if (normalized.length > 300) throw new Error('장소 주소는 300자 이내로 입력해 주세요.');
  return normalized || undefined;
}
