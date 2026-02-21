/**
 * parse-csv-migration.ts
 *
 * Parses Google Sheets CSV exports for hospital scheduling data and generates SQL INSERT statements.
 *
 * Handles 3 types:
 * 1. RF Schedule -> RfScheduleSlot
 * 2. Manual Therapy -> ManualTherapySlot
 * 3. Outpatient Appointments -> Appointment
 *
 * Usage: npx tsx scripts/parse-csv-migration.ts > migration.sql
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Configuration
// ============================================

const BASE_DIR = path.resolve(__dirname, '../../../../새 폴더');

const RF_FILES = [
  path.join(BASE_DIR, '고주파예약현황', '고주파예약현황 - 26.02.csv'),
  path.join(BASE_DIR, '고주파예약현황', '고주파예약현황 - 26.03.csv'),
];

const MANUAL_FILES = [
  path.join(BASE_DIR, '도수예약현황', '도수예약현황 - 26.2월.csv'),
  path.join(BASE_DIR, '도수예약현황', '도수예약현황 - 26.3월.csv'),
];

const OUTPATIENT_FILES = [
  path.join(BASE_DIR, '외래환자 예약현황', '외래환자 예약 - 26.2월.csv'),
  path.join(BASE_DIR, '외래환자 예약현황', '외래환자 예약- 26.3.csv'),
];

const RF_ROOM_IDS: Record<string, string> = {
  '1': '52190b96-7a16-4d5c-812b-f39f7859e28d',
  '2': '9c184823-0742-4617-ae50-7938ac26322d',
  '3': '43191084-75da-430a-80ba-f9446d2a3952',
  '4': 'dd4fbc08-93a3-4704-91e4-1b72b8a9ba13',
  '5': '8b5cfd2d-54fc-4dc8-8ec1-d96a2ce69eef',
  '6': 'a6496aee-1af1-474a-932a-b3e043966855',
  '7': '64298b7c-cfe1-42d1-b81b-b2bc9773219a',
  '8': 'e22b551a-1ead-4ac7-a205-ff7ff69534e2',
  '9': '8090d396-b191-4b8a-aed3-e61b39e5e4f1',
  '10': '22610326-cea8-406f-8e3e-e7c697f95b83',
  '11': '02aedcd6-af2e-425d-a937-7db8158efafa',
  '12': '167ae8be-0972-4bca-b090-7a070f094160',
  '13': 'bbf38346-956a-4011-82ce-ba12dafdccdd',
  '14': '2d3d2d4b-cace-4fad-8c93-3c2c48e7e395',
  '15': '76ee3707-9166-405f-9cb3-1920c5822a11',
};

const THERAPIST_IDS: Record<string, string> = {
  '신예진': '06e25986-3c5a-4809-8947-0c20d1339944',
  '김한솔': '0cc503de-48a8-4799-82dd-7424a27bc01d',
  '김다현': '430e3184-eb8e-4111-9abc-b6f07b9f2191',
};

const DOCTOR_IDS: Record<string, string> = { 'C': 'doc-changyong', 'J': 'doc-jaeil' };

const PATIENT_MAP: Record<string, string> = {
  '감숙경': 'fc58d9f5-cded-4203-8ecd-b34abb6ca174',
  '강난희': 'pt-19711', '강대영': 'pt-21588', '강동석': 'pt-21244', '강순정': 'pt-22061',
  '강은진': 'd70c976e-1d70-439d-a438-6ac9a3c4afe6',
  '강지영': 'edd4a2dd-16df-4068-9c21-32b91eb4f5b0',
  '고미리': 'pt-20195', '고미숙': '7243bbf6-61f5-4547-83d0-a6c00ca931d9',
  '고영욱': 'pt-20589', '고은미': 'pt-21169',
  '고태욱': 'a1a1ac3b-13f7-4d43-b694-cd4c3dd2a404',
  '곽선아': 'pt-21017', '권미정': 'a041c958-0046-4b25-9fe3-ebe0bf49ee28',
  '권영길': '5b2347ee-2708-40d8-8b6e-397e85e33257', '권윤경': 'pt-20740',
  '김경숙': 'pt-22581', '김광성': 'pt-21399', '김근호': 'pt-20975',
  '김기숙': 'e2a05877-826a-42bf-9ea3-661d85133bcc', '김대호': 'pt-21954',
  '김덕임': 'pt-22096', '김명순': 'a8a84aee-2542-4c3c-81b3-29f54ca5efc2',
  '김명천': 'ac6d10cf-beb2-4df9-be5d-d461eee4f7fe', '김문봉': 'pt-17955',
  '김문한': 'pt-21731', '김미나': '2eb062b0-14ce-4635-ad98-065fd7da7403',
  '김미영': 'pt-20558', '김미혜': '9082a390-a372-45cb-8c42-c50d305d36ae',
  '김보라': '6f4f24ff-4742-471e-9287-31fd587225de', '김봉순': 'pt-16529',
  '김봉환': 'pt-20842', '김상희': 'pt-20707',
  '김석연': 'd130b707-e5d3-40e8-a540-5f5c7f978013', '김선미': 'pt-22792',
  '김성미': 'pt-22135', '김성임': '219a65d4-edeb-4265-bdd6-e91c327f9510',
  '김성희': 'pt-19120', '김소미': 'e402fe48-9c3c-43d7-ba4c-5b96b65129ec',
  '김소연': '7da3440b-b542-4d66-9245-ad28aebd8439',
  '김수경': 'fad30e7a-70fa-41b2-85a2-92479ec45478',
  '김순자': '2f922506-8852-4746-b696-8a2fe6c838ee',
  '김영란': '07720e6f-60f4-4180-93fb-fefb74b2df50',
  '김영민': 'a9c0741a-5210-4857-a9a6-ea1990498c78', '김영애': 'pt-21649',
  '김영조': 'pt-21347', '김영주': '13da7877-6897-4848-a1e0-d8669160011b',
  '김영호': '78c3bde2-3625-4c73-87c2-54ecbcaf7d56',
  '김유순': '04508269-2b0b-4457-af99-80ea1677b1a4',
  '김의형': '535a078e-4bc0-45aa-a2af-e961b6ded960', '김정태': 'pt-22570',
  '김종성': '7ddcffa5-c67c-4792-a242-760d3f13d8e3',
  '김준호': 'e01c2cce-5091-4013-8a94-d155b74f235b', '김진아': 'pt-21070',
  '김창수': '1e776c74-0464-4cd0-a846-6796ee338734',
  '김현진': '8b6f93c0-6d7e-44aa-a5f8-06aa2cf97c3c',
  '김형선': '0be38f28-8e97-405c-aa68-ec47047ef3ac', '김홍중': 'pt-20517',
  '김희정': 'f0139cf2-a61c-447c-b364-8649159d10c5',
  '김희진': '9d8b6b5f-3228-4648-ab46-e805b62626fb',
  '남궁옥화': '4e9d7ae2-52e7-4d7f-8c19-747ddad66550',
  '노은하': 'bb695437-ce27-475c-a00e-b313a9f60be3',
  '문수빈': '792ae7cc-1343-4320-819c-adf1dc8ace95',
  '문은경': '9cb8a59c-d63e-4ea6-94c3-ff2be091b7a7', '문주연': 'pt-21406',
  '민세정': '939f35d1-0232-4be3-98f3-4a9443ef0af3', '박경분': 'pt-15357',
  '박금숙': '204460a8-863c-4852-acc7-79a0329dad0f', '박미나': 'pt-22872',
  '박봉화': '3e2ad5fd-2761-409c-b02d-5860a7b4cc83',
  '박상훈': '6f82371d-db80-43fd-abc6-739db7dfd6ec',
  '박성철': 'd1dad7cd-8a68-4a20-9349-e427f5a1d8e4',
  '박송이': 'f0cda9b7-2c0b-4d2a-8b6d-d1c3f72341d0',
  '박수정': 'ce6951b3-e7ea-4c91-9aa1-153744c3ee01', '박영옥': 'pt-22801',
  '박용온': '3df5d760-10d1-481b-8b01-4aae5a57440a',
  '박윤희': '5a72ce3d-fdcf-4910-b282-edcf83f8f88a',
  '박재란': 'ef6858e5-27fc-4279-a947-312041e9c585',
  '박정민': '310c9ff7-d7a8-4909-b53b-f5c7db9b5b85',
  '박진희': '7cb48a13-b76a-4962-874a-5a072fe555f4', '박하연': 'pt-15730',
  '박해영': '17735da6-806e-47df-a23b-244118b822f4',
  '박혜경': '8ad4605e-7c7e-431c-a7ab-56d06b79d6e2',
  '서우원': '21fba2dd-45a7-4962-9ddf-73a47e8c2adf',
  '서인숙': '6a4460a0-395d-4482-8716-91da76fa289d',
  '성세화': '16a85ffd-75b6-4a1e-8727-7ada98bd6e2b',
  '성주상': '5eab77cd-484e-40ed-a9e2-8283e1586c65',
  '손제영': '400ee993-1215-42bf-b9de-338ac2a73467',
  '송미나': '43f5832f-f1d4-4bfd-8ad6-d5018480e952',
  '송승주': '06cfbaed-1b8c-414a-a3b5-c6cdaca97de9', '송은선': 'pt-21509',
  '송진욱': 'b8bdbe33-3310-4719-94cc-65426af86600',
  '송현숙': 'e2a63b95-82e5-493c-8a2c-a637b1bff950',
  '송현옥': '0602c2dc-fef6-4cd5-89dc-b1b9b28b7916',
  '신아림': 'f459153a-5735-427a-8cda-60b67f481e33',
  '신재경': 'a30adde6-2381-4642-968f-6989a24642ce', '심정훈': 'pt-20873',
  '양문호': 'b2c50173-a19e-42e0-bc80-167c764989e4',
  '양성훈': '5f17befd-c5ed-4b2c-9531-f2723d05930c',
  '양일준': '41eb8084-bde1-499c-8366-ca0df7f78bf1',
  '오은혜': 'a72ca268-56f8-41a8-943d-93b1a7064590',
  '오지연': '35fbf679-a630-4f7c-b41b-5bd81c7a14d4', '오지영': 'pt-22483',
  '왕원영': 'pt-22704', '우명철': '2f1fbd4d-4d84-4a84-b958-682d1131d2f1',
  '우혜나': '46898e91-4074-4851-a443-2088ca3a24be',
  '원화자': 'a57aa2e1-3d1b-4680-81ca-0335c0a0ea34',
  '윤숙': '870c217d-c239-4275-98d6-2009bb84d638', '윤여경': 'pt-22312',
  '윤재익': '3f7b0ea5-f551-4637-86f0-2de51647aae2',
  '윤찬호': '0b31733a-b15f-4512-8871-2afaff768b04', '이경옥': 'pt-14899',
  '이경회': 'bc30e9e0-7fe4-41c9-acb4-3809e3bc91ba',
  '이명희': 'afe39cd0-6e49-410b-8af5-49c7989100b8', '이보경': 'pt-10315',
  '이석희': 'a07b2d73-0266-408c-9dd0-152f8ba84a86', '이성우': 'pt-20799',
  '이수영': '856a570e-266b-4c38-b562-dac67fcf5740',
  '이수정': 'f31b365b-2b80-4db6-8615-1bb2d223ffbe',
  '이양임': 'd95c43ec-e7bc-4001-9cb8-287e89f9c4f1',
  '이영진': 'ac646649-6037-4002-80be-beb4ead371a2',
  '이우순': '61238bec-60cb-4d3f-9d3a-89d0434b7423',
  '이운선': '6859231a-f6b9-43d2-b5bf-24d6fddeb106',
  '이은지': '2bb9a61d-b92f-4fd5-bc14-a07bc23aa954', '이정근': 'pt-17602',
  '이정애': '7a0c0319-6fa3-47f1-8884-4363ca2d674a',
  '이종훈': 'f8807247-4c48-400b-9a07-972bafe58185', '이주범': 'pt-21791',
  '이채경': '3b02ee09-b06b-41f5-899b-87d1dfc9fa1e', '이태호': 'pt-20375',
  '이현수': '50458446-6602-4775-a612-8120cc6cb9bf',
  '이현진': 'ef646207-89e2-4f9d-bf53-61799cd7f4ed',
  '이혜연': '36fdeba5-2cd6-4167-a44c-fd6cad984c0b', '임상순': 'pt-20386',
  '임영숙': 'pt-17193', '임영희': 'bdd9ea8f-5d34-44ef-bc61-5a32b523f425',
  '임찬정': '3ffd7867-59d3-4506-a2c5-8c9e325ffabd',
  '임현아': 'b99c9a09-fe8c-4e70-9689-51b4b0b3623c',
  '장보인': '1bfc00ac-ff3d-4dd4-b75e-383ac353076d',
  '장수진': '137d2920-c0b0-4ef5-af6c-3183946caa65',
  '장의환': 'a8d3f909-2fbf-42a3-9ff4-2c951c4992ed', '장정숙': 'pt-20025',
  '장주리': '98be9254-8ff3-45de-b2f4-fdd9cbedd90f', '장진석': 'pt-16849',
  '장홍석': '919c4656-3916-4b72-92b5-b6cae4ad4809',
  '정나겸': '318d8ebe-6f8a-411d-bbb1-0041854e36ef',
  '정나영': '3cbae3bd-1aea-45de-bc1b-52a50a509722',
  '정남미': '04082782-16e3-4e70-b503-0c05da20de33',
  '정미숙': '6294705b-c23b-4b6b-8605-5719cfe7ac1f',
  '정석우': '667a5bc4-ac78-4bdb-9505-4377f2689b99',
  '정월숙': '411af886-4df9-4615-ad81-1ca5ad674b21',
  '정유미': 'e33d162e-807b-4de9-b84a-16465e7a372a',
  '정하율': '76326186-806a-4d0f-a7d1-98e34a75a3f1',
  '조경숙': '5904d759-ad43-4c6e-9b8e-c66d78d0e635',
  '조라숙': '089db272-1470-4d40-85e1-93602a9aa4fe',
  '조수민': '4762f1bd-d0a0-494f-b976-7b23e0588b65',
  '조영삼': 'c5ab1a8a-b441-4ce2-8ab1-e09edb6558b4', '조용안': 'pt-15452',
  '조정희': '0cde3c9c-81e0-4ca2-a5b7-904fa0ae6574',
  '조현정': 'e49b92d9-ebac-48a8-a66d-54ce33e60899', '조현주': 'pt-22791',
  '주성훈': 'c0a94a70-7d22-4ba1-88e1-d1bd6c89f40a',
  '지선영': 'ee550804-3796-4f9c-b29a-7aacb90b5b47',
  '채주아': 'bedeb55e-ed68-4d4b-9437-3440c210dd89',
  '최경석': '679210c0-f6c9-430b-bfc8-f449c14dd53d',
  '최경희': '11327e29-910c-41b7-9bd1-e72336081bed',
  '최광혜': 'b453298a-f799-448a-b231-b1f64b0d1361',
  '최명희': '4bc9014f-219f-4265-bcea-f25b5eb646b1',
  '최선희': 'b8bd0859-0d50-4e68-91a5-cda9f3da08ee',
  '최승필': 'a6d8c557-f80b-474d-9aa2-4a460efac116',
  '최예진': 'acb90ebc-8219-41e8-8e29-287148d25fd7',
  '최윤경': 'e48a512d-f67b-4098-9955-c01821af084c',
  '최윤채': '29eb4516-3814-4967-a699-7ec5c2627b1e',
  '최정임': '4ac42a8d-8168-4381-9acc-2e43f62badd8',
  '최현승': 'a65bea30-0445-45e3-8eab-b96d9ec6d416', '추연경': 'pt-21481',
  '푸즈휘': '0b389b0d-c981-45be-9cfd-deec5fc3f663',
  '한규협': 'b38dffe3-a5e6-4a0f-9bab-16ea93fe786e', '한수정': 'pt-21611',
  '한정연': 'e4d1ef1b-352f-4086-a191-21bf3b3d29ee',
  '한진우': '3b5f79b2-57d5-459f-86ea-b92935e87d46', '한형도': 'pt-22285',
  '한홍일': 'pt-22760', '한희인': 'f32aca8d-e746-4d23-bf31-2a4e2750c467',
  '함영선': '3867f0e0-c25d-40d3-ba69-65bd5d5c6627',
  '함영호': 'd3495ea8-c2fb-4f85-af62-5c7206864007',
  '현봉조': '2ec7488e-8662-477f-8fb6-5786427e0451',
  '홍영훈': '97248850-0070-4f94-a189-23f2d4737c9b',
  '홍지현': '4e471043-17ec-4aa2-a633-d4754be45a90',
  '황유미': 'dc291fd9-9bc3-4d20-9e5a-eeeda1403d4b',
  '황인희': '565a5b9c-699a-4d9b-ad0d-814a5b991732',
};

// ============================================
// CSV Parsing
// ============================================

function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQ) {
      if (ch === '"') {
        if (i + 1 < content.length && content[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { currentRow.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && content[i + 1] === '\n')) {
        if (ch === '\r') i++;
        currentRow.push(field); field = ''; rows.push(currentRow); currentRow = [];
      } else if (ch === '\r') {
        currentRow.push(field); field = ''; rows.push(currentRow); currentRow = [];
      } else field += ch;
    }
  }
  if (field || currentRow.length > 0) { currentRow.push(field); rows.push(currentRow); }
  return rows;
}

function esc(s: string): string { return s.replace(/'/g, "''"); }
function isAllEmpty(row: string[]): boolean { return row.every(c => !c || !c.trim()); }

function findPatientId(rawName: string): string | null {
  let n = rawName.trim().replace(/^[CJcj]\s*/, '').replace(/\s*\([^)]*\)\s*$/, '');
  n = n.replace(/\d+$/, '').replace(/\/신$/, '').replace(/\/온$/, '').replace(/^[☆★]/, '').trim();
  return PATIENT_MAP[n] || null;
}

