# Manex Clone — Implementation Spec (clean-room rebuild, mastering only)

Reverse-engineered from the live build at `sooslab.zoochord.com/manex/`.
Original assets archived in `/.reference/`. All audio processing is **client-side Web Audio**.

**Scope decisions (from user):**
- Clean rebuild as readable **React + Vite + TS** (not an asset mirror).
- **Backend removed entirely** — no login, no project-save, no upload-count/quota, no tiers. All controls unlocked.
- The live build pins every track to `presetId: "streaming"` → **target −14 LUFS, ceiling −1 dBTP**, displayed as "AI음악 자동 · 상한 −14 LUFS". There is **no genre selector** (K-발라드/트로트/워십/K-팝 is marketing copy only).

---

## 1. Tech / structure

- React 18 + Vite 6 + TypeScript. Tailwind-equivalent styling (original is compiled Tailwind v3; we can use either Tailwind or hand-written CSS reproducing the tokens in §9).
- Worklets (`limiter`, `de-harsh`, `clipper`) live in `public/worklets/*.js` (plain JS, loaded via `audioContext.audioWorklet.addModule(url)`), or `src/audio/worklets/*` imported with Vite `?url`/`?worker`. The originals are readable (archived in `.reference/assets/*-worklet-*.js`) and can be ported almost verbatim.
- Pretendard font via CDN (already in `index.html`).

---

## 2. DSP ENGINE

Two engines share one parameter object (the "chain", built by `bi`, §4):

### 2A. Realtime graph (for live A/B preview) — order:
```
MediaElementSource (the <audio> playing the ORIGINAL 16-bit WAV)
 → inputGain (1.0)
 → [bypass xfade] highpass biquad (Q 0.707, freq = hpfFreq)
 → [bypass xfade] EQ: 6 biquads in series (band set below)
 → [bypass xfade] multiband: 3-band parallel (see 2C), summed
 → [bypass xfade] glue DynamicsCompressor
 → de-harsh worklet (if loaded)
 → clipper worklet (if loaded)
 → makeup gain = 10^((autoMakeupDb + comp.makeup + userMakeupDb)/20)
 → [bypass xfade] limiter worklet (true-peak lookahead)
 → safety gain = 10^(-0.1/20)   (−0.1 dB)
 → destination
```
Each stage has a wet/dry crossfade for smooth bypass. A parallel dry tap (gain 0) feeds destination for instant Before/After. Global bypass (Before mode) swaps wet/dry gains. Limiter posts gain-reduction dB back via `port.onmessage {gr}`.

### 2B. Offline render (for the WAV export + full LUFS measurement) — `sf(buffer, chain)`:
`OfflineAudioContext(min(2,ch), buffer.length, buffer.sampleRate)` — **native sample rate**.
Graph: HPF → EQ → multiband(parallel) → glue comp → gain(1) → render. Then **post-render JS passes on the rendered PCM**:
1. de-harsh: `Ym(pcm, preset)` (STFT, if not bypassed)
2. clipper drive: `Im` block=128 (if peakStage not bypassed)
3. makeup: multiply all samples × `10^((auto+comp+user)/20)`
4. true-peak limiter: `xf` block=128 (if limiter not bypassed)
5. safety: × `10^(-0.1/20)`

### 2C. EQ band set — `xm(tone)` builds 6 biquads over centers `[60,150,400,1000,3000,8000]` Hz, all Q 0.7:
- 60 Hz → `lowshelf`; 150/400/1000/3000 Hz → `peaking`; 8000 Hz → `highshelf`.
- All start gain 0; the preset `tone.low/mid/high` shelving moves are **added onto the nearest band** by octave distance.

### 2D. Multiband — crossovers hardcoded **200 Hz / 2000 Hz**. Each split = 2 cascaded biquads Q 0.707 (LR4).
- Low: `lowpass(200)`; Mid: `highpass(200)→lowpass(2000)`; High: `highpass(2000)`. Each band → its own DynamicsCompressor → summed.
- Only the `korean` preset enables multiband by default.

### 2E. Envelope follower (`Qm`) — peak-rectified one-pole, branched:
```
attackCoef  = exp(-1 / (sampleRate * attackMs  / 1000))
releaseCoef = exp(-1 / (sampleRate * releaseMs / 1000))
process(x): s=|x|; env = (s>env)? attackCoef*env+(1-attackCoef)*s : releaseCoef*env+(1-releaseCoef)*s
```

