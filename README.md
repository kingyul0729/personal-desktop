
  # 가상 OS 웹 디자인 (Community)

  This is a code bundle for 가상 OS 웹 디자인 (Community). The original project is available at https://www.figma.com/design/59aD5Su3OkYq5MGjElA4dz/%EA%B0%80%EC%83%81-OS-%EC%9B%B9-%EB%94%94%EC%9E%90%EC%9D%B8--Community-.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

## 공부 보관함

공부 기록은 기존 `study_records`와 `study_attachments`에 사용자별로 저장합니다.
기존 메모장·가격표·파일·휴지통 및 공부 기록은 그대로 유지합니다.

- 분류별 보관, 제목·본문·태그 검색, 즐겨찾기, 기록 수정·분류 이동, 삭제한 기록 복원
- 새 분류는 기록 편집의 분류 입력란에 입력하여 저장
- 보관함과 분리된 코넬식 문서 열람, 제목·소제목·본문·비교표·이미지·PDF 표시
- 본문 글자 크기 조절, 소제목·목록·표 삽입, 강조 색상
- 800KB 이하 `.md`, `.markdown`, `.txt` 가져오기 (본문 최대 10만 자)
- 기존 이미지·PDF 첨부 유지. 가져온 Markdown의 외부 이미지 문법은 자동으로 다운로드하지 않으므로 이미지는 첨부 기능으로 추가
- 저장 버튼 또는 Ctrl/Cmd+S로 서버 저장. 저장 전 이동·창 닫기 확인 및 수정 충돌 방지

운영 중인 0007·0008 마이그레이션과 기존 저장 구조를 사용합니다. 별도의 중복 공부 테이블은 만들지 않습니다.