function cleanName(raw: string): string {
  let s = raw.trim().replace(/^[CJcj]\s*/, '').replace(/\s*\([^)]*\)\s*$/, '');
  return s.replace(/\/신$/, '').replace(/\/온$/, '').replace(/^[☆★]/, '').trim();
}

// ============================================
// RF Schedule Parser
// ============================================

interface RfSlot { roomNumber: string; date: string; startTime: string; duration: number; chartNumber: string; patientName: string; doctorCode: string; patientType: 'INPATIENT' | 'OUTPATIENT'; }

function parseRfSchedule(filePath: string, year: number): RfSlot[] {
  const rows = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const slots: RfSlot[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row && row[0]?.trim() === '휴무') {
      const dayDates = parseRfDates(row, year);
      i++;
      if (i >= rows.length) break;
      const layouts = parseRfLayout(rows[i]);
      if (layouts.length === 0) { i++; continue; }
      i++;
      let empty = 0;
      while (i < rows.length) {
        const r = rows[i];
        if (!r) { i++; empty++; if (empty > 5) break; continue; }
        if (r[0]?.trim() === '휴무') break;
        if (isAllEmpty(r)) { i++; empty++; if (empty > 10) break; continue; }
        empty = 0;
        for (let d = 0; d < layouts.length && d < dayDates.length; d++) {
          const ly = layouts[d]; const dt = dayDates[d];
          if (!ly || !dt) continue;
          const time = parseRfTime(r[ly.start]?.trim() || '');
          if (!time) continue;
          for (let m = 0; m < ly.count; m++) {
            const cell = r[ly.start + 1 + m]?.trim();
            if (!cell) continue;
            const bk = parseRfCell(cell);
            if (!bk) continue;
            slots.push({ roomNumber: (m + 1).toString(), date: dt, startTime: time, ...bk, patientType: bk.duration <= 90 ? 'OUTPATIENT' : 'INPATIENT' });
          }
        }
        i++;
      }
    } else i++;
  }
  return slots;
}

