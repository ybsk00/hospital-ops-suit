(function () {
  'use strict';

  // 설정
  var CHATBOT_URL = 'https://hospital-ops-web-wh5o42y5rq-du.a.run.app/patient-chatbot';
  var Z_INDEX = 2147483647;

  // 이미 로드된 경우 중복 방지
  if (window.__oncareEmbedLoaded) return;
  window.__oncareEmbedLoaded = true;

  // 상태
  var isOpen = false;
  var frame = null;
  var overlay = null;

  // 스타일 주입
  var style = document.createElement('style');
  style.textContent = [
    /* 오버레이 배경 */
    '#oncare-overlay {',
    '  position: fixed;',
    '  top: 0; left: 0; right: 0; bottom: 0;',
    '  z-index: ' + (Z_INDEX - 2) + ';',
    '  background: rgba(0, 0, 0, 0.4);',
    '  opacity: 0;',
    '  transition: opacity 0.3s ease;',
    '  pointer-events: none;',
    '}',
    '#oncare-overlay.oncare-visible {',
    '  opacity: 1;',
    '  pointer-events: auto;',
    '}',

    /* iframe 컨테이너 */
    '#oncare-embed-frame {',
    '  position: fixed;',
    '  bottom: 32px;',
    '  right: 32px;',
    '  z-index: ' + Z_INDEX + ';',
    '  width: 440px;',
    '  height: 680px;',
    '  max-height: calc(100vh - 80px);',
    '  border: none;',
    '  border-radius: 20px;',
    '  overflow: hidden;',
    '  box-shadow: 0 12px 48px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.1);',
    '  opacity: 0;',
    '  transform: translateY(20px) scale(0.95);',
    '  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);',
    '  pointer-events: none;',
    '  background: #fff;',
    '}',
    '#oncare-embed-frame.oncare-visible {',
    '  opacity: 1;',
    '  transform: translateY(0) scale(1);',
    '  pointer-events: auto;',
    '}',

    /* 닫기 버튼 */
    '#oncare-embed-close {',
    '  position: fixed;',
    '  bottom: 700px;',
    '  right: 36px;',
    '  z-index: ' + Z_INDEX + ';',
    '  width: 36px;',
    '  height: 36px;',
    '  border-radius: 50%;',
    '  border: none;',
    '  background: rgba(0,0,0,0.6);',
    '  color: #fff;',
    '  font-size: 20px;',
    '  cursor: pointer;',
    '  display: none;',
    '  align-items: center;',
    '  justify-content: center;',
    '  transition: background 0.2s;',
    '}',
    '#oncare-embed-close:hover { background: rgba(0,0,0,0.8); }',
    '#oncare-embed-close.oncare-visible { display: flex; }',

    /* 모바일 반응형 */
    '@media (max-width: 768px) {',
    '  #oncare-embed-frame {',
    '    top: 0; left: 0; right: 0; bottom: 0;',
    '    width: 100%; height: 100%;',
    '    max-height: 100%;',
    '    border-radius: 0;',
    '  }',
    '  #oncare-embed-close {',
    '    top: 12px; right: 12px; bottom: auto;',
    '  }',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  // DOM 요소 생성
  function createElements() {
    overlay = document.createElement('div');
    overlay.id = 'oncare-overlay';
    overlay.addEventListener('click', close);
    document.body.appendChild(overlay);

    frame = document.createElement('iframe');
    frame.id = 'oncare-embed-frame';
    frame.src = CHATBOT_URL;
    frame.allow = 'microphone';
    frame.setAttribute('aria-label', '서울온케어 AI 상담');
    document.body.appendChild(frame);

    var closeBtn = document.createElement('button');
    closeBtn.id = 'oncare-embed-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', '상담창 닫기');
    closeBtn.addEventListener('click', close);
    document.body.appendChild(closeBtn);
  }

  function open() {
    if (!frame) createElements();
    isOpen = true;
    overlay.classList.add('oncare-visible');
    frame.classList.add('oncare-visible');
    document.getElementById('oncare-embed-close').classList.add('oncare-visible');
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove('oncare-visible');
    frame.classList.remove('oncare-visible');
    document.getElementById('oncare-embed-close').classList.remove('oncare-visible');
  }

  function toggle() {
    isOpen ? close() : open();
  }

  // ESC 키로 닫기
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) close();
  });

  // 글로벌 API 노출
  window.OncareChatbot = {
    open: open,
    close: close,
    toggle: toggle,
  };
})();
