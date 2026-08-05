import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Banknote, CalendarDays, Check, ChevronLeft,
  ChevronRight, CircleDollarSign, Clipboard, Download, Eye, EyeOff, Landmark,
  LogOut, RefreshCw, Search, ShieldCheck, Webhook, X
} from 'lucide-react';

type Direction = 'CREDIT' | 'DEBIT' | 'UNKNOWN';
type Transaction = {
  id: string; bank_reference: string | null; account_number: string | null;
  counterparty_account: string | null; counterparty_name: string | null;
  direction: Direction; amount: string; currency: string; description: string | null;
  transaction_time: string; balance_after: string | null; received_at: string;
  raw_payload?: unknown;
};
type Summary = {
  totalCredit: number; totalDebit: number; net: number; count: number;
  recentDeliveries: number; lastWebhookAt: string | null;
  daily: Array<{ date: string; credit: number; debit: number }>;
};
type ListResponse = { items: Transaction[]; total: number; page: number; pageSize: number };

const money = (value: number | string, currency = 'VND') => new Intl.NumberFormat('vi-VN', {
  style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2
}).format(Number(value || 0));
const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
  : 'Chưa có';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include', ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });
  if (response.status === 401) throw new Error('UNAUTHORIZED');
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Có lỗi xảy ra');
  return response.json();
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      onSuccess();
    } catch { setError('Tên đăng nhập hoặc mật khẩu không đúng.'); }
    finally { setBusy(false); }
  };
  return <main className="login-shell">
    <section className="login-brand">
      <div className="brand-mark"><span>BY</span>DUNI</div>
      <div className="login-copy">
        <p className="eyebrow">ACB TRANSACTION HUB</p>
        <h1>Dòng tiền rõ ràng.<br />Quyết định vững vàng.</h1>
        <p>Theo dõi thông báo giao dịch ACB theo thời gian thực trên một không gian riêng tư, gọn gàng.</p>
      </div>
      <div className="trust-line"><ShieldCheck size={18} /> Kết nối mã hóa · Dữ liệu riêng tư</div>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="mobile-brand"><div className="brand-mark dark"><span>BY</span>DUNI</div></div>
        <div className="login-icon"><Landmark size={26} /></div>
        <h2>Chào mừng trở lại</h2>
        <p>Đăng nhập để xem dòng tiền của doanh nghiệp.</p>
        <label>Tên đăng nhập<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></label>
        <label>Mật khẩu<div className="password-field"><input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /><button type="button" onClick={() => setShow(!show)} aria-label="Hiện mật khẩu">{show ? <EyeOff /> : <Eye />}</button></div></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-btn" disabled={busy}>{busy ? <RefreshCw className="spin" /> : 'Đăng nhập'}</button>
      </form>
    </section>
  </main>;
}

