# Manex — AI 음원 원클릭 마스터링 (clean-room clone)

`https://sooslab.zoochord.com/manex/` 의 마스터링 도구를 분석해 **깨끗한 React + Vite + TypeScript 소스로 재구축**한 클론입니다.
모든 오디오 처리는 브라우저(Web Audio API)에서 동작하며, **로그인·프로젝트 저장·업로드 카운트(백엔드 의존 기능)는 제거**하고 마스터링 기능만 남겼습니다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # 타입체크 + 프로덕션 번들
```

## 기능

- 드래그&드롭 / 파일 선택 (WAV·MP3·M4A·FLAC·AAC·OGG·OPUS · 60MB·10분 이하)
- 브라우저 디코드 + 원본 라우드니스(적분 LUFS) 측정
- A/B(Before/After) 실시간 미리듣기 · 파형(클릭=재생, 드래그=구간반복, 더블클릭=해제)
- 라이브 라우드니스 미터(M/S/I/True Peak, K-weighting) + 프리셋 기준선
- 리미팅 드라이브 페이더(음압) + 실시간 게인 리덕션
- 전체 측정(오프라인 렌더 → Before/After 적분 LUFS·트루피크 비교)
- 고급 설정: 피크 테이머 · EQ(드래그 그래프) · 컴프레서 · 멀티밴드 · 리미터 · 출력 포맷(16/24/32-bit + 디더)
- 현재 설정으로 WAV 다운로드

## DSP 엔진 (`src/audio/`)

원본의 신호 체계를 그대로 포팅했습니다(라이브==오프라인 동등성).

- `loudness.ts` — ITU-R BS.1770 K-weighting 적분 LUFS(게이팅), 4× 오버샘플 트루피크, 트랜지언트 밀도
- `limiterCore.ts` + `worklets/limiter-processor.js` — 트루피크 룩어헤드 리미터(4× 폴리페이즈 FIR)
- `deharshCore.ts` + `worklets/de-harsh-processor.js` — STFT 스펙트럴 디하시
- `worklets/clipper-processor.js` — 드라이브→젠틀 리미터(피크 테이머)
- `chain.ts` / `presets.ts` — 배포 타깃 프리셋 + 체인 빌더 + 자동 makeup 게인 수식
- `offlineRender.ts` — 내보내기/측정용 오프라인 렌더(EQ→멀티밴드→컴프→디하시→클리퍼→makeup→리미터→−0.1dB)
- `realtimeGraph.ts` / `meters.ts` — 실시간 미리듣기 그래프 + 라이브 미터

### 신호 체인

EQ(HPF + 6밴드) → 멀티밴드(200/2000Hz 3밴드) → Glue 컴프 → 디하시 → 피크 테이머 → makeup 게인 → 트루피크 리미터 → −0.1dB 세이프티

기본 프리셋은 원본과 동일하게 `streaming`(타깃 −14 LUFS, 천장 −1 dBTP)으로 고정됩니다.

## 검증

동일 음원(sample.wav, 48kHz 스테레오)으로 원본과 전체 측정 결과가 **소수점까지 일치**함을 확인했습니다.

| | 원본 | 클론 |
|---|---|---|
| Before | −15.1 LUFS / −3.2 dBTP | −15.1 / −3.2 |
| After (타깃 −14) | −9.9 LUFS / 0.4 dBTP | −9.9 / 0.4 |
| 리미팅 기본값 | 61% (+2.6 dB) | 61% (+2.6 dB) |

## 원본과의 의도된 차이

- 로그인 / 프로젝트 저장 / "남은 업로드 N/N" 카운트 / 티어(Pro·Premium) 게이팅 제거
- 그 결과 고급 설정이 항상 열려 있음(원본은 Pro 잠금)
- Supabase·OAuth·결제 등 모든 서버 호출 제거

> 참고: 폰트는 Pretendard(CDN), 파비콘/브랜드 자산은 원본을 사용합니다.