### 2F. Soft-knee gain computer (`Gm`), no makeup:
```
kneeStart=thr-knee/2; kneeEnd=thr+knee/2
g(L): L<=kneeStart→0; L>=kneeEnd→ over=L-thr; over/ratio-over (= -over*(1-1/ratio))
      else t=(L-kneeStart)/knee → -(L-thr)*(1-1/ratio)*t*t
```

### 2G. STFT spectral de-harsh (`Xm`/`Ym`, offline) — `fftSize 1024, hop 256`, Hann window, overlap-add ÷1.5.
7 bands (Hz / atk ms / rel ms / thr dB / ratio / knee dB / enabled-by-default):
| # | Hz | atk | rel | thr | ratio | knee | on |
|--|--|--|--|--|--|--|--|
|0|0–80|30|200|−12|2|10|no|
|1|80–250|20|150|−15|2.5|8|no|
|2|250–1000|10|100|−18|3|6|no|
|3|1000–3000|8|80|−20|3.5|6|no|
|4|3000–6000|2|40|−24|3|4|**yes**|
|5|6000–12000|2|30|−26|3.5|3|**yes**|
|6|12000–20000|5|50|−22|2|6|no|

Preset mods: `aggressive`→sensitivity 0.8, maxCut −18, band thr−6/ratio+2; `gentle`/default→sensitivity 0.3, maxCut −6, band thr+6/ratio−1(min2).
Resonance detector (`Km`, smoothing 0.3, trigger ratio 1.5, normalize ÷2) applies extra dynamic cut on bins 1000–10000 Hz: `gainDb += maxCut*resonance*sensitivity` (default maxCut −12, sens 0.5 → up to −6 dB). If `aiArtifactMode` (default on) and bin 5000–12000 Hz, `gainDb += gainDb*0.3`.
> Realtime uses the `de-harsh-processor` worklet (archived, readable) — port it; the offline JS is presumed equivalent.

### 2H. TRUE-PEAK LIMITER — authoritative algorithm (limiter worklet + offline `xf`), VERBATIM-ported from `.reference/assets/limiter-worklet-C1AIupg2.js`:
- 4× oversampling polyphase FIR, 8 taps/phase. `FIR` (Float32Array, 32 values):
```
0,0,0,1,0,0,0,0,
0.0110,-0.0467,0.1326,0.9709,-0.0974,0.0353,-0.0095,0.0038,
0.0155,-0.0663,0.2014,0.8499,0.2014,-0.0663,0.0155,-0.0050,
0.0038,-0.0095,0.0353,-0.0974,0.9709,0.1326,-0.0467,0.0110
```
- `dbToLin(db)=10^(db/20)`; `coefFromMs(ms,sr)= ms<=0?0:exp(-1/((ms/1000)*sr))`.
- Per sample: shift 8-tap history, push sample; oversampled peak = max over 4 phases of |Σ FIR[phase*8+t]·hist[t]|; `target = peak>ceiling ? ceiling/peak : 1`; `env = target + (env-target)*(target<env?attackCoef:releaseCoef)`; output = `clamp(delayed_sample*env, ±ceiling)` with lookahead delay line. Returns max GR dB.
- Defaults / params: ceilingDb (preset, −1 or −2), releaseMs **50**, lookaheadMs **1.5**, attackMs **1**.
- **Fallback** when worklet unavailable: native DynamicsCompressor ratio **20**, attack **0.001**, knee **0**, threshold=ceiling, release 0.05.
- Param descriptors (k-rate): ceilingDb[-12..0] def −1; releaseMs[1..500] def 50; lookaheadMs[0..10] def 1.5; attackMs[0..50] def 1. GR posted every 37 quanta.

### 2I. Clipper (`Im` offline + clipper worklet) — **drive-into-limiter**, NOT a waveshaper:
apply `driveDb` linear gain, then run `xf` limiter with ceiling=`thresholdDb` (default −3 = `Uc`), lookahead **1 ms**, attack **1 ms**, release **30 ms**.

---

## 3. LOUDNESS (LUFS / true-peak)

### 3A. K-weighting (ITU-R BS.1770) — two IIR biquads (used realtime + offline):
- Stage1 high-shelf: `b=[1.53512485958697,-2.69169618940638,1.19839281085285]`, `a=[1,-1.69065929318241,0.73248077421585]`
- Stage2 high-pass: `b=[1,-2,1]`, `a=[1,-1.99004745483398,0.99007225036621]`

