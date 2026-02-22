# Google Sheets 동기화 설정 가이드

## 1. Google Cloud Service Account 설정

### 1.1 서비스 계정 생성
1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. 프로젝트 선택 (또는 새로 생성)
3. **IAM & Admin** → **Service Accounts** → **Create Service Account**
4. 이름: `hospital-sheet-sync`
5. 역할: 없음 (Sheets API만 사용)
6. **Done** 클릭

### 1.2 키 생성
1. 생성된 서비스 계정 클릭
2. **Keys** 탭 → **Add Key** → **Create new key** → **JSON**
3. 다운로드된 JSON 파일 내용을 `GOOGLE_SHEETS_SA_KEY` 환경변수에 설정

### 1.3 Google Sheets API 활성화
1. **APIs & Services** → **Library**
2. "Google Sheets API" 검색 → **Enable**

### 1.4 시트 공유
1. 고주파예약현황 스프레드시트 열기
2. **공유** → 서비스 계정 이메일 추가 (예: `hospital-sheet-sync@project.iam.gserviceaccount.com`)
3. 권한: **편집자** (write-back 필요)
4. 도수예약현황 스프레드시트도 동일하게 공유

## 2. 환경변수 설정 (.env)

```env
# Google Sheets Service Account 키 (JSON 전체를 한 줄로)
GOOGLE_SHEETS_SA_KEY='{"type":"service_account","project_id":"...","private_key":"...",...}'

# 스프레드시트 ID (URL의 /d/ 뒤 부분)
# 예: https://docs.google.com/spreadsheets/d/ABC123/edit → ID = ABC123
RF_SPREADSHEET_ID=고주파_스프레드시트_ID
MANUAL_SPREADSHEET_ID=도수_스프레드시트_ID

# 웹훅 인증 키 (임의 생성, Apps Script와 동일하게 설정)
SHEET_SYNC_API_KEY=your-secure-random-key
```

## 3. Apps Script 배포

### 3.1 고주파 시트
1. 고주파예약현황 스프레드시트 열기
2. **확장 프로그램** → **Apps Script**
3. `apps-script-sync.js` 내용을 `Code.gs`에 붙여넣기
4. `CONFIG.API_KEY`를 서버의 `SHEET_SYNC_API_KEY`와 동일하게 설정
5. `CONFIG.SERVER_URL`을 실제 서버 URL로 수정
6. **저장** → `testSync()` 함수 실행 → 권한 승인
7. `setupTriggers()` 함수 실행 (트리거 자동 등록)

### 3.2 도수 시트
1. 도수예약현황 스프레드시트에서 동일 과정 반복

## 4. 검증

### 4.1 수동 테스트
```bash
# 웹훅 직접 호출 (RF)
curl -X POST http://localhost:4000/api/sheet-sync/webhook \
  -H "Content-Type: application/json" \
  -H "X-Sync-Key: your-sheet-sync-api-key" \
  -d '{"sheetId":"RF_SPREADSHEET_ID","sheetTab":"rf","syncType":"FULL"}'

# 웹훅 직접 호출 (Manual)
curl -X POST http://localhost:4000/api/sheet-sync/webhook \
  -H "Content-Type: application/json" \
  -H "X-Sync-Key: your-sheet-sync-api-key" \
  -d '{"sheetId":"MANUAL_SPREADSHEET_ID","sheetTab":"manual","syncType":"FULL"}'
```

### 4.2 동기화 로그 확인
```bash
# 로그 조회 (인증 필요)
curl http://localhost:4000/api/sheet-sync/logs \
  -H "Authorization: Bearer ACCESS_TOKEN"

# 미매칭 건수 확인
curl http://localhost:4000/api/sheet-sync/pending-count \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

### 4.3 Apps Script에서 확인
1. Apps Script 에디터에서 `checkStatus()` 실행
2. `lastSyncAt`과 `lastEditedAt` 확인
3. 실행 로그에서 성공/실패 여부 확인

## 5. 동기화 흐름

```
Google Sheets 수정
  → onEdit() → lastEditedAt 기록
  → 5분 트리거 → syncToServer()
  → lastSyncAt < lastEditedAt? → POST /api/sheet-sync/webhook
  → BullMQ 큐 (또는 인라인)
  → Google Sheets API readFullTab()
  → parseRfScheduleRows() / parseManualTherapyRows()
  → contentHash 비교 → 변경 없으면 스킵
  → RfScheduleSaver.upsertSlots() / ManualTherapySaver.upsertSlots()
  → SyncLogger 기록 → 완료
```

## 6. 탭 이름 규칙

서버가 Google Sheets API로 데이터를 읽을 때 사용하는 탭 이름:
- RF: `고주파` (sheetSyncQueue.ts에서 설정)
- Manual: `도수`

실제 시트의 탭 이름이 다르면 `sheetSyncQueue.ts`의 `tabName` 변수를 수정하세요.

## 7. 주의사항

- 서비스 계정 이메일이 시트에 공유되어야 읽기/쓰기 가능
- `GOOGLE_SHEETS_SA_KEY`는 JSON 전체를 한 줄 문자열로 설정
- Apps Script 트리거는 시트별로 따로 설정
- contentHash가 동일하면 DB 쓰기를 건너뛰어 불필요한 부하 방지
- isManualOverride=true인 슬롯은 시트 동기화에서 보호됨 (웹 수동 수정 우선)
