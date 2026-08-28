# 우리집 레시피

`recipes/` 안의 마크다운(.md) 레시피 파일을 브라우저에서 바로 읽어 보여주는 정적 웹사이트입니다.
빌드 도구나 서버 없이, 정적 파일만 올리면 동작합니다.

## 로컬에서 확인하기

`.md` 파일은 `fetch`로 읽기 때문에 `file://`로 직접 열면 브라우저가 요청을 막습니다.
반드시 간단한 정적 서버로 띄워서 확인하세요.

```bash
python -m http.server 8000
```

이후 브라우저에서 `http://localhost:8000` 접속.

Node.js가 있다면 `npx serve` 등 다른 정적 서버를 써도 무방합니다.

## 새 레시피 추가하는 법

1. `recipes/` 폴더에 새 `.md` 파일을 추가합니다. 파일명이 곧 레시피 이름 역할을 하므로 원하는 이름으로 저장하세요 (한글/공백/괄호 사용 가능).

   파일 형식:

   ```yaml
   ---
   name: 레시피 이름          # 필수
   servings: 2                # 선택
   source:                    # 선택
     - title: 출처 제목
       url: "https://..."
   tags: [태그1, 태그2]        # 선택
   related: [다른 레시피 이름]  # 선택
   thumbnail: assets/images/사진.jpg   # 선택
   ---
   ## 재료
   - ...

   ## 조리법
   1. ...
   ```

   `related`에 적은 레시피는 상세 페이지 맨 아래 "관련 레시피"에 링크로 나옵니다.
   파일명이 아니라 그 레시피의 `name` 값을 그대로 적으세요 (예: `related: [어묵탕, 크림 파스타]`).
   양쪽 페이지에 모두 보이게 하려면 두 파일에 각각 적어야 합니다.
   이름이 틀리면 링크 대신 "찾을 수 없음"으로 표시되어 오타를 바로 알 수 있습니다.

   `thumbnail`에 적은 이미지는 목록 카드와 상세 페이지 제목 위에 나옵니다.
   사진 파일은 `assets/images/`에 넣고 사이트 최상위 기준 경로로 적으세요.

   ```yaml
   thumbnail: assets/images/닭도리탕.jpg     # 저장소 안의 사진
   thumbnail: "https://example.com/사진.jpg"  # 바깥 주소도 가능
   ```

   생략하면 지금처럼 글자만 있는 카드로 나옵니다.
   경로가 틀려 사진을 불러오지 못하면 깨진 이미지 대신 썸네일 자리를 비웁니다.

2. 매니페스트(`recipes/index.json`)를 갱신합니다. 레시피를 추가/삭제/이름변경할 때마다 아래 스크립트 중 환경에 맞는 하나를 실행하세요.

   **WSL / Git Bash / macOS / Linux:**
   ```bash
   bash gen-manifest.sh
   ```

   **Windows PowerShell:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\gen-manifest.ps1
   ```

   두 스크립트 모두 `recipes/` 안의 `*.md` 파일 목록을 읽어 `recipes/index.json`을 파일명 배열로 덮어씁니다.

3. 로컬 서버로 정상 노출되는지 확인 후 정적 파일을 그대로 배포합니다.

## 배포

GitHub Pages / Netlify / Cloudflare Pages 등 정적 파일을 그대로 서빙하는 호스팅이면 별도 빌드 과정 없이 저장소를 그대로 올리면 됩니다.

## 레시피 경로를 바꾸고 싶다면

`recipes/`가 아닌 다른 폴더명을 쓰고 싶다면 아래 세 곳을 함께 수정하세요.

- [assets/app.js](assets/app.js) 상단의 `MANIFEST_URL`, `RECIPES_DIR` 상수
- [gen-manifest.sh](gen-manifest.sh)의 `RECIPES_DIR` 변수
- [gen-manifest.ps1](gen-manifest.ps1)의 `$recipesDir` 변수

## 참고

- Markdown 렌더링: [marked](https://github.com/markedjs/marked) (CommonMark 호환 — 4칸 들여쓰기 중첩 리스트 포함)
- YAML frontmatter 파싱: [js-yaml](https://github.com/nodeca/js-yaml)
- HTML sanitize: [DOMPurify](https://github.com/cure53/DOMPurify)
- 세 라이브러리 모두 jsDelivr CDN에서 특정 버전으로 고정해 불러옵니다 ([index.html](index.html) `<head>` 참고).
- frontmatter 파싱이 실패하거나 `name`이 없는 레시피는 목록에 오류로 표시되며, 상세 페이지에서 "원문 보기"로는 항상 열립니다.
