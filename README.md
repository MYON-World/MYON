# MYON

**My Own Network** — 주제가 임무가 되고, 시간이 흐르며 세계가 확장되는 웹게임.

## 개발

```bash
npm ci
npm run dev
```

## 배포

`main` 브랜치에 푸시하면 GitHub Actions에서 `npm ci`, `npm run build`를 실행하고 GitHub Pages에 배포합니다.

GitHub 저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정하세요.

배포 주소: https://myon-world.github.io/MYON/

## 버전

- v0.01.0: Vue + Vite 기반 초기 화면 및 자동 배포 구성

게임 엔진, IndexedDB, Firebase는 아직 구현하지 않았습니다.
