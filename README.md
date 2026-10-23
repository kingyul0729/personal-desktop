
  # 가상 OS 웹 디자인 (Community)

  This is a code bundle for 가상 OS 웹 디자인 (Community). The original project is available at https://www.figma.com/design/59aD5Su3OkYq5MGjElA4dz/%EA%B0%80%EC%83%81-OS-%EC%9B%B9-%EB%94%94%EC%9E%90%EC%9D%B8--Community-.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

## 공부 보관함

바탕화면 또는 시작 메뉴의 **공부 보관함**에서 개인 학습 자료를 관리합니다.

- 폴더 생성·이름 변경·빈 폴더 삭제, 폴더별 분류, 제목·본문 검색
- 새 노트 작성, `.md`·`.markdown`·`.txt` 파일 가져오기, 노트 제목·내용·폴더 수정
- 소제목·굵게·목록·비교표 서식 버튼, PNG·JPG·WebP 본문 이미지 삽입
- 목록과 분리된 문서 열람 화면, 본문 글자 크기 조절, 긴 문서 스크롤
- 공부노트 전용 휴지통과 원래 폴더로 복원

노트는 **저장** 버튼 또는 `Ctrl/Cmd+S`로 서버에 저장합니다. 자동 저장은 하지 않습니다.
저장 전 보관함으로 돌아가거나 창을 닫으면 변경사항 확인창이 표시됩니다.
저장 실패 시 작성 내용을 유지하며, 다른 창에서 변경된 노트는 덮어쓰지 않습니다.
로그인한 사용자의 자료만 조회·저장할 수 있습니다.

최소 구현 범위는 노트당 20만 자, 가져올 텍스트 파일 800KB, 이미지당 8MB입니다.
PDF·Word 변환, 하위 폴더, 영구 삭제 및 사용하지 않는 첨부 이미지 자동 정리는 포함하지 않습니다.
HTML은 실행하지 않으며, 외부 이미지는 HTTPS 주소만 허용합니다.

### 저장 구조와 배포

기존 D1의 `DB`, R2의 `BUCKET` 바인딩을 사용합니다. `study_folders`, `study_notes`,
`study_assets`만 추가하며 메모·가격표·일반 파일·기존 휴지통 데이터는 재분류하거나 수정하지 않습니다.
공부 이미지의 객체 키는 `study-assets/` 아래에 저장됩니다.

배포 전에 `drizzle/0007_right_doctor_octopus.sql`의 추가 마이그레이션을 적용해야 합니다.
기존 마이그레이션은 변경하지 않았습니다. 빌드는 `worker/study.js`와 마이그레이션을
기존 배포 산출물에 포함하며, 호스팅 식별자와 접근 범위는 그대로 유지합니다.

Node.js 24에서 `npm ci`, `npm test`, `npm run build`로 검증할 수 있습니다.
테스트는 실제 SQLite를 사용해 사용자별 접근 제한, 버전 충돌, 이동·복원,
기존 데이터 보존, 이미지 검증, Markdown의 문서 구조와 HTML 실행 방지를 확인합니다.
