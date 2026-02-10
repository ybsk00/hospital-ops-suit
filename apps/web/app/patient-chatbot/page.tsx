'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: YouTubeSource[];
  showBooking?: boolean;
  timestamp: Date;
}

interface YouTubeSource {
  title: string;
  source?: string;
  url?: string;
  thumbnail?: string;
}

// 봇 아바타 이미지 URL (원본과 동일)
const BOT_AVATAR = 'https://lh3.googleusercontent.com/aida-public/AB6AXuC-g9ytL4eiKM2FOpV_1_gUslXLFwlL8Je31H90b5t7-F011XIcIvf9Uijc0yPLVIGVvT4OQEdAu4BCrRQesABH9wa7h2u0CPTt7sFxdlSfLtBg_A0UgSQr1S4N6E3RhBfkRc0pgC40dBrVvt6pISzSSRm_yxZWVShabl6W4zA6JJmC6MLgEJMdvXwLUruipva0wJhjYLcRqeEW4XMTGnDa4oHeJQPvPCPYxRStygYcBNsqnvfYgRhPja7z5O2UsUhYT9jfbPKLSLQM';

export default function PatientChatbotPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showMobileVideos, setShowMobileVideos] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<YouTubeSource[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  useEffect(() => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: '안녕하세요! 서울온케어의원 상담 실장 온케어봇입니다. 😊\n암 보조 치료, 자율신경 치료에 대해 궁금하신 점을 편하게 물어보세요.',
        timestamp: new Date(),
      },
    ]);
    // 영상은 대화 시작 전에는 표시하지 않음
    setRelatedVideos([]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const parseResponse = (text: string) => {
    let content = text;
    let sources: YouTubeSource[] = [];
    let showBooking = false;

    if (content.includes('__SOURCES__')) {
      const parts = content.split('__SOURCES__');
      content = parts[0].trim();
      try {
        const sourcesJson = parts[1].split('__BOOKING__')[0].trim();
        sources = JSON.parse(sourcesJson);
      } catch (e) {
        console.error('Failed to parse sources:', e);
      }
    }

    if (text.includes('__BOOKING__')) {
      showBooking = true;
      content = content.replace('__BOOKING__', '').trim();
    }

    return { content, sources, showBooking };
  };

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    const history = messages
      .filter((m) => m.id !== 'welcome' && m.content && m.content.trim())
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        content: m.content,
      }));

    try {
      const response = await fetch(`${apiBaseUrl}/api/patient-chatbot/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userMessage.content,
          category: 'auto',
          history,
          sessionId,
        }),
      });

      const newSessionId = response.headers.get('X-Session-Id');
      if (newSessionId) {
        setSessionId(newSessionId);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let fullText = '';

      const assistantId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
        },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;

        const displayText = fullText
          .split('__SOURCES__')[0]
          .split('__BOOKING__')[0];

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: displayText } : m
          )
        );
      }

      const { content, sources, showBooking } = parseResponse(fullText);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content, sources, showBooking }
            : m
        )
      );

      // 관련 영상 업데이트
      if (sources && sources.length > 0) {
        const videos = sources.map(s => {
          const videoUrl = s.source || s.url || '';
          const match = videoUrl.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*)/);
          const videoId = match?.[1];
          return {
            ...s,
            url: videoUrl,
            thumbnail: s.thumbnail || (videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : undefined)
          };
        });
        setRelatedVideos(videos);
        setShowMobileVideos(true);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '죄송합니다. 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleClose = () => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'closeChatbot' }, '*');
    } else {
      window.close();
    }
  };

  return (
    <div className="bg-gradient-to-br from-[#e0f2f1] to-[#fff3e0] min-h-screen flex items-center justify-center p-4 relative overflow-hidden font-['Noto_Sans_KR',sans-serif] transition-colors duration-300">
      {/* 배경 블러 효과 */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-40">
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-[#2A9D8F]/10 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] bg-[#F28C28]/10 rounded-full blur-[100px]"></div>
      </div>

      {/* 메인 글래스 패널 */}
      <div className="relative z-10 w-full max-w-6xl mx-auto h-screen md:h-[85vh] md:my-[7.5vh] backdrop-blur-[20px] bg-white/60 border border-white/50 md:rounded-3xl shadow-2xl flex flex-col md:flex-row overflow-hidden">

        {/* 모바일 헤더 */}
        <div className="md:hidden absolute top-0 left-0 w-full p-4 flex justify-between items-center bg-white/60 backdrop-blur-md z-30 border-b border-white/20">
          <div className="flex items-center gap-2">
            <span className="material-icons-outlined text-[#F28C28]">smart_toy</span>
            <span className="font-bold text-gray-800">서울온케어 상담실</span>
          </div>
          <button onClick={handleClose} className="text-gray-500 hover:text-gray-700">
            <span className="material-icons-outlined">close</span>
          </button>
        </div>

        {/* 채팅 영역 */}
        <div className="flex-1 flex flex-col min-h-0 relative z-10 pt-16 md:pt-0">
          {/* 데스크탑 헤더 */}
          <div className="hidden md:flex justify-between items-center p-6 border-b border-white/40 bg-white/40 backdrop-blur-md relative z-20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#F28C28] to-orange-400 flex items-center justify-center shadow-lg text-white font-bold ring-2 ring-white/50">
                <span className="material-icons-outlined text-xl">local_hospital</span>
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-gray-900">서울온케어의원 상담실</h1>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                  </span>
                  <span className="text-xs text-gray-600 font-medium">상담실장 온케어봇 대기중</span>
                </div>
              </div>
            </div>
            <button onClick={handleClose} className="text-gray-500 hover:text-gray-800 transition-colors bg-white/30 p-2 rounded-full hover:bg-white/50">
              <span className="material-icons-outlined">close</span>
            </button>
          </div>

          {/* 메시지 영역 (3D 배경 포함) */}
          <div className="flex-1 overflow-hidden relative">
            {/* 3D 배경 장면 - 채팅 영역 내부 */}
            <div className="scene-container">
              <div className="light-ray" style={{ top: '20%', left: '-20%' }}></div>
              <div className="light-ray" style={{ top: '60%', left: '-10%', animationDelay: '2s' }}></div>
              <div className="shape capsule" style={{ top: '15%', right: '15%' }}></div>
              <div className="shape capsule-orange" style={{ bottom: '25%', left: '10%', animationDelay: '-3s' }}></div>
              <div className="shape sphere" style={{ top: '50%', left: '40%', width: '40px', height: '40px', opacity: 0.6, animationDelay: '-1s' }}></div>
              <div className="shape ring" style={{ top: '10%', left: '5%', opacity: 0.5 }}></div>
              <div className="shape stethoscope-head" style={{ bottom: '10%', right: '5%', opacity: 0.3, transform: 'scale(1.5) rotate(20deg)' }}></div>
              <div className="absolute top-[20%] right-[30%] w-64 h-64 bg-[#2A9D8F]/10 rounded-full blur-3xl mix-blend-multiply"></div>
              <div className="absolute bottom-[10%] left-[20%] w-72 h-72 bg-[#F28C28]/10 rounded-full blur-3xl mix-blend-multiply"></div>
            </div>

            {/* 메시지 컨테이너 */}
            <div className="absolute inset-0 overflow-y-auto p-6 space-y-6 glass-scroll scroll-smooth z-10">
              {messages.map((message, index) => (
                <div key={message.id}>
                  <div className={`flex gap-4 max-w-[85%] ${message.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
                    {/* 아바타 */}
                    {message.role === 'assistant' ? (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#E0F2F1] to-[#B2DFDB] flex-shrink-0 flex items-center justify-center shadow-lg mt-1 ring-2 ring-white/40 overflow-hidden border border-white/50">
                        <img alt="Oncare Bot" className="w-full h-full object-cover scale-110 translate-y-1" src={BOT_AVATAR} />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-50 to-gray-200 flex-shrink-0 flex items-center justify-center shadow-lg mt-1 overflow-hidden ring-2 ring-gray-200 border border-white/40">
                        <span className="material-icons-outlined text-gray-400">person</span>
                      </div>
                    )}

                    <div className={`flex flex-col gap-1 ${message.role === 'user' ? 'items-end' : ''}`}>
                      <span className={`text-xs font-bold ml-1 drop-shadow-sm ${message.role === 'assistant' ? 'text-[#2A9D8F]' : 'text-gray-600 mr-1'}`}>
                        {message.role === 'assistant' ? '온케어봇' : 'Patient'}
                      </span>

                      {message.role === 'assistant' ? (
                        <div className="chat-bubble-glass p-5 rounded-2xl rounded-tl-none shadow-lg text-sm leading-relaxed text-gray-800">
                          {message.content ? (
                            <>
                              <p className="whitespace-pre-wrap">{message.content}</p>
                              {message.id !== 'welcome' && (
                                <p className="text-xs text-gray-500 border-t border-gray-400/20 pt-2 mt-2">본 상담 내용은 참고용이며, 의학적 진단이나 처방을 대신할 수 없습니다.</p>
                              )}
                            </>
                          ) : (
                            <div className="typing-indicator">
                              <span></span>
                              <span></span>
                              <span></span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-gradient-to-br from-[#F28C28] to-orange-500 text-white p-4 rounded-2xl rounded-tr-none shadow-lg text-sm leading-relaxed backdrop-blur-sm">
                          <p>{message.content}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 예약 카드 */}
                  {message.showBooking && (
                    <div className="flex gap-4 max-w-[85%] mt-2">
                      <div className="w-12 flex-shrink-0"></div>
                      <div className="flex-1">
                        <div className="booking-card rounded-2xl p-5 backdrop-blur-md shadow-lg">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="material-icons-outlined text-[#2A9D8F] text-xl">event_available</span>
                            <span className="font-bold text-gray-800 text-sm">내원을 원하시나요? 예약을 도와드릴게요!</span>
                          </div>
                          <div className="space-y-2 mb-4">
                            <div className="flex items-center gap-2 text-sm text-gray-700">
                              <span className="material-icons-outlined text-base text-[#F28C28]">location_on</span>
                              <span>남양주 다산역 1번출구 170m</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-700">
                              <span className="material-icons-outlined text-base text-[#F28C28]">schedule</span>
                              <span>평일 09:00~18:00 / 토 09:00~13:00</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-700">
                              <div className="pulse-dot w-2 h-2 rounded-full bg-green-500 ml-0.5 mr-0.5"></div>
                              <span className="font-medium text-green-600">현재 상담 가능</span>
                            </div>
                          </div>
                          <a href="tel:1577-7998" className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-gradient-to-r from-[#2A9D8F] to-teal-600 hover:from-teal-600 hover:to-[#2A9D8F] text-white font-bold text-sm rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02]">
                            <span className="material-icons-outlined text-lg">call</span>
                            간편 진료예약 1577-7998
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {loading && !messages.some((m) => m.role === 'assistant' && !m.content) && (
                <div className="flex gap-4 max-w-[85%]">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#E0F2F1] to-[#B2DFDB] flex-shrink-0 flex items-center justify-center shadow-lg mt-1 ring-2 ring-white/40 overflow-hidden border border-white/50">
                    <img alt="Oncare Bot" className="w-full h-full object-cover scale-110 translate-y-1" src={BOT_AVATAR} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-[#2A9D8F] font-bold ml-1 drop-shadow-sm">온케어봇</span>
                    <div className="chat-bubble-glass p-4 rounded-2xl rounded-tl-none shadow-lg">
                      <div className="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* 입력 영역 */}
          <div className="p-6 bg-white/60 backdrop-blur-xl border-t border-white/40 z-20">
            <form onSubmit={sendMessage} className="relative flex items-center bg-white/70 rounded-2xl border border-white/60 shadow-inner focus-within:ring-2 focus-within:ring-[#F28C28]/70 focus-within:border-transparent transition-all duration-300 backdrop-blur-md">
              <button type="button" className="p-3 text-gray-400 hover:text-[#F28C28] transition-colors">
                <span className="material-icons-outlined text-2xl">add_circle_outline</span>
              </button>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="궁금한 내용을 입력해주세요..."
                className="w-full bg-transparent border-none focus:ring-0 text-gray-800 placeholder-gray-500 py-4 px-2 font-medium"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="m-2 p-2 bg-gradient-to-r from-[#F28C28] to-orange-600 hover:to-orange-700 text-white rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <span className="material-icons-outlined group-hover:rotate-[-10deg] transition-transform">send</span>
              </button>
            </form>
            <div className="text-center mt-3">
              <p className="text-[10px] text-gray-600 font-medium">본 상담 내용은 참고용이며, 정확한 진단과 처방은 반드시 내원하여 전문의와 상담하시기 바랍니다.</p>
            </div>
          </div>
        </div>

        {/* 모바일 영상 패널 (영상이 있을 때만 표시) */}
        {relatedVideos.length > 0 && (
          <div className={`md:hidden flex flex-col z-20 border-t border-white/30 bg-white/40 backdrop-blur-md max-h-[45vh] overflow-hidden ${showMobileVideos ? '' : ''}`}>
            {/* 관련 영상 보기 토글 버튼 */}
            <div className="p-3 cursor-pointer mobile-video-toggle" onClick={() => setShowMobileVideos(!showMobileVideos)}>
              <div className="flex justify-between items-center">
                <h2 className="font-bold text-sm text-gray-800 flex items-center gap-2">
                  <span className="material-icons-outlined text-red-500 text-xl">smart_display</span>
                  <span className="text-[#F28C28] font-extrabold">관련 영상 보기</span>
                  <span className="bg-red-500 text-white text-xs px-2.5 py-0.5 rounded-full font-bold shadow-sm pulse-badge">{relatedVideos.length}</span>
                </h2>
                <span className={`material-icons-outlined text-[#F28C28] text-xl transition-transform duration-300 ${showMobileVideos ? 'rotate-180' : ''}`}>expand_more</span>
              </div>
            </div>
            {/* 영상 리스트 */}
            {showMobileVideos && (
              <>
                <div className="overflow-x-auto overflow-y-hidden p-3 glass-scroll">
                  <div className="flex gap-3">
                    {relatedVideos.map((video, idx) => (
                      <div key={idx} className="flex-shrink-0 w-48 cursor-pointer group" onClick={() => window.open(video.url || video.source, '_blank')}>
                        <div className="relative rounded-lg overflow-hidden shadow-md border border-white/30">
                          <img src={video.thumbnail} alt={video.title} className="w-48 h-28 object-cover" />
                          <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                            <div className="w-10 h-10 bg-red-600/90 rounded-full flex items-center justify-center text-white shadow-lg">
                              <span className="material-icons-outlined text-lg">play_arrow</span>
                            </div>
                          </div>
                        </div>
                        <h3 className="font-bold text-xs text-gray-800 leading-snug mt-1.5 line-clamp-2">{video.title}</h3>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-2 border-t border-white/20 bg-white/10">
                  <a href="https://www.youtube.com/@%EC%84%9C%EC%9A%B8%EC%98%A8%EC%BC%80%EC%96%B4%EC%9D%98%EC%9B%90" target="_blank" rel="noopener noreferrer"
                    className="w-full py-2 px-3 bg-white/50 hover:bg-white/80 border border-white/40 rounded-lg text-xs font-bold text-gray-700 flex items-center justify-center gap-1.5 transition-all shadow-sm">
                    <span className="material-icons-outlined text-red-500 text-sm">video_library</span>
                    유튜브 채널 바로가기
                  </a>
                </div>
              </>
            )}
          </div>
        )}

        {/* 데스크탑 사이드바 - 관련 영상 */}
        <div className="hidden md:flex flex-col w-96 border-l border-white/30 bg-white/20 backdrop-blur-md z-20">
          <div className="p-5 border-b border-white/30 flex justify-between items-center bg-white/10">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              <span className="material-icons-outlined text-[#F28C28]">play_circle</span>
              관련 영상 추천
            </h2>
            <button className="text-gray-400 hover:text-[#F28C28] transition-colors">
              <span className="material-icons-outlined">open_in_new</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-5 glass-scroll">
            {relatedVideos.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 opacity-70">
                <span className="material-icons-outlined text-4xl mb-2 text-[#2A9D8F]">smart_display</span>
                <p className="text-sm">상담 내용과 관련된 영상이<br />이곳에 표시됩니다.</p>
              </div>
            ) : (
              relatedVideos.map((video, idx) => (
                <div key={idx} className="group cursor-pointer" onClick={() => window.open(video.url || video.source, '_blank')}>
                  <div className="relative rounded-xl overflow-hidden shadow-lg border border-white/40 group-hover:shadow-xl transition-all">
                    <img src={video.thumbnail} alt={video.title} className="w-full h-40 object-cover transform group-hover:scale-105 transition-transform duration-500" />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <div className="w-12 h-12 bg-red-600/90 rounded-full flex items-center justify-center text-white shadow-xl backdrop-blur-sm group-hover:scale-110 transition-transform ring-2 ring-white/20">
                        <span className="material-icons-outlined">play_arrow</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <h3 className="font-bold text-sm text-gray-800 leading-snug group-hover:text-[#F28C28] transition-colors line-clamp-2">{video.title}</h3>
                    <p className="text-xs text-gray-500 mt-1">서울온케어의원</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-4 border-t border-white/30 bg-white/10">
            <a
              href="https://www.youtube.com/@%EC%84%9C%EC%9A%B8%EC%98%A8%EC%BC%80%EC%96%B4%EC%9D%98%EC%9B%90"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 px-4 bg-white/50 hover:bg-white/80 border border-white/40 rounded-xl text-sm font-bold text-gray-700 flex items-center justify-center gap-2 transition-all shadow-sm"
            >
              <span className="material-icons-outlined text-red-500">video_library</span>
              유튜브 채널 바로가기
            </a>
          </div>
        </div>
      </div>

      {/* Google Material Icons */}
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap" rel="stylesheet" />

      <style jsx global>{`
        body { font-family: 'Noto Sans KR', sans-serif; }

        /* Glass Panel */
        .glass-panel {
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        /* Chat Bubble Glass */
        .chat-bubble-glass {
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.6);
        }

        /* Scrollbar */
        .glass-scroll::-webkit-scrollbar { width: 6px; }
        .glass-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); border-radius: 10px; }
        .glass-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 10px; }

        /* Scene Container */
        .scene-container {
          position: absolute;
          width: 100%;
          height: 100%;
          overflow: hidden;
          z-index: 0;
          background: linear-gradient(120deg, #f0fdfa 0%, #fff7ed 50%, #eff6ff 100%);
        }

        /* 3D Shapes */
        .shape {
          position: absolute;
          transform-style: preserve-3d;
          animation: float-3d 8s ease-in-out infinite alternate;
        }
        .capsule {
          width: 60px;
          height: 140px;
          border-radius: 40px;
          background: linear-gradient(135deg, rgba(42, 157, 143, 0.4), rgba(42, 157, 143, 0.1));
          box-shadow: inset 4px 4px 10px rgba(255,255,255,0.5), inset -4px -4px 10px rgba(0,0,0,0.05), 10px 10px 20px rgba(0,0,0,0.05);
          backdrop-filter: blur(2px);
          border: 1px solid rgba(255,255,255,0.4);
          transform: rotate(30deg);
        }
        .capsule-orange {
          width: 50px;
          height: 120px;
          border-radius: 30px;
          background: linear-gradient(135deg, rgba(242, 140, 40, 0.4), rgba(242, 140, 40, 0.1));
          box-shadow: inset 4px 4px 10px rgba(255,255,255,0.5), inset -4px -4px 10px rgba(0,0,0,0.05), 10px 10px 20px rgba(0,0,0,0.05);
          border: 1px solid rgba(255,255,255,0.4);
          transform: rotate(-15deg);
        }
        .sphere {
          width: 100px;
          height: 100px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.9), rgba(42, 157, 143, 0.2));
          box-shadow: 0 0 20px rgba(255, 255, 255, 0.4), inset -10px -10px 20px rgba(42, 157, 143, 0.1);
        }
        .ring {
          width: 140px;
          height: 140px;
          border-radius: 50%;
          border: 15px solid rgba(242, 140, 40, 0.15);
          box-shadow: inset 2px 2px 5px rgba(255,255,255,0.4), 2px 2px 5px rgba(0,0,0,0.05);
          transform: rotateX(60deg) rotateY(20deg);
        }
        .stethoscope-head {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #e0e0e0, #a0a0a0);
          box-shadow: inset 2px 2px 5px rgba(255,255,255,0.8), 5px 5px 15px rgba(0,0,0,0.1);
          position: relative;
        }
        .stethoscope-head::after {
          content: '';
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 60px; height: 60px;
          border-radius: 50%;
          background: #f5f5f5;
          box-shadow: inset 1px 1px 3px rgba(0,0,0,0.1);
        }
        .light-ray {
          position: absolute;
          width: 150%;
          height: 40px;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
          transform: rotate(-35deg);
          filter: blur(15px);
          animation: shine 10s infinite linear;
        }

        /* Animations */
        @keyframes float-3d {
          0% { transform: translateY(0px) rotate(0deg) scale(1); }
          100% { transform: translateY(-20px) rotate(5deg) scale(1.05); }
        }
        @keyframes shine {
          0% { transform: translateX(-50%) rotate(-35deg); opacity: 0; }
          50% { opacity: 0.5; }
          100% { transform: translateX(50%) rotate(-35deg); opacity: 0; }
        }

        /* Typing Indicator */
        .typing-indicator {
          display: flex;
          gap: 4px;
          padding: 8px 12px;
        }
        .typing-indicator span {
          width: 8px;
          height: 8px;
          background: #2A9D8F;
          border-radius: 50%;
          animation: typing 1.4s infinite ease-in-out both;
        }
        .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
        .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes typing {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }

        /* Booking Card */
        .booking-card {
          background: linear-gradient(135deg, rgba(42,157,143,0.12) 0%, rgba(242,140,40,0.10) 100%);
          border: 1px solid rgba(42,157,143,0.3);
          animation: slideUp 0.4s ease-out;
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .pulse-dot {
          animation: pulse-green 2s infinite;
        }
        @keyframes pulse-green {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
          50% { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
        }

        /* Mobile Video Toggle */
        .mobile-video-toggle {
          background: linear-gradient(135deg, rgba(242,140,40,0.15) 0%, rgba(220,50,50,0.12) 100%);
          border: 1.5px solid rgba(242,140,40,0.4);
        }
        .pulse-badge {
          animation: pulse-badge 2s infinite;
        }
        @keyframes pulse-badge {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }

        /* Line Clamp */
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