### 3B. Integrated LUFS (`fm`) on a 48 kHz K-weighted render (`Bc=48000`):
```
block=floor(0.4*sr) (400ms); hop=floor(0.1*sr) (100ms, 75% overlap); channelWeights=[1,1]
per block meanSquare = Σ_ch w*(Σx²/block)
L_K(ms) = -0.691 + 10*log10(ms)
absolute gate: keep blocks with L_K >= -70
relThresh = L_K(mean(absKept)) - 10 ; relative gate: keep blocks >= relThresh
integrated = L_K(mean(relKept))
```
Gates: absolute **−70 LUFS**, relative **−10 LU**.

### 3C. Realtime meter (`nf`): AnalyserNode fftSize 16384, smoothing 0, fed through K-weighting. tick 100 ms. Momentary=current; Short-term=mean last 30 blocks (3 s); Integrated=same two-stage gating; history ring 300 (30 s). `cl(ms) = -0.691+10*log10(ms)`.

### 3D. `Oi(buffer)` → `{ lufsI, peakDb, truePeakDb, crestDb, transientDensity }`. true-peak via same 4× FIR.

### 3E. Makeup math (constants `pm=.5, $c=18, Uc=-3, hm=1.5, gm=6`):
```
mm (autoMakeupDb, "headroom"): deficit=targetLufs-lufsI; headroom=ceilingDb-truePeakDb+clipperDrive+0.5
   → clamp(min(deficit,headroom),0,18), then final clamp [-18,18]
vm (userMakeupDb default): proj=truePeakDb+autoMakeupDb-ceilingDb → clamp(targetLufs-proj+1.5,0,6); fallback literal 1.68
ym (clipper drive): over=max(0,truePeakDb+baseDrive+3) → clamp(min(baseDrive+over,over+2),0,6)
baseDrive S = clamp((crestDb-12)*(suno?0.2:0.4),0,suno?1:2)  // only in clipper-mode
```
Total applied gain (linear) = `10^((autoMakeupDb + comp.makeup + userMakeupDb)/20)`.
Mode classifier `im`: clipper if `crestDb>=11 && transientDensity>=0.4`, or `transientDensity>=0.6`; else transient.

---

## 4. PRESETS (`Wi`) + chain builder (`bi`)

Pinned preset = **streaming**. Others kept in code for completeness but unused by default flow.
| id | label | targetLufs | ceilingDb | EQ | comp thr/ratio/atk/rel/knee | multiband |
|--|--|--|--|--|--|--|
|korean|국내 (멜론·지니·벅스)|−8|−1|on|−16/2/.02/.18/6|**on** low −20/1.8, mid −22/1.5, high −24/1.6|
|**streaming** ★|스트리밍 표준|**−14**|**−1**|on|−18/1.5/.03/.25/6|off|
|apple|Apple Music|−16|−1|on|−18/1.5/.04/.3/6|off|
|broadcast|방송 EBU R128|−23|−1|on|−20/1.5/.05/.3/8|off|
|ott|OTT 영상|−27|−2|**off**|−20/1.5/.05/.3/6|off|

Per-preset tone EQ (hpf freq / low f,g / mid f,g,q / high f,g):
- korean: hpf30 / 90,+1 / 3000,−0.5,0.9 / 12000,+2
- streaming: hpf25 / 100,0 / 1000,0,1 / 12000,+0.5
- apple: hpf25 / 110,+0.8 / 2500,−0.5,0.9 / 11000,+0.5
- broadcast: hpf35 / flat
- ott: hpf35, eqOn:false

`bi(presetId, loudness, targetLufs, ceilingDb, isSuno)` → chain `{ eq{bypassed,hpfFreq,hpfBypassed,bands}, comp{...,makeup:0}, mb{bypassed,crossoverLow:200,crossoverHigh:2000,bands}, deHarsh{bypassed:true,preset:"gentle"}, peakStage{bypassed:!clipperMode,mode:"clipper",thresholdDb:-3,driveDb,autoRecommended}, autoMakeupDb, userMakeupDb, limiter{bypassed:false,ceiling,release:.05,lookaheadMs:1.5,attackMs:1}, normalizeMode:"headroom" }`.

---

## 5. FILE I/O

