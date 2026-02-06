'use client';

import { useEffect, useState } from 'react';
import {
  MessageCircle,
  Plus,
  Search,
  Edit2,
  Trash2,
  Save,
  X,
  ExternalLink,
  Youtube,
  FileText,
  HelpCircle,
} from 'lucide-react';
import { api } from '../../../../lib/api';

interface Faq {
  id: string;
  question: string;
  answer: string;
  category: 'CANCER' | 'NERVE' | 'GENERAL' | null;
  sourceUrl: string | null;
  title: string | null;
  isActive: boolean;
  createdAt: string;
}

interface Document {
  id: string;
  content: string;
  type: 'YOUTUBE' | 'BLOG' | 'FAQ' | 'MANUAL';
  category: 'CANCER' | 'NERVE' | 'GENERAL' | null;
  sourceUrl: string | null;
  title: string | null;
  isActive: boolean;
  createdAt: string;
}

type TabType = 'faqs' | 'documents';

const categoryLabels: Record<string, string> = {
  CANCER: '암',
  NERVE: '자율신경',
  GENERAL: '일반',
};

const categoryColors: Record<string, string> = {
  CANCER: 'bg-red-100 text-red-700',
  NERVE: 'bg-blue-100 text-blue-700',
  GENERAL: 'bg-gray-100 text-gray-700',
};

const typeIcons: Record<string, typeof Youtube> = {
  YOUTUBE: Youtube,
  BLOG: FileText,
  FAQ: HelpCircle,
  MANUAL: FileText,
};

export default function ChatbotContentPage() {
  const [tab, setTab] = useState<TabType>('faqs');
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // 모달 상태
  const [showModal, setShowModal] = useState(false);
  const [editingFaq, setEditingFaq] = useState<Faq | null>(null);
  const [formData, setFormData] = useState({
    question: '',
    answer: '',
    category: 'GENERAL' as 'CANCER' | 'NERVE' | 'GENERAL',
    sourceUrl: '',
    title: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [tab, search, categoryFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'faqs') {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (categoryFilter !== 'all') params.set('category', categoryFilter);
        params.set('limit', '100');

        const res = await api<{ faqs: Faq[]; total: number }>(`/api/marketing/faqs?${params.toString()}`);
        if (res.success && res.data) {
          setFaqs(res.data.faqs);
        }
      } else {
        const params = new URLSearchParams();
        if (categoryFilter !== 'all') params.set('category', categoryFilter);
        params.set('limit', '100');

        const res = await api<{ documents: Document[]; total: number }>(`/api/marketing/documents?${params.toString()}`);
        if (res.success && res.data) {
          setDocuments(res.data.documents);
        }
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingFaq(null);
    setFormData({
      question: '',
      answer: '',
      category: 'GENERAL',
      sourceUrl: '',
      title: '',
    });
    setShowModal(true);
  };

  const openEditModal = (faq: Faq) => {
    setEditingFaq(faq);
    setFormData({
      question: faq.question,
      answer: faq.answer,
      category: faq.category || 'GENERAL',
      sourceUrl: faq.sourceUrl || '',
      title: faq.title || '',
    });
    setShowModal(true);
  };

  const saveFaq = async () => {
    setSaving(true);
    try {
      if (editingFaq) {
        await api(`/api/marketing/faqs/${editingFaq.id}`, {
          method: 'PUT',
          body: formData,
        });
      } else {
        await api('/api/marketing/faqs', {
          method: 'POST',
          body: formData,
        });
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      console.error('Failed to save FAQ:', err);
      alert('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const deleteFaq = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      await api(`/api/marketing/faqs/${id}`, {
        method: 'DELETE',
      });
      loadData();
    } catch (err) {
      console.error('Failed to delete FAQ:', err);
      alert('삭제에 실패했습니다.');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <MessageCircle className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">챗봇 콘텐츠</h1>
            <p className="text-sm text-gray-500">FAQ 및 마케팅 문서 관리</p>
          </div>
        </div>
        {tab === 'faqs' && (
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={18} />
            FAQ 추가
          </button>
        )}
      </div>

      {/* 탭 */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab('faqs')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            tab === 'faqs'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          FAQ ({faqs.length})
        </button>
        <button
          onClick={() => setTab('documents')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            tab === 'documents'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          문서 ({documents.length})
        </button>
      </div>

      {/* 필터 */}
      <div className="flex gap-4">
        {tab === 'faqs' && (
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="질문 또는 답변 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="all">전체 카테고리</option>
          <option value="CANCER">암</option>
          <option value="NERVE">자율신경</option>
          <option value="GENERAL">일반</option>
        </select>
      </div>

      {/* 콘텐츠 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : tab === 'faqs' ? (
        <div className="space-y-4">
          {faqs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">등록된 FAQ가 없습니다.</div>
          ) : (
            faqs.map((faq) => (
              <div
                key={faq.id}
                className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      {faq.category && (
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${
                            categoryColors[faq.category]
                          }`}
                        >
                          {categoryLabels[faq.category]}
                        </span>
                      )}
                      {faq.title && (
                        <span className="text-xs text-gray-500 truncate">{faq.title}</span>
                      )}
                    </div>
                    <p className="font-medium text-gray-900 mb-2">Q: {faq.question}</p>
                    <p className="text-sm text-gray-600 line-clamp-2">A: {faq.answer}</p>
                    {faq.sourceUrl && (
                      <a
                        href={faq.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:underline"
                      >
                        <ExternalLink size={12} />
                        출처 보기
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(faq)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => deleteFaq(faq.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {documents.length === 0 ? (
            <div className="text-center py-12 text-gray-500">등록된 문서가 없습니다.</div>
          ) : (
            documents.map((doc) => {
              const TypeIcon = typeIcons[doc.type] || FileText;
              return (
                <div
                  key={doc.id}
                  className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-gray-100 rounded-lg">
                      <TypeIcon className="w-5 h-5 text-gray-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                          {doc.type}
                        </span>
                        {doc.category && (
                          <span
                            className={`px-2 py-0.5 text-xs font-medium rounded ${
                              categoryColors[doc.category]
                            }`}
                          >
                            {categoryLabels[doc.category]}
                          </span>
                        )}
                      </div>
                      {doc.title && (
                        <p className="font-medium text-gray-900 mb-1">{doc.title}</p>
                      )}
                      <p className="text-sm text-gray-600 line-clamp-3">{doc.content}</p>
                      {doc.sourceUrl && (
                        <a
                          href={doc.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:underline"
                        >
                          <ExternalLink size={12} />
                          원본 보기
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* FAQ 추가/수정 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-semibold">
                {editingFaq ? 'FAQ 수정' : '새 FAQ 추가'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                <select
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value as 'CANCER' | 'NERVE' | 'GENERAL' })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="CANCER">암</option>
                  <option value="NERVE">자율신경</option>
                  <option value="GENERAL">일반</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목 (선택)</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="콘텐츠 제목"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">질문 *</label>
                <textarea
                  value={formData.question}
                  onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                  placeholder="사용자가 물어볼 질문"
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">답변 *</label>
                <textarea
                  value={formData.answer}
                  onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  placeholder="질문에 대한 답변"
                  rows={6}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">출처 URL (선택)</label>
                <input
                  type="url"
                  value={formData.sourceUrl}
                  onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                onClick={saveFaq}
                disabled={saving || !formData.question || !formData.answer}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Save size={18} />
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
