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
    /* 플로팅 버튼 */
    '#oncare-chat-btn {',
    '  position: fixed;',
    '  bottom: 32px;',
    '  right: 32px;',
    '  z-index: ' + Z_INDEX + ';',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 8px;',
    '  padding: 14px 24px;',
    '  background: linear-gradient(135deg, #2A9D8F 0%, #21867A 100%);',
    '  color: #fff;',
    '  border: none;',
    '  border-radius: 50px;',
    '  cursor: pointer;',
    '  font-size: 15px;',
    '  font-weight: 700;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    '  box-shadow: 0 4px 20px rgba(42, 157, 143, 0.4), 0 2px 8px rgba(0,0,0,0.15);',
    '  transition: all 0.3s ease;',
    '  animation: oncare-pulse 2s infinite;',
    '  letter-spacing: 0.5px;',
    '}',
    '#oncare-chat-btn:hover {',
    '  transform: translateY(-2px);',
    '  box-shadow: 0 6px 28px rgba(42, 157, 143, 0.5), 0 4px 12px rgba(0,0,0,0.2);',
    '}',
    '#oncare-chat-btn.oncare-open {',
    '  animation: none;',
    '  background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);',
    '  box-shadow: 0 4px 20px rgba(231, 76, 60, 0.4), 0 2px 8px rgba(0,0,0,0.15);',
    '  padding: 14px 20px;',
    '}',
    '#oncare-chat-btn.oncare-open:hover {',
    '  box-shadow: 0 6px 28px rgba(231, 76, 60, 0.5), 0 4px 12px rgba(0,0,0,0.2);',
    '}',

    /* 채팅 아이콘 SVG */
    '#oncare-chat-btn .oncare-icon {',
    '  width: 22px;',
    '  height: 22px;',
    '  flex-shrink: 0;',
    '}',

    /* 맥박 애니메이션 */
    '@keyframes oncare-pulse {',
    '  0% { box-shadow: 0 4px 20px rgba(42, 157, 143, 0.4), 0 0 0 0 rgba(42, 157, 143, 0.4); }',
    '  70% { box-shadow: 0 4px 20px rgba(42, 157, 143, 0.4), 0 0 0 12px rgba(42, 157, 143, 0); }',
    '  100% { box-shadow: 0 4px 20px rgba(42, 157, 143, 0.4), 0 0 0 0 rgba(42, 157, 143, 0); }',
    '}',

    /* iframe 컨테이너 */
    '#oncare-chat-frame {',
    '  position: fixed;',
    '  bottom: 100px;',
    '  right: 32px;',
    '  z-index: ' + (Z_INDEX - 1) + ';',
    '  width: 440px;',
    '  height: 680px;',
    '  max-height: calc(100vh - 140px);',
    '  border: none;',
    '  border-radius: 20px;',
    '  overflow: hidden;',
    '  box-shadow: 0 12px 48px rgba(0,0,0,0.2), 0 4px 16px rgba(0,0,0,0.1);',
    '  opacity: 0;',
    '  transform: translateY(20px) scale(0.95);',
    '  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);',
    '  pointer-events: none;',
    '  background: #fff;',
    '}',
    '#oncare-chat-frame.oncare-visible {',
    '  opacity: 1;',
    '  transform: translateY(0) scale(1);',
    '  pointer-events: auto;',
    '}',

    /* 모바일 반응형 */
    '@media (max-width: 768px) {',
    '  #oncare-chat-btn {',
    '    bottom: 20px;',
    '    right: 20px;',
    '    padding: 12px 20px;',
    '    font-size: 14px;',
    '  }',
    '  #oncare-chat-frame {',
    '    top: 0;',
    '    left: 0;',
    '    right: 0;',
    '    bottom: 0;',
    '    width: 100%;',
    '    height: 100%;',
    '    max-height: 100%;',
    '    border-radius: 0;',
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
  btn.setAttribute('aria-label', '서울온케어 AI 상담 열기');
  document.body.appendChild(btn);

  // iframe 생성 (lazy)
  var frame = null;

  function createFrame() {
    frame = document.createElement('iframe');
    frame.id = 'oncare-chat-frame';
    frame.src = CHATBOT_URL;
    frame.allow = 'microphone';
    frame.setAttribute('aria-label', '서울온케어 AI 상담');
    document.body.appendChild(frame);
  }

  function toggle() {
    if (!frame) createFrame();

    isOpen = !isOpen;

    if (isOpen) {
      frame.classList.add('oncare-visible');
      btn.classList.add('oncare-open');
      btn.innerHTML = closeIconSVG + '<span>닫기</span>';
      btn.setAttribute('aria-label', '상담창 닫기');
    } else {
      frame.classList.remove('oncare-visible');
      btn.classList.remove('oncare-open');
      btn.innerHTML = chatIconSVG + '<span>' + BUTTON_TEXT + '</span>';
      btn.setAttribute('aria-label', '서울온케어 AI 상담 열기');
    }
  }

  btn.addEventListener('click', toggle);

  // ESC 키로 닫기
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) {
      toggle();
    }
  });
})();
