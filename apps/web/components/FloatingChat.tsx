'use client';

import { useState, useRef, useEffect, KeyboardEvent, FormEvent } from 'react';
import { MessageCircle, X, Send, Sparkles, Calendar, ClipboardList, BedDouble, FileText, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import ConfirmationCard from './chat/ConfirmationCard';
import ConflictAlert from './chat/ConflictAlert';
import DisambiguationCard from './chat/DisambiguationCard';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  type?: 'message' | 'confirm' | 'conflict' | 'disambiguation' | 'permissionDenied' | 'error';
  pendingId?: string;
  displayData?: Record<string, any>;
  patients?: Array<{ id: string; name: string; emrId: string | null; dob: string | null }>;
  alternatives?: string[];
}

interface ChatApiResponse {
  message: string;
  sessionId: string;
  type?: string;
  pendingId?: string;
  displayData?: Record<string, any>;
  patients?: Array<{ id: string; name: string; emrId: string | null; dob: string | null }>;
  alternatives?: string[];
}

const quickActions = [
  { icon: Calendar, label: '오늘 스케줄', prompt: '오늘 스케줄을 알려줘' },
  { icon: ClipboardList, label: '미완료 처치', prompt: '미완료 처치 현황을 알려줘' },
  { icon: BedDouble, label: '빈 베드 현황', prompt: '빈 베드 현황을 알려줘' },
  { icon: FileText, label: '승인 대기', prompt: '승인 대기 중인 의견서를 알려줘' },
];

export default function FloatingChat() {
  const { accessToken, user } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
      type: 'message',
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await api<ChatApiResponse>('/api/chatbot/ask', {
        method: 'POST',
        body: { message: text.trim(), sessionId: sessionId || undefined },
        token: accessToken || undefined,
      });

      const data = res.data!;

      // 세션 유지
      if (data.sessionId) {
        setSessionId(data.sessionId);
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message || '응답을 처리할 수 없습니다.',
        timestamp: new Date(),
        type: (data.type as ChatMessage['type']) || 'message',
        pendingId: data.pendingId,
        displayData: data.displayData,
        patients: data.patients,
        alternatives: data.alternatives,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '죄송합니다. 현재 AI 어시스턴트에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
        timestamp: new Date(),
        type: 'error',
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirm(pendingId: string) {
    setIsLoading(true);
    try {
      const res = await api<{ message: string }>('/api/chatbot/confirm', {
        method: 'POST',
        body: { pendingId },
        token: accessToken || undefined,
      });

      const confirmMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: res.data?.message || '작업이 완료되었습니다.',
        timestamp: new Date(),
        type: 'message',
      };
      setMessages((prev) => [...prev, confirmMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '작업 확인 중 오류가 발생했습니다.',
        timestamp: new Date(),
        type: 'error',
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleReject(pendingId: string) {
    setIsLoading(true);
    try {
      await api('/api/chatbot/reject', {
        method: 'POST',
        body: { pendingId },
        token: accessToken || undefined,
      });

      const rejectMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '작업이 취소되었습니다.',
        timestamp: new Date(),
        type: 'message',
      };
      setMessages((prev) => [...prev, rejectMsg]);
    } catch {
      // 무시
    } finally {
      setIsLoading(false);
    }
  }

  function handleSelectAlternative(time: string) {
    // 마지막 conflict 메시지에서 날짜 추출 후 재요청
    const lastConflict = [...messages].reverse().find((m) => m.type === 'conflict');
    const date = lastConflict?.displayData?.requestedDate || '';
    const patientName = lastConflict?.displayData?.patientName || '';
    const doctorName = lastConflict?.displayData?.doctorName || '';

    sendMessage(`${patientName} 환자 ${date} ${time} ${doctorName} 예약해줘`);
  }

  function handleSelectPatient(patientId: string, patientName: string) {
    // 원래 요청 재전송 (환자ID 포함)
    sendMessage(`환자ID ${patientId} (${patientName}) 선택`);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function renderMessage(msg: ChatMessage) {
    if (msg.role === 'user') {
      return (
        <div key={msg.id} className="flex justify-end">
          <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-br-md bg-blue-600 text-white text-sm leading-relaxed">
            {msg.content}
          </div>
        </div>
      );
    }

    // 어시스턴트 메시지 — 타입별 렌더링
    switch (msg.type) {
      case 'confirm':
        return (
          <div key={msg.id} className="flex justify-start flex-col gap-2">
            <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-slate-100 text-slate-800 text-sm leading-relaxed">
              {msg.content}
            </div>
            {msg.pendingId && msg.displayData && (
              <ConfirmationCard
                displayData={msg.displayData}
                pendingId={msg.pendingId}
                onConfirm={handleConfirm}
                onReject={handleReject}
                isLoading={isLoading}
              />
            )}
          </div>
        );

      case 'conflict':
        return (
          <div key={msg.id} className="flex justify-start flex-col gap-2">
            <ConflictAlert
              message={msg.content}
              alternatives={msg.alternatives || []}
              displayData={msg.displayData}
              onSelectAlternative={handleSelectAlternative}
            />
          </div>
        );

      case 'disambiguation':
        return (
          <div key={msg.id} className="flex justify-start flex-col gap-2">
            <DisambiguationCard
              message={msg.content}
              patients={msg.patients || []}
              onSelect={handleSelectPatient}
            />
          </div>
        );

      case 'permissionDenied':
        return (
          <div key={msg.id} className="flex justify-start">
            <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-red-50 border border-red-200 text-red-700 text-sm leading-relaxed flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{msg.content}</span>
            </div>
          </div>
        );

      case 'error':
        return (
          <div key={msg.id} className="flex justify-start">
            <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-amber-50 border border-amber-200 text-amber-700 text-sm leading-relaxed">
              {msg.content}
            </div>
          </div>
        );

      default:
        return (
          <div key={msg.id} className="flex justify-start">
            <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-slate-100 text-slate-800 text-sm leading-relaxed">
              {msg.content}
            </div>
          </div>
        );
    }
  }

  if (!user) return null;

  return (
    <>
      {/* 플로팅 버튼 */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 z-50"
          aria-label="AI 어시스턴트 열기"
        >
          <MessageCircle size={24} />
        </button>
      )}

      {/* 채팅 패널 */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-white rounded-2xl shadow-2xl flex flex-col z-50 border border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-blue-600 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={20} />
              <div>
                <div className="font-semibold text-sm">AI 어시스턴트</div>
                <div className="text-xs text-blue-200">서울온케어 업무 도우미</div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg hover:bg-blue-700 transition"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <Sparkles size={32} className="mx-auto text-blue-400 mb-3" />
                <p className="text-sm text-slate-600 mb-1">안녕하세요, {user.name}님!</p>
                <p className="text-xs text-slate-400 mb-6">무엇을 도와드릴까요?</p>

                {/* Quick Actions */}
                <div className="grid grid-cols-2 gap-2">
                  {quickActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.label}
                        onClick={() => sendMessage(action.prompt)}
                        className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-left transition text-sm"
                      >
                        <Icon size={16} className="text-blue-500 shrink-0" />
                        <span className="text-slate-700">{action.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {messages.map(renderMessage)}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-bl-md">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-slate-200">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="질문을 입력하세요..."
                className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={18} />
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
