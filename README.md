# Supervid

> **All-in-one YouTube content management tool for creators**
> 유튜브 크리에이터를 위한 올인원 콘텐츠 관리 도구

---

## Overview / 개요

Supervid helps YouTube creators manage their entire content workflow — from idea discovery to upload scheduling — in a single dashboard.

유튜브 크리에이터가 아이디어 발굴부터 업로드 일정 관리까지, 하나의 대시보드에서 콘텐츠 워크플로우를 관리할 수 있는 도구입니다.

---

## Features / 주요 기능

### Dashboard / 대시보드
- Channel analytics at a glance (subscribers, views, milestones)
- Weekly content schedule and script status overview
- Monthly content publishing chart

채널 핵심 지표, 주간 할 일, 콘텐츠 현황 차트를 한눈에 확인

### Kanban Board / 콘텐츠 관리
- Drag-and-drop content pipeline: Idea → Script → Filming → Editing → Scheduled → Published
- Upload checklist per content (thumbnail, tags, subtitles, etc.)
- Built-in script editor with formatting toolbar

칸반 보드로 콘텐츠 진행 상태를 관리하고, 스크립트 에디터로 대본 작성

### Content Discovery / 콘텐츠 탐색
- YouTube video search with advanced filters (duration, subscriber range, sort by performance)
- View-to-subscriber ratio analysis to find high-performing content
- Save videos as references for future content planning

고급 필터 검색, 구독자 대비 조회수 분석, 레퍼런스 저장

### Outlier Finder / 아웃라이어 탐지
- Detects videos that significantly outperform their channel's median views
- Outlier score calculation (e.g., 10x, 50x channel average)
- Visual comparison of video views vs. channel median

채널 평균 대비 폭발적 성과를 낸 영상을 자동 탐지

### Ad Detection / 광고 탐지
- Search for brand-sponsored content across YouTube
- Identify collaboration channels and ad ratios
- Filter by ad vs. non-ad content

브랜드별 유튜브 광고/협찬 영상을 탐지하고 협업 채널 분석

### Channel Explorer / 채널 탐색
- Search and compare YouTube channels by subscriber count
- Channel statistics overview (subscribers, views, video count)

유튜브 채널 검색 및 비교 분석

### Reference Manager / 레퍼런스 관리
- Save and organize reference videos with folder system
- Filter by folders, manage with context menus
- Quick-save from any search result across the app

폴더별 레퍼런스 영상 분류 및 관리

### Ideas / 아이디어 찾기
- Trending videos by category
- Keyword analysis with related video suggestions

카테고리별 트렌드 영상, 키워드 분석

### Calendar / 캘린더
- Visual content calendar with drag-and-drop scheduling
- Content status indicators on each date

캘린더 뷰에서 콘텐츠 업로드 일정 관리

---

## Tech Stack / 기술 스택

| Layer | Technology |
|-------|------------|
| **Frontend** | Vanilla JavaScript, HTML5, CSS3 |
| **Backend** | Node.js, Express.js |
| **Auth** | Google OAuth 2.0 |
| **API** | YouTube Data API v3 |
| **Design System** | Custom CSS (shadcn/ui Zinc palette) |
| **Storage** | localStorage (client), in-memory cache (server) |
| **Typography** | Pretendard Variable, a2z (custom) |

---

## Architecture / 아키텍처

```
┌─────────────────────────────────┐
│           Browser               │
│  index.html + app.js + CSS      │
│  (SPA, localStorage state)      │
└────────────┬────────────────────┘
             │ REST API (fetch)
┌────────────▼────────────────────┐
│     Express.js Server           │
│  Google OAuth2 · Session        │
│  API Quota Tracking · Caching   │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│     YouTube Data API v3         │
└─────────────────────────────────┘
```

---

## Getting Started / 시작하기

### Prerequisites / 사전 준비

- Node.js 18+
- [YouTube Data API Key](https://console.cloud.google.com/)
- [Google OAuth 2.0 Client ID](https://console.cloud.google.com/apis/credentials)

### Installation / 설치

```bash
git clone https://github.com/kimjunhweee/supervid.git
cd supervid
npm install
```

### Environment Variables / 환경 변수

Create a `.env` file in the project root:

```env
YOUTUBE_API_KEY=your_youtube_api_key
GOOGLE_CLIENT_ID=your_google_client_id
```

### Run / 실행

```bash
npm start
# → http://localhost:3000
```

---

## License

MIT