function parseRfDates(row: string[], yr: number): string[] {
  const d: string[] = [];
  for (const c of row) { if (!c) continue; const m = c.trim().match(/(\d{2})\.(\d{2})\s*\(/); if (m) d.push(`${yr}-${m[1]}-${m[2]}`); }
  return d;
}

function parseRfLayout(row: string[]): { start: number; count: number }[] {
  const r: { start: number; count: number }[] = [];
  let c = 0;
  while (c < row.length) {
    if (row[c]?.trim() === 'FALSE') {
      const s = c; let n = 0; c++;
      while (c < row.length && /^\d+$/.test(row[c]?.trim() || '')) { n++; c++; }
      if (n > 0) r.push({ start: s, count: n });
      if (c < row.length) c++;
    } else c++;
  }
  return r;
}

function parseRfTime(cell: string): string | null {
  const m = cell.match(/^(\d{1,2}):(\d{2})~/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function parseRfCell(cell: string): { chartNumber: string; patientName: string; doctorCode: string; duration: number } | null {
  const lines = cell.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2 || !/^\d+$/.test(lines[0])) return null;
  let doc = 'C', dur = 120;
  for (const l of lines) { const dm = l.match(/\(([CJcj])\)?/); if (dm) doc = dm[1].toUpperCase(); const dd = l.match(/(\d+)분/); if (dd) dur = parseInt(dd[1]); }
  return { chartNumber: lines[0], patientName: lines[1], doctorCode: doc, duration: dur };
}

// ============================================
// Manual Therapy Parser
// ============================================

interface ManualSlot { therapistName: string; date: string; timeSlot: string; duration: number; treatmentCodes: string[]; patientName: string; patientType: 'INPATIENT' | 'OUTPATIENT'; doctorCode: string | null; }

function parseManualTherapy(filePath: string): ManualSlot[] {
  const rows = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const slots: ManualSlot[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row && row[0]?.trim() === '치료사') {
      const dates = parseMDates(row);
      if (!dates.length) { i++; continue; }
      i++; if (i >= rows.length) break;
      const ther = parseMTherapists(rows[i], dates.length);
      i++;
      const last: Record<string, ManualSlot> = {};
      while (i < rows.length) {
        const r = rows[i];
        if (!r) { i++; continue; }
        if (r[0]?.trim() === '비고' || r[0]?.trim() === '치료사') break;
        if (isAllEmpty(r) || /^\d+월/.test(r[0]?.trim() || '')) { i++; continue; }
        for (let d = 0; d < dates.length; d++) {
          if (!dates[d]) continue;
          const base = d * 4;
          const time = parseMTime(r[base]?.trim() || '');
          if (!time) continue;
          const ts = ther[d] || [];
          for (let t = 0; t < ts.length; t++) {
            if (!ts[t]) continue;
            const cell = (r[base + 1 + t] || '').trim();
            if (!cell) continue;
            const key = `${d}-${t}`;
            if (isCont(cell)) { if (last[key]) last[key].duration += 30; continue; }
            if (isSkip(cell)) { delete last[key]; continue; }
            const bk = parseMCell(cell);
            if (!bk) { delete last[key]; continue; }
            const sl: ManualSlot = { therapistName: ts[t], date: dates[d], timeSlot: time, duration: 30, treatmentCodes: bk.codes, patientName: bk.name, patientType: 'INPATIENT', doctorCode: bk.doc };
            slots.push(sl); last[key] = sl;
          }
        }
        i++;
      }
    } else i++;
  }
  return slots;
}

function parseMDates(row: string[]): string[] {
  const d: string[] = [];
  for (const c of row) { if (!c) continue; const m = c.trim().match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/); if (m) d.push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`); }
  return d;
}

function parseMTherapists(row: string[], n: number): string[][] {
  const r: string[][] = [];
  for (let d = 0; d < n; d++) { const b = d * 4; const ns: string[] = []; for (let t = 1; t <= 3; t++) { const v = (row[b + t] || '').trim(); if (v) ns.push(v); } r.push(ns); }
  return r;
}

function parseMTime(cell: string): string | null {
  const m = cell.match(/^(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = parseInt(m[2]); if (m[1] === '오후' && h >= 1 && h <= 5) h += 12;
  return `${h.toString().padStart(2, '0')}:${m[3]}`;
}

function isCont(c: string): boolean {
  const s = c.trim();
  return /^-{2,}$/.test(s) || /^IN\s*\d*$/i.test(s) || /^IN\/LTU$/i.test(s) || /^IN!\s*$/i.test(s) || /^W\s*\d*$/i.test(s) || s === '--';
}

function isSkip(c: string): boolean {
  const s = c.trim().toLowerCase();
  if (!s) return true;
  return ['전산업무', '확인중', 'ltu', '공기압', 'tms'].includes(s) ||
    s.includes('취소') || s.includes('노쇼') || s.includes('대기') || s.includes('설날') ||
    s.includes('병원장님') || s.includes('반차') || s.includes('스타킹') ||
    /^\d+분\s*진행$/.test(s) || s.includes('시간진행') || /^off$/i.test(s);
}

function parseMCell(cell: string): { name: string; codes: string[]; doc: string | null } | null {
  let s = cell.trim();
  if (!s || s.length < 2) return null;
  let doc: string | null = null;
  const pfx = s.match(/^([CJcj])\s*(.+)/);
  if (pfx) { doc = pfx[1].toUpperCase(); s = pfx[2].trim(); }
  let codes: string[] = [];
  const tm = s.match(/\(([^)]+)\)\s*$/);
  if (tm) {
    s = s.replace(/\([^)]*\)\s*$/, '').trim();
    for (const p of tm[1].split('/').map(x => x.trim())) {
      if (p === '온' || p === '온열') codes.push('온열');
      else if (p === '림프' || p === '림') codes.push('림프');
      else if (p === '신') codes.push('신경');
      else if (p === '페인') codes.push('페인');
      else if (p === '통') codes.push('통증');
      else if (p === '도수') codes.push('도수');
      else if (p === '통림') { codes.push('통증'); codes.push('림프'); }
    }
  }
  if (s.includes('/온')) { if (!codes.includes('온열')) codes.push('온열'); s = s.replace('/온', ''); }
  if (!codes.length) codes.push('도수');
  let name = s.replace(/\d+$/, '').replace(/\/신$/, '').replace(/^[☆★]/, '').trim();
  if (!name || name.length < 2) return null;
  return { name, codes, doc };
}

// ============================================
// Outpatient Parser
// ============================================

interface OSlot { date: string; startTime: string; patientName: string; doctorCode: string | null; phone: string; notes: string; }

function parseOutpatient(filePath: string, year: number): OSlot[] {
  const rows = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const slots: OSlot[] = [];
  const PD = 6; // cols per day
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (!row) { i++; continue; }
    const hd = detectODates(row, year);
    if (hd.length >= 2) {
      i++; if (i < rows.length) i++; // skip col headers
      const curTime: (string | null)[] = hd.map(() => null);
      while (i < rows.length) {
        const r = rows[i];
        if (!r) { i++; continue; }
        if (isAllEmpty(r)) { i++; continue; }
        if (detectODates(r, year).length >= 2) break;
        if ((r[0] || '').trim().startsWith('★')) { i++; continue; }
        for (let d = 0; d < hd.length; d++) {
          if (!hd[d]) continue;
          const b = d * PD;
          const tc = (r[b] || '').trim();
          const nm = (r[b + 1] || '').trim();
          const dc = (r[b + 2] || '').trim();
          const ph = (r[b + 3] || '').trim();
          const ct = (r[b + 4] || '').trim();
          const pt = parseOTime(tc);
          if (pt) curTime[d] = pt;
          if (!nm || !curTime[d]) continue;
          if (nm === '이름/유형' || nm.includes('병원장님') || nm.includes('★')) continue;
          let ad: string | null = null;
          const dl = dc.trim().toLowerCase();
          if (dl === 'c') ad = 'C'; else if (dl === 'j') ad = 'J';
          else if (dl.includes('c') && dl.includes('정실')) ad = 'C';
          else if (dl.includes('j') && dl.includes('정실')) ad = 'J';
          else if (dl === '정실+c' || dl === 'c+정실') ad = 'C';
          else if (dl === '정실+j' || dl === 'j+정실') ad = 'J';
          let pn = nm.replace(/^\d{1,2}시\d{0,2}분?/, '').replace(/\d+$/, '').replace(/\/신$/, '').replace(/^[☆★]/, '').trim();
          if (!pn || pn.length < 2 || pn === 'ㅇㅎ') continue;
          slots.push({ date: hd[d], startTime: curTime[d]!, patientName: pn, doctorCode: ad, phone: ph, notes: ct.replace(/\n/g, ' ').trim() });
        }
        i++;
      }
    } else i++;
  }
  return slots;
}

function detectODates(row: string[], yr: number): string[] {
  const dates: string[] = []; let found = 0;
  for (const col of [1, 7, 13, 19, 25, 31]) {
    if (col >= row.length) { dates.push(''); continue; }
    const m = (row[col] || '').trim().match(/(\d{1,2})[./](\d{1,2})\s*\(/);
    if (m) { dates.push(`${yr}-${parseInt(m[1]).toString().padStart(2, '0')}-${parseInt(m[2]).toString().padStart(2, '0')}`); found++; }
    else dates.push('');
  }
  return found >= 2 ? dates : [];
}

function parseOTime(cell: string): string | null {
  const m = cell.match(/(오전|오후)\s*:?\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = parseInt(m[2]); if (m[1] === '오후' && h >= 1 && h <= 5) h += 12;
  return `${h.toString().padStart(2, '0')}:${m[3]}`;
}

// ============================================
// SQL Generation
// ============================================

function genRfSQL(slots: RfSlot[]): string[] {
  const lines: string[] = []; const seen = new Set<string>();
  for (const s of slots) {
    const rid = RF_ROOM_IDS[s.roomNumber]; if (!rid) continue;
    const key = `${rid}-${s.date}-${s.startTime}`; if (seen.has(key)) continue; seen.add(key);
    const cn = cleanName(s.patientName); const pid = findPatientId(s.patientName);
    lines.push(`INSERT INTO "RfScheduleSlot" (id, "roomId", "patientId", "doctorCode", date, "startTime", duration, "chartNumber", "patientName", "patientType", status, source, version, "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${rid}', ${pid ? `'${pid}'` : 'NULL'}, '${s.doctorCode}', '${s.date}', '${s.startTime}', ${s.duration}, '${esc(s.chartNumber)}', '${esc(cn)}', '${s.patientType}'::"PatientType", 'BOOKED'::"SlotStatus", 'MIGRATION'::text, 1, NOW(), NOW()) ON CONFLICT DO NOTHING;`);
  }
  return lines;
}

function genManualSQL(slots: ManualSlot[]): string[] {
  const lines: string[] = []; const seen = new Set<string>();
  for (const s of slots) {
    const tid = THERAPIST_IDS[s.therapistName]; if (!tid) continue;
    const key = `${tid}-${s.date}-${s.timeSlot}`; if (seen.has(key)) continue; seen.add(key);
    const pid = findPatientId(s.patientName);
    const codes = `ARRAY[${s.treatmentCodes.map(c => `'${esc(c)}'`).join(',')}]::text[]`;
    lines.push(`INSERT INTO "ManualTherapySlot" (id, "therapistId", "patientId", date, "timeSlot", duration, "treatmentCodes", "patientName", "patientType", status, source, version, "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${tid}', ${pid ? `'${pid}'` : 'NULL'}, '${s.date}', '${s.timeSlot}', ${s.duration}, ${codes}, '${esc(s.patientName)}', '${s.patientType}'::"PatientType", 'BOOKED'::"SlotStatus", 'MIGRATION'::text, 1, NOW(), NOW()) ON CONFLICT ("therapistId", date, "timeSlot") DO NOTHING;`);
  }
  return lines;
}

function genApptSQL(slots: OSlot[]): string[] {
  const lines: string[] = []; const seen = new Set<string>();
  for (const s of slots) {
    const [hh, mm] = s.startTime.split(':');
    let h = parseInt(hh) - 9; if (h < 0) h += 24;
    const sa = `${s.date} ${h.toString().padStart(2, '0')}:${mm}:00`;
    let eh = h, em = parseInt(mm) + 30; if (em >= 60) { eh++; em -= 60; }
    const ea = `${s.date} ${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}:00`;
    const cn = cleanName(s.patientName); const pid = findPatientId(s.patientName);
    const did = s.doctorCode ? DOCTOR_IDS[s.doctorCode.toUpperCase()] || null : null;
    const key = `${s.date}-${s.startTime}-${cn}`; if (seen.has(key)) continue; seen.add(key);
    const nt = s.notes ? esc(s.notes) : '';
    lines.push(`INSERT INTO "Appointment" (id, "patientId", "doctorId", "clinicRoomId", "startAt", "endAt", status, source, notes, version, "createdAt", "updatedAt") VALUES (gen_random_uuid(), ${pid ? `'${pid}'` : 'NULL'}, ${did ? `'${did}'` : 'NULL'}, NULL, '${sa}', '${ea}', 'BOOKED'::"AppointmentStatus", 'MIGRATION'::"AppointmentSource", ${nt ? `'${nt}'` : 'NULL'}, 1, NOW(), NOW()) ON CONFLICT DO NOTHING;`);
  }
  return lines;
}

// ============================================
// Main
// ============================================

function main() {
  const out: string[] = [];
  out.push('-- CSV Migration: RF Schedule, Manual Therapy, Outpatient');
  out.push('-- Generated: ' + new Date().toISOString());
  out.push('BEGIN;');
  out.push('');

  out.push('-- ======== RF Schedule ========');
  let tRf = 0;
  for (const fp of RF_FILES) {
    const fn = path.basename(fp);
    console.error(`[RF] ${fn}...`);
    try { const s = parseRfSchedule(fp, 2026); console.error(`[RF] ${s.length} raw`); const sql = genRfSQL(s); out.push(`-- ${fn}: ${sql.length}`); out.push(...sql); out.push(''); tRf += sql.length; }
    catch (e: any) { console.error(`[RF] ERR: ${e.message}`); }
  }

  out.push('-- ======== Manual Therapy ========');
  let tM = 0;
  for (const fp of MANUAL_FILES) {
    const fn = path.basename(fp);
    console.error(`[MT] ${fn}...`);
    try { const s = parseManualTherapy(fp); console.error(`[MT] ${s.length} raw`); const sql = genManualSQL(s); out.push(`-- ${fn}: ${sql.length}`); out.push(...sql); out.push(''); tM += sql.length; }
    catch (e: any) { console.error(`[MT] ERR: ${e.message}`); }
  }

  out.push('-- ======== Outpatient ========');
  let tA = 0;
  for (const fp of OUTPATIENT_FILES) {
    const fn = path.basename(fp);
    console.error(`[OP] ${fn}...`);
    try { const s = parseOutpatient(fp, 2026); console.error(`[OP] ${s.length} raw`); const sql = genApptSQL(s); out.push(`-- ${fn}: ${sql.length}`); out.push(...sql); out.push(''); tA += sql.length; }
    catch (e: any) { console.error(`[OP] ERR: ${e.message}`); }
  }

  out.push('COMMIT;');
  out.push(`-- TOTAL: RF=${tRf}, Manual=${tM}, Outpatient=${tA}, Grand=${tRf + tM + tA}`);
  console.log(out.join('\n'));
  console.error(`\n=== SUMMARY: RF=${tRf}, Manual=${tM}, Outpatient=${tA}, Total=${tRf + tM + tA} ===`);
}

main();
