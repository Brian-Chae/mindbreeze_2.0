import { Capacitor } from '@capacitor/core';

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
export const getPlatform = (): 'web' | 'ios' | 'android' => {
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : 'web';
};
