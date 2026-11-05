export type PermissionGuideKind = 'bluetooth' | 'notifications' | 'media';

export function permissionGuideText(kind: PermissionGuideKind): string {
  return kind === 'bluetooth'
    ? 'LINK BAND 연결과 뇌파 수신에 Bluetooth 권한을 사용해요. 허용하지 않아도 밴드 없이 클래스와 리포트를 이용할 수 있어요. 거부했다면 기기 설정에서 Bluetooth 권한을 허용해 주세요.'
    : kind === 'notifications'
      ? '새 메시지와 클래스 초대를 알려드리려면 알림 권한이 필요해요. 허용하지 않아도 서비스를 이용할 수 있어요. 거부했다면 기기 설정에서 알림을 허용해 주세요.'
      : '화상 클래스와 동의한 녹음·녹화에 카메라와 마이크를 사용해요. 카메라와 마이크를 끈 채로도 참여할 수 있어요. 거부했다면 기기 설정에서 권한을 허용해 주세요.';
}
