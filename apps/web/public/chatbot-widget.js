(function () {
  'use strict';

  // 설정
  var CHATBOT_URL = 'https://hospital-ops-web-wh5o42y5rq-du.a.run.app/patient-chatbot';
  var BUTTON_TEXT = '24시간상담';
  var Z_INDEX = 2147483647;

  // 이미 로드된 경우 중복 방지
  if (window.__oncareWidgetLoaded) return;
  window.__oncareWidgetLoaded = true;

  // 상태
  var isOpen = false;

  // 스타일 주입
  var style = document.createElement('style');
  style.textContent = [
    /* 플로팅 버튼 — #F2871F 오렌지 (기존 사이드바와 동일) */
    '#oncare-chat-btn {',
    '  position: fixed;',
    '  bottom: 190px;',
    '  right: 32px;',
    '  z-index: ' + Z_INDEX + ';',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 8px;',
    '  padding: 14px 24px;',
    '  background: #F2871F;',
    '  color: #fff;',
    '  border: none;',
    '  border-radius: 50px;',
    '  cursor: pointer;',
    '  font-size: 15px;',
    '  font-weight: 700;',
    '  font-family: "Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    '  box-shadow: 0 0 17px rgba(242, 135, 31, 0.6), 0 4px 12px rgba(0,0,0,0.15);',
    '  transition: all 0.3s ease;',
    '  animation: oncare-pulse 2s infinite;',
    '  letter-spacing: -0.02em;',
    '}',
    '#oncare-chat-btn:hover {',
    '  transform: translateY(-2px);',
    '  box-shadow: 0 0 25px rgba(242, 135, 31, 0.8), 0 6px 16px rgba(0,0,0,0.2);',
    '}',
    '#oncare-chat-btn.oncare-open {',
    '  animation: none;',
    '  background: #555;',
    '  box-shadow: 0 4px 12px rgba(0,0,0,0.3);',
    '  padding: 14px 20px;',
    '}',
    '#oncare-chat-btn.oncare-open:hover {',
    '  box-shadow: 0 6px 16px rgba(0,0,0,0.4);',
    '}',

    /* 채팅 아이콘 SVG */
    '#oncare-chat-btn .oncare-icon {',
    '  width: 22px;',
    '  height: 22px;',
    '  flex-shrink: 0;',
    '}',

    /* 펄스 애니메이션 — 오렌지 글로우 */
    '@keyframes oncare-pulse {',
    '  0% { box-shadow: 0 0 17px rgba(242, 135, 31, 0.6), 0 0 0 0 rgba(242, 135, 31, 0.4); }',
    '  70% { box-shadow: 0 0 17px rgba(242, 135, 31, 0.6), 0 0 0 12px rgba(242, 135, 31, 0); }',
    '  100% { box-shadow: 0 0 17px rgba(242, 135, 31, 0.6), 0 0 0 0 rgba(242, 135, 31, 0); }',
    '}',

    /* 오버레이 배경 */
    '#oncare-overlay {',
    '  position: fixed;',
    '  top: 0; left: 0; right: 0; bottom: 0;',
    '  z-index: ' + (Z_INDEX - 2) + ';',
    '  background: rgba(0, 0, 0, 0.5);',
    '  opacity: 0;',
    '  transition: opacity 0.3s ease;',
    '  pointer-events: none;',
    '}',
    '#oncare-overlay.oncare-visible {',
    '  opacity: 1;',
    '  pointer-events: auto;',
    '}',

    /* iframe — 데스크탑: 화면 중앙 큰 사이즈 */
    '#oncare-chat-frame {',
    '  position: fixed;',
    '  top: 50%;',
    '  left: 50%;',
    '  transform: translate(-50%, -50%) scale(0.95);',
    '  z-index: ' + (Z_INDEX - 1) + ';',
    '  width: 90vw;',
    '  max-width: 1100px;',
    '  height: 85vh;',
    '  border: none;',
    '  border-radius: 20px;',
    '  overflow: hidden;',
    '  box-shadow: 0 20px 60px rgba(0,0,0,0.3);',
    '  opacity: 0;',
    '  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);',
    '  pointer-events: none;',
    '  background: #fff;',
    '}',
    '#oncare-chat-frame.oncare-visible {',
    '  opacity: 1;',
    '  transform: translate(-50%, -50%) scale(1);',
    '  pointer-events: auto;',
    '}',

    /* 모바일 반응형 */
    '@media (max-width: 768px) {',
    '  #oncare-chat-btn {',
    '    bottom: 84px;',
    '    right: 20px;',
    '    padding: 12px 20px;',
    '    font-size: 14px;',
    '  }',
    '  #oncare-chat-frame {',
    '    top: 0; left: 0; right: 0; bottom: 0;',
    '    width: 100%; height: 100%;',
    '    max-width: 100%;',
    '    transform: none;',
    '    border-radius: 0;',
    '    opacity: 0;',
    '    transition: opacity 0.3s ease;',
    '  }',
    '  #oncare-chat-frame.oncare-visible {',
    '    opacity: 1;',
    '    transform: none;',
    '  }',
    '  #oncare-chat-btn.oncare-open {',
    '    top: 12px;',
    '    bottom: auto;',
    '    right: 12px;',
    '    padding: 10px 16px;',
    '    border-radius: 50px;',
    '    font-size: 13px;',
    '  }',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  // 채팅 아이콘 SVG
  var chatIconSVG = '<svg class="oncare-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M21 11.5C21 16.75 16.75 21 11.5 21C9.8 21 8.2 20.55 6.8 19.75L2 21L3.25 16.2C2.45 14.8 2 13.2 2 11.5C2 6.25 6.25 2 11.5 2C16.75 2 21 6.25 21 11.5Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M8 10.5H15" stroke="white" stroke-width="2" stroke-linecap="round"/>'
    + '<path d="M8 14H12" stroke="white" stroke-width="2" stroke-linecap="round"/>'
    + '</svg>';

  var closeIconSVG = '<svg class="oncare-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M18 6L6 18" stroke="white" stroke-width="2.5" stroke-linecap="round"/>'
    + '<path d="M6 6L18 18" stroke="white" stroke-width="2.5" stroke-linecap="round"/>'
    + '</svg>';

  // 플로팅 버튼 생성
  var btn = document.createElement('button');
  btn.id = 'oncare-chat-btn';
  btn.innerHTML = chatIconSVG + '<span>' + BUTTON_TEXT + '</span>';
  btn.setAttribute('aria-label', '서울온케어 24시상담 열기');
  document.body.appendChild(btn);

  // iframe 생성 (lazy)
  var frame = null;
  var overlay = null;

  function createFrame() {
    overlay = document.createElement('div');
    overlay.id = 'oncare-overlay';
    overlay.addEventListener('click', function () { if (isOpen) toggle(); });
    document.body.appendChild(overlay);

    frame = document.createElement('iframe');
    frame.id = 'oncare-chat-frame';
    frame.src = CHATBOT_URL;
    frame.allow = 'microphone';
    frame.setAttribute('aria-label', '서울온케어 24시상담');
    document.body.appendChild(frame);
  }

  function toggle() {
    if (!frame) createFrame();

    isOpen = !isOpen;

    if (isOpen) {
      overlay.classList.add('oncare-visible');
      frame.classList.add('oncare-visible');
      btn.classList.add('oncare-open');
      btn.innerHTML = closeIconSVG + '<span>닫기</span>';
      btn.setAttribute('aria-label', '상담창 닫기');
    } else {
      overlay.classList.remove('oncare-visible');
      frame.classList.remove('oncare-visible');
      btn.classList.remove('oncare-open');
      btn.innerHTML = chatIconSVG + '<span>' + BUTTON_TEXT + '</span>';
      btn.setAttribute('aria-label', '서울온케어 24시상담 열기');
    }
  }

  btn.addEventListener('click', toggle);

  // iframe 내부 챗봇에서 X 버튼 클릭 시 닫기
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'closeChatbot' && isOpen) {
      toggle();
    }
  });

  // ESC 키로 닫기
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) {
      toggle();
    }
  });
})();