function Trend({ data }: { data: Summary['daily'] }) {
  const max = Math.max(1, ...data.flatMap(d => [d.credit, d.debit]));
  return <div className="trend-chart">
    {data.length === 0 && <div className="empty-chart">Chưa có dữ liệu trong khoảng thời gian này.</div>}
    {data.map(day => <div className="bar-day" key={day.date} title={`${day.date}: vào ${money(day.credit)} · ra ${money(day.debit)}`}>
      <div className="bar-pair">
        <i className="bar credit" style={{ height: `${Math.max(3, day.credit / max * 100)}%` }} />
        <i className="bar debit" style={{ height: `${Math.max(3, day.debit / max * 100)}%` }} />
      </div>
      <span>{new Date(`${day.date}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</span>
    </div>)}
  </div>;
}

function Detail({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  return <div className="drawer-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <aside className="drawer">
      <div className="drawer-head"><div><p className="eyebrow">CHI TIẾT GIAO DỊCH</p><h2>{transaction.bank_reference || 'Không có mã tham chiếu'}</h2></div><button className="icon-btn" onClick={onClose}><X /></button></div>
      <div className={`amount-focus ${transaction.direction.toLowerCase()}`}>{transaction.direction === 'DEBIT' ? '−' : '+'}{money(transaction.amount, transaction.currency)}</div>
      <dl className="detail-grid">
        <div><dt>Loại giao dịch</dt><dd>{transaction.direction === 'CREDIT' ? 'Tiền vào' : transaction.direction === 'DEBIT' ? 'Tiền ra' : 'Chưa xác định'}</dd></div>
        <div><dt>Thời gian giao dịch</dt><dd>{dateTime(transaction.transaction_time)}</dd></div>
        <div><dt>Tài khoản</dt><dd>{transaction.account_number || '—'}</dd></div>
        <div><dt>Đối tác</dt><dd>{transaction.counterparty_name || transaction.counterparty_account || '—'}</dd></div>
        <div><dt>Số dư sau giao dịch</dt><dd>{transaction.balance_after ? money(transaction.balance_after, transaction.currency) : '—'}</dd></div>
        <div className="wide"><dt>Nội dung</dt><dd>{transaction.description || '—'}</dd></div>
      </dl>
      {transaction.raw_payload !== undefined && <details><summary>Payload gốc từ ACB</summary><pre>{JSON.stringify(transaction.raw_payload, null, 2)}</pre></details>}
    </aside>
  </div>;
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [list, setList] = useState<ListResponse>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { api('/api/auth/session').then(() => setAuthenticated(true)).catch(() => setAuthenticated(false)); }, []);
  const params = useMemo(() => new URLSearchParams({ page: String(page), pageSize: '20', ...(query && { q: query }), ...(direction && { direction }), ...(from && { from }), ...(to && { to }) }), [page, query, direction, from, to]);
  const load = useCallback(async () => {
    if (!authenticated) return; setLoading(true);
    try {
      const [s, l, config] = await Promise.all([api<Summary>('/api/summary'), api<ListResponse>(`/api/transactions?${params}`), api<{ callbackUrl: string }>('/api/config')]);
      setSummary(s); setList(l); setCallbackUrl(config.callbackUrl);
    } catch (error) { if ((error as Error).message === 'UNAUTHORIZED') setAuthenticated(false); }
    finally { setLoading(false); }
  }, [authenticated, params]);
  useEffect(() => { const id = setTimeout(load, query ? 300 : 0); return () => clearTimeout(id); }, [load, query]);
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);
  const openDetail = async (id: string) => { try { setSelected(await api<Transaction>(`/api/transactions/${id}`)); } catch { /* handled on refresh */ } };
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }); setAuthenticated(false); };
  const copy = async () => { await navigator.clipboard.writeText(callbackUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  if (authenticated === null) return <div className="splash"><div className="brand-mark dark"><span>BY</span>DUNI</div><RefreshCw className="spin" /></div>;
  if (!authenticated) return <Login onSuccess={() => setAuthenticated(true)} />;

  return <div className="app-shell">
    <header>
      <div className="brand-mark dark"><span>BY</span>DUNI</div>
      <div className="header-title"><span>Payment Hub</span><small><i className="status-dot" /> ACB webhook đang hoạt động</small></div>
      <div className="header-actions"><button className="icon-btn" onClick={load} title="Làm mới"><RefreshCw className={loading ? 'spin' : ''} /></button><button className="avatar" onClick={logout} title="Đăng xuất">AD <LogOut size={15} /></button></div>
    </header>
    <main className="dashboard">
      <section className="welcome-row"><div><p className="eyebrow">TỔNG QUAN DÒNG TIỀN</p><h1>Chào buổi tốt lành.</h1><p>Dữ liệu cập nhật tự động từ thông báo giao dịch ACB.</p></div><div className="last-sync"><Webhook /><div><span>Webhook gần nhất</span><strong>{dateTime(summary?.lastWebhookAt || null)}</strong></div></div></section>
      <section className="metric-grid">
        <article className="metric credit"><div className="metric-icon"><ArrowDownLeft /></div><div><span>Tổng tiền vào · 30 ngày</span><strong>{money(summary?.totalCredit || 0)}</strong><small>{summary?.count || 0} giao dịch được ghi nhận</small></div></article>
        <article className="metric debit"><div className="metric-icon"><ArrowUpRight /></div><div><span>Tổng tiền ra · 30 ngày</span><strong>{money(summary?.totalDebit || 0)}</strong><small>Đã đối soát từ webhook</small></div></article>
        <article className="metric net"><div className="metric-icon"><CircleDollarSign /></div><div><span>Dòng tiền thuần · 30 ngày</span><strong>{money(summary?.net || 0)}</strong><small>Tiền vào trừ tiền ra</small></div></article>
      </section>
      <section className="content-grid">
        <article className="panel chart-panel"><div className="panel-head"><div><p className="eyebrow">14 NGÀY GẦN NHẤT</p><h2>Xu hướng dòng tiền</h2></div><div className="legend"><span><i className="credit" /> Tiền vào</span><span><i className="debit" /> Tiền ra</span></div></div><Trend data={summary?.daily || []} /></article>
        <article className="panel callback-panel"><div className="callback-icon"><Webhook /></div><p className="eyebrow">ACB CALLBACK</p><h2>Điểm nhận giao dịch</h2><p>Dùng URL này khi cấu hình sản phẩm Transaction Notification trên ACB ONE CONNECT.</p><div className="callback-url"><code>{callbackUrl}</code><button onClick={copy}>{copied ? <Check /> : <Clipboard />}</button></div><small><ShieldCheck size={14} /> HTTPS · chống trùng · lưu payload gốc</small></article>
      </section>
      <section className="panel transactions-panel">
        <div className="panel-head transactions-title"><div><p className="eyebrow">SỔ GIAO DỊCH</p><h2>Giao dịch gần đây</h2></div><a className="export-btn" href={`/api/transactions/export.csv?${params}`}><Download /> Xuất CSV</a></div>
        <div className="filters">
          <div className="search-box"><Search /><input placeholder="Tìm mã, nội dung, tài khoản…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></div>
          <select value={direction} onChange={e => { setDirection(e.target.value); setPage(1); }}><option value="">Tất cả dòng tiền</option><option value="CREDIT">Tiền vào</option><option value="DEBIT">Tiền ra</option><option value="UNKNOWN">Chưa xác định</option></select>
          <label className="date-filter"><CalendarDays /><input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
          <span className="date-sep">đến</span><label className="date-filter"><input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Thời gian</th><th>Loại</th><th>Tài khoản / Đối tác</th><th>Nội dung</th><th>Mã tham chiếu</th><th className="amount-col">Số tiền</th></tr></thead><tbody>
          {list.items.map(item => <tr key={item.id} onClick={() => openDetail(item.id)}><td><strong>{new Date(item.transaction_time).toLocaleDateString('vi-VN')}</strong><small>{new Date(item.transaction_time).toLocaleTimeString('vi-VN')}</small></td><td><span className={`direction-pill ${item.direction.toLowerCase()}`}>{item.direction === 'CREDIT' ? <ArrowDownLeft /> : item.direction === 'DEBIT' ? <ArrowUpRight /> : <Banknote />}{item.direction === 'CREDIT' ? 'Tiền vào' : item.direction === 'DEBIT' ? 'Tiền ra' : 'Khác'}</span></td><td><strong>{item.counterparty_name || item.counterparty_account || 'ACB'}</strong><small>{item.account_number || '—'}</small></td><td className="description-cell">{item.description || '—'}</td><td><code>{item.bank_reference || '—'}</code></td><td className={`amount-col amount ${item.direction.toLowerCase()}`}>{item.direction === 'DEBIT' ? '−' : '+'}{money(item.amount, item.currency)}</td></tr>)}
          {!loading && list.items.length === 0 && <tr><td colSpan={6}><div className="empty-state"><Banknote /><strong>Chưa có giao dịch</strong><span>Webhook ACB đầu tiên sẽ xuất hiện tại đây.</span></div></td></tr>}
        </tbody></table></div>
        <div className="pagination"><span>Hiển thị {list.items.length} / {list.total} giao dịch</span><div><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft /></button><span>Trang {page} / {Math.max(1, Math.ceil(list.total / list.pageSize))}</span><button disabled={page >= Math.ceil(list.total / list.pageSize)} onClick={() => setPage(p => p + 1)}><ChevronRight /></button></div></div>
      </section>
    </main>
    {selected && <Detail transaction={selected} onClose={() => setSelected(null)} />}
  </div>;
}