### 5A. Validation (`xh`): order = size → ext → decode → duration.
- `MAX_SIZE = 60*1024*1024 = 62,914,560` bytes; `MAX_DURATION = 600` s; accepted ext = `["wav","mp3","m4a","aac","flac","ogg","opus"]`.
- ext regex `/\.([a-z0-9]+)$/` on lowercased name.
- Errors (DecodeError with `.code`):
  - TOO_LARGE: `파일이 너무 큽니다 (${(size/1024/1024).toFixed(1)}MB). 60MB 이하만 가능합니다.`
  - UNSUPPORTED_FORMAT: `지원하지 않는 포맷입니다 (.${ext}). WAV·MP3·M4A·FLAC 등을 사용해주세요.`
  - DECODE_FAILED: `디코딩에 실패했습니다. 다른 파일로 시도해주세요.`
  - TOO_LONG: `너무 깁니다 (${duration.toFixed(0)}초). 10분 이하만 가능합니다.`
  - generic fallback: `파일 처리 중 오류가 발생했습니다.`
- `<input accept="audio/*,.wav,.mp3,.m4a,.flac,.aac,.ogg,.opus">`; drop zone takes `dataTransfer.files[0]`; input resets `value=""` after.

### 5B. Decode: `file.arrayBuffer()` → throwaway `new AudioContext()` → `decodeAudioData` → `ctx.close()`. Returns `{buffer, fileName, fileSize}`. Then `Oi(buffer)` for loudness + `kh(buffer)` for 16-bit preview blob URL.

### 5C. WAV export (`wf`): 44-byte RIFF/WAVE PCM. bitDepth default **24** (also 16, 32-float); dither default **true** (TPDF `random()-random()`, ±1 LSB, skip for float); channels min(2,ch); native sample rate; interleaved L/R; 24-bit packed 3-byte LE with two's-complement fixup; clamp ±1. 32-bit → format tag 3 (IEEE float), else 1.
- Preview (`kh`): 16-bit, dither off → blob URL for `<audio>` (the "Before" source).
- Download (`Am`): `URL.createObjectURL` → `<a download>` click → revoke after 1 s.
- Filename: `${basename}_mastered_${presetLabel}_${"16bit"|"24bit"|"32f"}.wav` (presetLabel = "스트리밍 표준").

---

## 6. STATE MACHINE + COMPONENT TREE

Stages: `idle → decoding → ready | error`. (No separate processing screen — decode is the only async gate; mastering is live.)
Main container: `<main class="max-w-[920px] mx-auto px-7 py-8">`.

- **Header**: `← 홈` / `Manex` / (login removed). 3-col grid, `max-w-prose`.
- **idle**: copy "AI음악 음원을 올리면 자동으로 마스터링합니다" + "선형 게인으로 음압을 올리고 트루피크 리미터로 안전하게 — 다이내믹 손상 없이." + **drop zone**.
- **decoding**: "파일을 분석하고 있습니다…" + "디코딩 · 원본 라우드니스 측정 중" + indeterminate bar.
- **error**: "오류가 발생했습니다" + message + "다시 시도하기".
- **ready** → file summary (`{dur}s · Mono/Stereo · {kHz}kHz · 원본 {lufsI} LUFS` / right: "AI음악 자동 · 상한 −14 LUFS" + "다른 파일") then the mastering component:
  1. Player card: hidden `<audio src={originalUrl}>`; **A/B toggle** (Before/원본 vs After/마스터링 적용, each shows live LUFS); **waveform** (click=seek, drag=loop-select, dblclick=clear); play/pause (▶/❚❚); help line.
  2. Loudness history meter (최근 30초, M/S/I/True Peak pills, target −14 highlight).
  3. Limiting drive fader (vertical, "리미팅", 0–100% = −12..+12 dB makeup, dblclick→0%) + GR/output-peak meter with warnings.
  4. Full measure (전체 측정): offline render → integrated LUFS + true-peak Before/After/Δ.
  5. **Advanced accordion (고급 설정)** — UNLOCKED (tiers removed): Auto-setup button (자동 설정), Peak tamer, EQ graph (draggable points, dblclick=0), Compressor (Threshold/Ratio/Attack/Release), Multiband, Limiter, Output format (16/24/32-bit + 디더), evidence panel.
  6. Download button: "현재 설정으로 WAV 다운로드" / "렌더링 중…" → re-render via `sf` at chosen bitDepth/dither.
- **footer**: privacy line (브라우저 처리·서버 미전송 안내) + "© 2026 Manex". (원본의 사업자 등록정보·연락처는 클론에서 제외.)

