import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const error = request.nextUrl.searchParams.get('error');

  const baseUrl = request.nextUrl.origin;
  const adminUrl = `${baseUrl}/dashboard/admin/google-sheets`;

  if (error) {
    return NextResponse.redirect(`${adminUrl}?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${adminUrl}?error=no_code`);
  }

  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

    const res = await fetch(`${apiUrl}/api/google/oauth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: { message: 'exchange_failed' } }));
      return NextResponse.redirect(
        `${adminUrl}?error=${encodeURIComponent(data.error?.message || 'exchange_failed')}`,
      );
    }

    return NextResponse.redirect(`${adminUrl}?connected=true`);
  } catch (err: any) {
    return NextResponse.redirect(
      `${adminUrl}?error=${encodeURIComponent(err.message || 'server_error')}`,
    );
  }
}
