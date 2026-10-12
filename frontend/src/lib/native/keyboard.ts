// 네이티브 앱(Android/iOS) 키보드 대응 — 키보드가 올라오면 웹뷰 영역 자체가 줄어
// 대화 영역과 입력창이 함께 위로 밀리고, 최신 메시지가 가려지지 않게 한다. 웹은 영향 없음.
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { isNativeApp } from './platform';

export const KEYBOARD_EVENT = 'mb:keyboard-shown';
let started = false;

export async function initNativeKeyboard(): Promise<void> {
  if (!isNativeApp() || started) return;
  started = true;
  try {
    // 웹뷰 프레임 자체를 키보드 높이만큼 줄인다(iOS). Android 는 adjustResize 로 동일하게 동작.
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
    await Keyboard.setScroll({ isDisabled: true });
    await Keyboard.addListener('keyboardDidShow', () => {
      // 레이아웃이 줄어든 뒤 입력 중인 요소를 보이게 하고, 대화 목록은 최신으로 내린다.
      window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT));
    });
  } catch {
    started = false; // 플러그인 미지원 환경은 무시
  }
}
