const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface ApiOptions extends Omit<RequestInit, 'body'> {
  token?: string;
  body?: any;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function api<T = any>(
  path: string,
  options: ApiOptions = {},
): Promise<ApiResponse<T>> {
  const { token, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
    credentials: 'include',
    body: fetchOptions.body ? JSON.stringify(fetchOptions.body) : undefined,
  });

  const json = await res.json();

  if (!res.ok) {
    throw new ApiError(json.error?.code || 'UNKNOWN', json.error?.message || '오류가 발생했습니다.', res.status);
  }

  return json;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
