# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Supervid (CreatorHub)** — YouTube 콘텐츠 크리에이터를 위한 관리 도구. Express.js 백엔드 + Vanilla JS 프론트엔드 모놀리스 구조.

## Commands

```bash
npm start          # node server.js → localhost:3000 (로컬 개발용)
npm install        # 의존성 설치
```

빌드/린트/테스트 설정 없음. 로컬은 서버 재시작, 프로덕션은 git push → Vercel 자동 배포.

## Architecture

```
index.html      ─ UI 구조 (9개 탭, 모달들, 사이드바)
app.js          ─ 클라이언트 로직 (상태관리, 렌더링, fetch 호출)
styles.css      ─ shadcn/ui Zinc 팔레트 기반 디자인 시스템 (다크/라이트)
i18n.js         ─ 한국어/영어 번역 딕셔너리 + t() 함수
server.js       ─ Express 서버 (Google OAuth2, YouTube API 프록시, Supabase 연동)
api/index.js    ─ Vercel 서버리스 진입점 (server.js 재익스포트)
vercel.json     ─ Vercel 배포 설정 (정적 파일 + 서버리스 라우팅)
.env            ─ YOUTUBE_API_KEY, GOOGLE_CLIENT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
```

### 클라이언트 상태관리

`state` 객체 + `localStorage` 직접 사용. 키 prefix는 `creatorhub_`.

```js
state.contents      // creatorhub_contents — 콘텐츠 아이템 (칸반/캘린더/대시보드)
state.references    // creatorhub_references — 저장된 레퍼런스 영상
state.refFolders    // creatorhub_ref_folders — 레퍼런스 폴더
state.theme         // creatorhub_theme — 'dark' | 'light'
state.user          // JWT 쿠키 기반 Google OAuth 인증
```

저장 패턴: `saveContents()`, `saveReferences()`, `saveRefFolders()` — `localStorage.setItem()` 후 `syncToServer()`로 Supabase에 debounce 동기화 (1초).

### 탭 구조

9개 메인 탭: `dashboard`, `kanban`, `calendar`, `discover`, `channels`, `references`, `ideas`, `addetect`, `outliers`. 각 탭에 `setup*()` (이벤트 바인딩, 1회) + `render*()` (데이터 렌더링) 함수 쌍.

### 서버 API 엔드포인트

- `POST/GET /api/auth/*` — Google OAuth2 인증, 세션 관리
- `GET /api/youtube/search` — 영상 검색 (캐싱 30분, 100 quota units)
- `GET /api/youtube/trending` — 인기 영상 (캐싱 2시간)
- `GET /api/youtube/channel` — 채널 통계
- `GET /api/youtube/videos` — 채널의 최근 영상
- `GET /api/youtube/outliers` — 아웃라이어 분석 (채널 중앙값 대비 고성과 영상)
- `GET /api/youtube/search-channels` — 채널 검색
- `GET /api/youtube/keyword-suggestions` — 키워드 자동완성 (Google Suggest)
- `GET /api/youtube/usage` — API 할당량 확인 (10,000 units/day)

모든 YouTube 엔드포인트는 `requireAuth` 미들웨어 필요. Supabase `api_cache` 테이블 기반 캐싱 (TTL 30분~24시간).

### 인증 방식

JWT (`jsonwebtoken`) + HttpOnly 쿠키 (`auth_token`). `requireAuth` 미들웨어가 쿠키 검증. Supabase `user_data` 테이블에 사용자 정보 + 앱 데이터 저장.

## Key Patterns

- **ID 생성**: `generateId()` — `Date.now().toString(36) + random`
- **모달 열기/닫기**: `element.classList.add('active')` / `.remove('active')` — `.modal-overlay.active { display: flex }`
- **토스트 알림**: `toast('메시지')` 함수
- **HTML 이스케이프**: `escapeHtml(text)` — XSS 방지
- **숫자 포맷**: `formatNumber(num)` — 천/만/억 단위
- **CSS 변수 테마**: `[data-theme="light"]` 선택자로 라이트 모드 오버라이드
- **폰트**: Pretendard Variable (본문), a2z (로고)

## File Size Context

| 파일 | 라인 |
|------|------|
| app.js | ~3,600 |
| styles.css | ~2,200 |
| server.js | ~670 |
| index.html | ~1,250 |
| i18n.js | ~1,100 |
