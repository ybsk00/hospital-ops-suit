/**
 * 서울온케어 Google Sheets → 웹 DB 동기화 Apps Script
 *
 * 배포 방법:
 * 1. Google Sheets에서 [확장 프로그램] → [Apps Script] 열기
 * 2. 이 코드를 Code.gs에 붙여넣기
 * 3. CONFIG 섹션의 SERVER_URL, API_KEY 수정
 * 4. [트리거] → [트리거 추가] 클릭:
 *    - 함수: syncToServer
 *    - 이벤트 소스: 시간 기반 트리거
 *    - 유형: 분 타이머
 *    - 간격: 5분마다
 * 5. 권한 승인 후 자동 실행 시작
 *
 * 동작 원리:
 * - 5분마다 syncToServer() 실행
 * - onEdit() 트리거로 마지막 수정 시각 기록
 * - 마지막 성공 동기화 이후 수정이 없으면 스킵 (불필요한 호출 방지)
 * - 서버 웹훅에 POST 요청 → BullMQ 큐 등록 → Sheets API로 데이터 읽기 → DB 저장
 */

// ─── CONFIG ───
const CONFIG = {
  // 서버 웹훅 URL (Cloud Run 배포 후 수정)
  SERVER_URL: 'https://hospital-ops-api-783253438610.asia-northeast3.run.app/api/sheet-sync/webhook',

  // 로컬 개발 시:
  // SERVER_URL: 'http://localhost:4000/api/sheet-sync/webhook',

  // API 인증 키 (서버의 SHEET_SYNC_API_KEY와 동일하게 설정)
  API_KEY: 'your-sheet-sync-api-key-here',

  // 동기화 유형: 'FULL' 또는 'INCREMENTAL'
  SYNC_TYPE: 'FULL',
};

// ─── 시트 타입 자동 감지 ───
function detectSheetType() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = ss.getName().toLowerCase();

  if (name.includes('고주파') || name.includes('rf')) return 'rf';
  if (name.includes('도수') || name.includes('manual')) return 'manual';

  // 첫 번째 시트 내용으로 판단
  const sheet = ss.getSheets()[0];
  const data = sheet.getRange('A1:B5').getValues();
  const text = data.flat().join(' ');

  if (text.includes('기계') || text.includes('고주파')) return 'rf';
  if (text.includes('치료사') || text.includes('도수')) return 'manual';

  return 'unknown';
}

// ─── 메인 동기화 함수 (5분 트리거) ───
function syncToServer() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetId = ss.getId();
  const sheetType = detectSheetType();

  if (sheetType === 'unknown') {
    console.log('시트 유형을 감지할 수 없습니다.');
    return;
  }

  // 마지막 수정 시각 확인
  const props = PropertiesService.getScriptProperties();
  const lastSyncAt = props.getProperty('lastSyncAt');
  const lastEditedAt = props.getProperty('lastEditedAt');

  // 마지막 동기화 이후 수정이 없으면 스킵
  if (lastSyncAt && lastEditedAt && lastSyncAt >= lastEditedAt) {
    console.log('변경 없음 — 동기화 스킵');
    return;
  }

  try {
    const payload = {
      sheetId: sheetId,
      sheetTab: sheetType,
      syncType: CONFIG.SYNC_TYPE,
      lastEditedAt: lastEditedAt || new Date().toISOString(),
    };

    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'X-Sync-Key': CONFIG.API_KEY,
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    console.log('동기화 요청: ' + JSON.stringify(payload));

    const response = UrlFetchApp.fetch(CONFIG.SERVER_URL, options);
    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code === 202 || code === 200) {
      console.log('동기화 성공: ' + body);
      props.setProperty('lastSyncAt', new Date().toISOString());
    } else {
      console.error('동기화 실패 (' + code + '): ' + body);
    }
  } catch (e) {
    console.error('동기화 오류: ' + e.message);
  }
}

// ─── 수정 감지 트리거 ───
function onEdit(e) {
  // 마지막 수정 시각 기록
  const props = PropertiesService.getScriptProperties();
  props.setProperty('lastEditedAt', new Date().toISOString());
}

// ─── 수동 테스트용 ───
function testSync() {
  console.log('시트 유형: ' + detectSheetType());
  syncToServer();
}

// ─── 상태 확인 ───
function checkStatus() {
  const props = PropertiesService.getScriptProperties();
  console.log('lastSyncAt: ' + props.getProperty('lastSyncAt'));
  console.log('lastEditedAt: ' + props.getProperty('lastEditedAt'));
  console.log('sheetType: ' + detectSheetType());
}

// ─── 트리거 초기 설정 (최초 1회 실행) ───
function setupTriggers() {
  // 기존 트리거 제거
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  // 5분 간격 시간 트리거
  ScriptApp.newTrigger('syncToServer')
    .timeBased()
    .everyMinutes(5)
    .create();

  // 수정 감지 트리거
  ScriptApp.newTrigger('onEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();

  console.log('트리거 설정 완료: syncToServer(5분) + onEdit(수정감지)');
}
