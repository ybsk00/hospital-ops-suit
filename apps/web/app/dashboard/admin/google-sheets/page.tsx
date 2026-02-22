'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Link2, Link2Off, RefreshCw, Save, TestTube,
  CheckCircle, XCircle, Clock, Loader2, Sheet,
} from 'lucide-react';
import { useAuthStore } from '../../../../stores/auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function api(url: string, opts?: RequestInit) {
  const token = useAuthStore.getState().accessToken;
  return fetch(`${API}${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers || {}),
    },
  });
}

interface OAuthStatus {
  connected: boolean;
  connectedEmail: string | null;
  rfSpreadsheetId: string;
  manualSpreadsheetId: string;
  wardSpreadsheetId: string;
  outpatientSpreadsheetId: string;
  autoSyncEnabled: boolean;
  autoSyncIntervalMin: number;
  lastAutoSyncAt: string | null;
  updatedAt: string | null;
}

interface SyncLog {
  id: string;
  sheetTab: string;
  syncType: string;
  startedAt: string;
  completedAt: string | null;
  rowsProcessed: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsFailed: number;
  triggeredBy: string | null;
  contentHash: string | null;
  errorDetails: any;
}

export default function GoogleSheetsPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [rfId, setRfId] = useState('');
  const [manualId, setManualId] = useState('');
  const [wardId, setWardId] = useState('');
  const [outpatientId, setOutpatientId] = useState('');
  const [autoSync, setAutoSync] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const [statusRes, logsRes] = await Promise.all([
        api('/api/google/oauth/status'),
        api('/api/sheet-sync/logs?limit=10'),
      ]);
      const statusData = await statusRes.json();
      const logsData = await logsRes.json();

      if (statusData.success) {
        setStatus(statusData.data);
        setRfId(statusData.data.rfSpreadsheetId || '');
        setManualId(statusData.data.manualSpreadsheetId || '');
        setWardId(statusData.data.wardSpreadsheetId || '');
        setOutpatientId(statusData.data.outpatientSpreadsheetId || '');
        setAutoSync(statusData.data.autoSyncEnabled);
      }
      if (logsData.success) {
        setLogs(logsData.data || []);
      }
    } catch {
      setMessage({ type: 'error', text: '상태 로드 실패' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // URL params from OAuth callback
  useEffect(() => {
    if (searchParams.get('connected') === 'true') {
      setMessage({ type: 'success', text: 'Google 계정이 연결되었습니다!' });
      loadStatus();
    }
    if (searchParams.get('error')) {
      setMessage({ type: 'error', text: `연결 오류: ${searchParams.get('error')}` });
    }
  }, [searchParams, loadStatus]);

  const handleConnect = async () => {
    try {
      const res = await api('/api/google/oauth/url');
      const data = await res.json();
      if (data.success && data.data.url) {
        window.location.href = data.data.url;
      } else {
        setMessage({ type: 'error', text: data.error?.message || 'URL 생성 실패' });
      }
    } catch {
      setMessage({ type: 'error', text: '서버 연결 실패' });
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Google 계정 연결을 해제하시겠습니까?\n자동 동기화가 중지됩니다.')) return;
    try {
      await api('/api/google/oauth/disconnect', { method: 'DELETE' });
      setMessage({ type: 'success', text: '연결이 해제되었습니다.' });
      loadStatus();
    } catch {
      setMessage({ type: 'error', text: '연결 해제 실패' });
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const res = await api('/api/google/oauth/config', {
        method: 'PATCH',
        body: JSON.stringify({
          rfSpreadsheetId: rfId || undefined,
          manualSpreadsheetId: manualId || undefined,
          wardSpreadsheetId: wardId || undefined,
          outpatientSpreadsheetId: outpatientId || undefined,
          autoSyncEnabled: autoSync,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '설정이 저장되었습니다.' });
        loadStatus();
      } else {
        setMessage({ type: 'error', text: data.error?.message || '저장 실패' });
      }
    } catch {
      setMessage({ type: 'error', text: '저장 실패' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestSheet = async (spreadsheetId: string, label: string) => {
    if (!spreadsheetId) {
      setMessage({ type: 'error', text: `${label} 스프레드시트 ID를 입력하세요.` });
      return;
    }
    setTesting(label);
    try {
      const res = await api('/api/google/oauth/test', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId }),
      });
      const data = await res.json();
      if (data.success) {
        const tabNames = data.data.tabs.map((t: any) => t.title).join(', ');
        setMessage({ type: 'success', text: `${label} 연결 성공! 탭: ${tabNames}` });
      } else {
        setMessage({ type: 'error', text: data.error?.message || '테스트 실패' });
      }
    } catch {
      setMessage({ type: 'error', text: '테스트 실패' });
    } finally {
      setTesting(null);
    }
  };

  const TAB_LABELS: Record<string, string> = { rf: '고주파', manual: '도수', ward: '입원현황', outpatient: '외래예약' };

  const handleSync = async (tab: 'rf' | 'manual' | 'ward' | 'outpatient') => {
    setSyncing(tab);
    try {
      const res = await api('/api/sheet-sync/trigger', {
        method: 'POST',
        body: JSON.stringify({ sheetTab: tab, syncType: 'FULL' }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `${TAB_LABELS[tab]} 동기화 시작됨` });
        setTimeout(loadStatus, 3000);
      } else {
        setMessage({ type: 'error', text: data.error?.message || '동기화 실패' });
      }
    } catch {
      setMessage({ type: 'error', text: '동기화 실패' });
    } finally {
      setSyncing(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Sheet className="h-6 w-6" />
        Google Sheets 연동 설정
      </h1>

      {/* Message */}
      {message && (
        <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
          message.type === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
          {message.text}
          <button
            onClick={() => setMessage(null)}
            className="ml-auto text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>
      )}

      {/* Connection Status */}
      <div className="bg-white rounded-lg border p-5">
        <h2 className="text-lg font-semibold mb-4">연결 상태</h2>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status?.connected ? (
              <>
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <div>
                  <p className="font-medium text-green-700">연결됨</p>
                  <p className="text-sm text-gray-500">{status.connectedEmail}</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-3 h-3 bg-gray-300 rounded-full" />
                <div>
                  <p className="font-medium text-gray-600">미연결</p>
                  <p className="text-sm text-gray-400">Google 계정을 연결하세요</p>
                </div>
              </>
            )}
          </div>

          {status?.connected ? (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
            >
              <Link2Off size={16} />
              연결 해제
            </button>
          ) : (
            <button
              onClick={handleConnect}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              <Link2 size={16} />
              Google 계정 연결
            </button>
          )}
        </div>
      </div>

      {/* Spreadsheet Config */}
      <div className="bg-white rounded-lg border p-5">
        <h2 className="text-lg font-semibold mb-4">스프레드시트 설정</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              고주파 스프레드시트 ID
            </label>
            <div className="flex gap-2">
              <input
                value={rfId}
                onChange={(e) => setRfId(e.target.value)}
                placeholder="URL의 /d/ 뒤 부분 (예: 1BxiM...)"
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
              />
              <button
                onClick={() => handleTestSheet(rfId, '고주파')}
                disabled={!!testing || !rfId}
                className="flex items-center gap-1 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {testing === '고주파' ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
                테스트
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              도수 스프레드시트 ID
            </label>
            <div className="flex gap-2">
              <input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="URL의 /d/ 뒤 부분 (예: 1CyNJ...)"
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
              />
              <button
                onClick={() => handleTestSheet(manualId, '도수')}
                disabled={!!testing || !manualId}
                className="flex items-center gap-1 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {testing === '도수' ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
                테스트
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              입원현황 스프레드시트 ID
            </label>
            <div className="flex gap-2">
              <input
                value={wardId}
                onChange={(e) => setWardId(e.target.value)}
                placeholder="URL의 /d/ 뒤 부분 (예: 1DzKO...)"
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
              />
              <button
                onClick={() => handleTestSheet(wardId, '입원현황')}
                disabled={!!testing || !wardId}
                className="flex items-center gap-1 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {testing === '입원현황' ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
                테스트
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              외래예약 스프레드시트 ID
            </label>
            <div className="flex gap-2">
              <input
                value={outpatientId}
                onChange={(e) => setOutpatientId(e.target.value)}
                placeholder="URL의 /d/ 뒤 부분 (예: 1EaLP...)"
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
              />
              <button
                onClick={() => handleTestSheet(outpatientId, '외래예약')}
                disabled={!!testing || !outpatientId}
                className="flex items-center gap-1 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {testing === '외래예약' ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
                테스트
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                className="rounded"
              />
              5분 자동 동기화 활성화
            </label>
            {status?.lastAutoSyncAt && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Clock size={12} />
                마지막: {new Date(status.lastAutoSyncAt).toLocaleString('ko-KR')}
              </span>
            )}
          </div>

          <button
            onClick={handleSaveConfig}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            설정 저장
          </button>
        </div>
      </div>

      {/* Manual Sync */}
      {status?.connected && (
        <div className="bg-white rounded-lg border p-5">
          <h2 className="text-lg font-semibold mb-4">수동 동기화</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleSync('rf')}
              disabled={!!syncing || !rfId}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50"
            >
              {syncing === 'rf' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              고주파 동기화
            </button>
            <button
              onClick={() => handleSync('manual')}
              disabled={!!syncing || !manualId}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 disabled:opacity-50"
            >
              {syncing === 'manual' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              도수 동기화
            </button>
            <button
              onClick={() => handleSync('ward')}
              disabled={!!syncing || !wardId}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-green-300 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50"
            >
              {syncing === 'ward' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              입원현황 동기화
            </button>
            <button
              onClick={() => handleSync('outpatient')}
              disabled={!!syncing || !outpatientId}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-orange-300 text-orange-700 rounded-lg hover:bg-orange-50 disabled:opacity-50"
            >
              {syncing === 'outpatient' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              외래예약 동기화
            </button>
          </div>
        </div>
      )}

      {/* Sync Logs */}
      <div className="bg-white rounded-lg border p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">동기화 로그</h2>
          <button
            onClick={loadStatus}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <RefreshCw size={14} /> 새로고침
          </button>
        </div>

        {logs.length === 0 ? (
          <p className="text-gray-400 text-sm">동기화 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">시각</th>
                  <th className="px-3 py-2 text-left">유형</th>
                  <th className="px-3 py-2 text-right">처리</th>
                  <th className="px-3 py-2 text-right">생성</th>
                  <th className="px-3 py-2 text-right">수정</th>
                  <th className="px-3 py-2 text-right">실패</th>
                  <th className="px-3 py-2 text-left">트리거</th>
                  <th className="px-3 py-2 text-left">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                      {new Date(log.startedAt).toLocaleString('ko-KR', {
                        month: 'numeric', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        log.sheetTab === 'rf' ? 'bg-blue-100 text-blue-700'
                        : log.sheetTab === 'manual' ? 'bg-purple-100 text-purple-700'
                        : log.sheetTab === 'ward' ? 'bg-green-100 text-green-700'
                        : log.sheetTab === 'outpatient' ? 'bg-orange-100 text-orange-700'
                        : 'bg-gray-100 text-gray-700'
                      }`}>
                        {TAB_LABELS[log.sheetTab] || log.sheetTab}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{log.rowsProcessed}</td>
                    <td className="px-3 py-2 text-right text-green-600">{log.rowsCreated}</td>
                    <td className="px-3 py-2 text-right text-blue-600">{log.rowsUpdated}</td>
                    <td className="px-3 py-2 text-right text-red-600">{log.rowsFailed}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {log.triggeredBy?.replace('_', ' ')}
                    </td>
                    <td className="px-3 py-2">
                      {log.errorDetails ? (
                        <span className="text-red-500 text-xs" title={JSON.stringify(log.errorDetails)}>오류</span>
                      ) : log.completedAt ? (
                        <span className="text-green-500 text-xs">완료</span>
                      ) : (
                        <span className="text-yellow-500 text-xs">진행중</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
