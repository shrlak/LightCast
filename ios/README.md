# LightCast 리모컨 (iPhone 앱)

웹앱(홈 화면에 추가)이 아니라 **진짜 iPhone 앱**입니다. 교회 서버(Worker)의 리모컨을 앱 안에서 전체 화면으로 열고,
다음을 더합니다: 화면 자동 꺼짐 방지 · 가로/세로 회전 · 연결 실패 안내 · 서버 주소 설정(두 손가락 1초 길게 누르기).
컴퓨터 연결(연결 코드/링크)과 조작은 웹 리모컨과 똑같습니다.

## 설치 (Mac 없이, 무료 Apple ID)

릴리스의 `LightCast-Remote-<버전>.ipa` 는 서명되지 않은 빌드입니다. Apple 개발자 유료 계정 없이 아래 중 하나로 설치합니다.

- **AltStore / SideStore** — 컴퓨터에 AltServer를 설치하고 iPhone에서 `.ipa` 를 열어 설치합니다.
- **Sideloadly** (Windows · Mac) — iPhone을 연결하고 `.ipa` 를 끌어다 놓은 뒤 Apple ID로 설치합니다.

무료 Apple ID로 설치한 앱은 **7일마다 다시 서명**해야 합니다 (AltStore는 자동으로 갱신). 유료 개발자 계정(연 $99)이 있으면
Xcode로 직접 설치하거나 TestFlight로 배포할 수 있고, 그 경우 서명이 1년(TestFlight는 90일)씩 유지됩니다.

## Xcode로 직접 빌드 (Mac)

```bash
brew install xcodegen
cd ios && xcodegen generate && open LightCastRemote.xcodeproj
```

Signing & Capabilities 에서 본인 Team 을 고르고 iPhone을 연결해 ▶ 를 누르면 됩니다. 번들 ID 가 겹치면 바꿔 주세요.

## 서버 주소

기본값은 `Config.swift` 의 `defaultServer` (LightCast 설정의 AI/리모컨 서버와 같은 Worker)입니다. 다른 Worker 를 쓰면
앱에서 두 손가락으로 화면을 1초 길게 눌러 **교회 서버 주소**를 바꿉니다.