Drop zone copy: "AI음악 곡을 여기 놓아주세요" / "WAV · MP3 · M4A · FLAC · 60MB 이하 · 10분 이하" / "파일 선택" / "업로드 없이 브라우저에서 직접 처리됩니다. 파일이 서버로 전송되지 않습니다."

(Full verbatim copy list lives in the agent report; key strings captured above. See §8 for control labels.)

---

## 7. REMOVE (backend) — do not implement
백엔드 의존 기능은 클론에서 전부 제외한다: 로그인/OAuth, 프로젝트 저장 및 파일 스토리지, 사용량·업로드 카운트, 결제/티어 게이팅, 관련 API 호출·딥링크·localStorage 키, 업로드 카운터/저장 버튼/로그인 게이트 모달. 그 결과 고급 설정과 다운로드는 잠금 없이 항상 열어 둔다. (원본의 구체적인 서버 엔드포인트·키 등 역공학 메모는 의도적으로 기록하지 않음.)

---

## 8. KEY CONTROL LABELS (verbatim)
- Peak tamer: "피크 테이머" / "가장 큰 피크를 잡아 음압 여력을 확보합니다 (리미터 앞)." / "게인 리덕션 (실시간)" / 안전 · "주의 1.5" · "위험 3" / "드라이브 (피크 정리량)".
- Limiting meter: "⚠ 클립! 드라이브를 낮추세요" / "⚠ 리미팅 과도 — 드라이브를 낮추세요" / "피크 임박 (−3dBFS 이상)" / "양호" / "재생하면 출력 레벨이 표시됩니다" / "리미팅" / "올리면 더 크게 · 깨지면 낮추세요".
- EQ: "점을 끌어 주파수·게인 조정 · 더블클릭=0dB · 재생 시 실시간 주파수 표시" / "밴드" / "평탄화".
- Comp: "Glue 단일 밴드" / Threshold/Ratio/Attack/Release.
- Limiter: "전체 리미팅 양은 맨 위 리미팅 드라이브 페이더로 조절하세요. Ceiling은 천장(보통 −1dB), Release는 리미터 회복 속도입니다." / "자동 makeup ${±x}dB 적용 중".
- Output: "출력 포맷" / "16-bit"·"24-bit"·"32-bit float" / "디더 " + "(float 불필요)".
- Full measure: "전체 측정" / "처음부터 끝까지 오프라인 렌더 → 적분 LUFS 비교 (체인 상태 그대로)" / "측정 중…"/"다시 측정"/"전체 측정 시작" / "원본 (체인 적용 전)" / "타깃 −14 LUFS" / "변화" / "After − Before".
- Loudness meter: "최근 30초" / "측정 중 (라이브 근사 · 정확값은 전체 측정)" / "재생 시 측정 시작" / pills M·S·I·"True Peak".
- Player: "Before"/"원본" · "After"/"마스터링 적용" · "재생"/"일시정지" · "선택 해제" · "파형 클릭 → 그 위치 재생 · 드래그 → 구간 반복 · 더블클릭 → 선택 해제".

---

## 9. CSS tokens
- Font: `Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif`; mono `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`.
- Palette: paper `#0a0a0a`, ink `#f5f5f5`, mute-1 `#1a1a1a`, mute-2 `#3a3a3a`, mute-3 `#888`, mute-4 `#bbb`, accent `#00B899` (+ brand `#00D4AA`), error `#d14343`/`#e63946`, success `#3ecf5a` / light `#9fe8d6`, warn `#e0a23a`, kakao `#FEE500`. Modal surfaces `#141414`/`#222`/`#2a2a2a`. Opacity tints e.g. `ink/20|30|40`, `mute-1/50`, `mute-2/60`, `black/45|70`.
- Custom classes: `.drive-fader` (horizontal range, track #333 6px, thumb #f5f5f5 14×22, border 2px #0a0a0a, shadow 0 1px 3px #0009); `.fader-vert` (vertical 26×180, thumb 24×13); `.loadbar-indeterminate`.
- Keyframes: `loadbar-slide` `{0%{transform:translateX(-100%);width:40%}50%{width:60%}100%{transform:translateX(250%);width:40%}}`; `spin` `{to{transform:rotate(360deg)}}`.
- Layout: main `max-w-[920px] mx-auto px-7 py-8`; header grid 3-col `max-w-prose px-7 py-5`; breakpoint `sm:` = 640px.
