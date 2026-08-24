import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownLeft, ArrowUpRight, Banknote, CalendarDays, Check, ChevronLeft, ChevronRight,
  CircleDollarSign, Clipboard, Download, Eye, EyeOff, FileClock, Landmark, ListRestart, LogOut,
  RefreshCw, Search, ServerCog, ShieldCheck, Webhook, X
} from 'lucide-react';

type Direction = 'CREDIT' | 'DEBIT' | 'UNKNOWN';
type Transaction = {
  id: string; bank_reference: string | null; account_number: string | null; counterparty_account: string | null;
  counterparty_name: string | null; direction: Direction; amount: string; currency: string; description: string | null;
  transaction_time: string; balance_after: string | null; received_at: string; raw_payload?: unknown;
};
type Summary = { totalCredit: number; totalDebit: number; net: number; count: number; recentDeliveries: number; lastWebhookAt: string | null; daily: Array<{ date: string; credit: number; debit: number }> };
type ListResponse = { items: Transaction[]; total: number; page: number; pageSize: number };
type AppConfig = { callbackUrl: string; statementCallbackUrl: string; acbConfigured: boolean; acbRequestHeadersConfigured: boolean; postgresSsl: boolean; environment: string };
type Ops = {
  queues: Record<string, number>;
  latest: Array<{ id: string; event_type: string; status: string; attempts: number; transaction_count: number; error_message: string | null; authenticated: boolean; received_at: string; processed_at: string | null }>;
  apiRequests: Array<{ id: string; operation: string; response_status: number | null; duration_ms: number | null; error_message: string | null; created_at: string }>;
  statementResults: Array<Record<string, unknown>>;
};
type Tab = 'cashflow' | 'accounts' | 'ops';

const money = (value: number | string, currency = 'VND') => new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2 }).format(Number(value || 0));
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : 'Chưa có';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error('UNAUTHORIZED');
  if (!response.ok) throw new Error(data.message || data.errorMessage || 'Có lỗi xảy ra');
  return data;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('admin'); const [password, setPassword] = useState('');
  const [show, setShow] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); onSuccess(); }
    catch { setError('Tên đăng nhập hoặc mật khẩu không đúng.'); } finally { setBusy(false); }
  };
  return <main className="login-shell"><section className="login-brand"><div className="brand-mark"><span>BY</span>DUNI</div><div className="login-copy"><p className="eyebrow">ACB ONE CONNECT</p><h1>Dòng tiền rõ ràng.<br />Vận hành tin cậy.</h1><p>Quản lý giao dịch, tài khoản, số dư và sổ phụ ACB trong một không gian riêng tư.</p></div><div className="trust-line"><ShieldCheck size={18} /> HTTPS · durable inbox · audit log</div></section><section className="login-panel"><form className="login-card" onSubmit={submit}><div className="brand-mark dark mobile-brand"><span>BY</span>DUNI</div><div className="login-icon"><Landmark /></div><h2>Đăng nhập quản trị</h2><p>Thông tin đăng nhập được lấy từ biến môi trường trên máy chủ.</p><label>Tên đăng nhập</label><input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /><label>Mật khẩu</label><div className="password-field"><input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /><button type="button" onClick={() => setShow(!show)}>{show ? <EyeOff /> : <Eye />}</button></div>{error && <div className="form-error">{error}</div>}<button className="primary-btn" disabled={busy}>{busy ? <RefreshCw className="spin" /> : 'Đăng nhập'}</button></form></section></main>;
}

function Trend({ data }: { data: Summary['daily'] }) {
  const max = Math.max(1, ...data.flatMap(day => [day.credit, day.debit]));
  return <div className="trend-chart">{data.map(day => <div className="bar-day" key={day.date}><div className="bar-pair"><i className="bar credit" title={`Vào ${money(day.credit)}`} style={{ height: `${Math.max(2, day.credit / max * 100)}%` }} /><i className="bar debit" title={`Ra ${money(day.debit)}`} style={{ height: `${Math.max(2, day.debit / max * 100)}%` }} /></div><span>{day.date.slice(5)}</span></div>)}</div>;
}

function Detail({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer" onClick={e => e.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">CHI TIẾT GIAO DỊCH</p><h2>{transaction.bank_reference || 'Không có mã tham chiếu'}</h2></div><button className="icon-btn" onClick={onClose}><X /></button></div><div className={`amount-focus ${transaction.direction.toLowerCase()}`}>{transaction.direction === 'DEBIT' ? '−' : '+'}{money(transaction.amount, transaction.currency)}</div><dl className="detail-grid"><div><dt>Thời gian</dt><dd>{dateTime(transaction.transaction_time)}</dd></div><div><dt>Loại</dt><dd>{transaction.direction}</dd></div><div><dt>Tài khoản</dt><dd>{transaction.account_number || '—'}</dd></div><div><dt>Số dư sau GD</dt><dd>{transaction.balance_after ? money(transaction.balance_after) : '—'}</dd></div><div className="wide"><dt>Nội dung</dt><dd>{transaction.description || '—'}</dd></div></dl>{Boolean(transaction.raw_payload) && <details><summary>Payload gốc</summary><pre>{JSON.stringify(transaction.raw_payload, null, 2)}</pre></details>}</aside></div>;
}

function Panel({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return <section className="panel feature-panel"><div className="panel-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>{children}</section>;
}

const extractRows = (data: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(data)) return data.filter(x => x && typeof x === 'object') as Array<Record<string, unknown>>;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['data', 'items', 'accounts', 'transactions', 'results']) if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    if (obj.data && typeof obj.data === 'object') return extractRows(obj.data);
    return [obj];
  }
  return [];
};

function ResultView({ data }: { data: unknown }) {
  const rows = extractRows(data);
  if (!rows.length) return <div className="empty-inline">Chưa có dữ liệu trả về.</div>;
  return <div className="result-stack">{rows.slice(0, 100).map((row, index) => <article key={index}>{Object.entries(row).slice(0, 12).map(([key, value]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</strong></div>)}</article>)}</div>;
}

function Accounts({ config, reportError }: { config: AppConfig | null; reportError: (value: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [account, setAccount] = useState(''); const [from, setFrom] = useState(today); const [to, setTo] = useState(today);
  const [mode, setMode] = useState<'accounts' | 'balance' | 'history' | 'statements' | 'retrieve' | 'inquiry'>('accounts');
  const [result, setResult] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const outboundReady = Boolean(config?.acbConfigured && config?.acbRequestHeadersConfigured);
  const execute = async (selected = mode) => {
    setMode(selected); setBusy(true); reportError('');
    try {
      const qs = new URLSearchParams(); if (account) qs.set('account', account);
      if (selected === 'history') { qs.set('from_date', from); qs.set('to_date', to); }
      if (selected === 'statements') { qs.set('from_date', from); qs.set('to_date', from); qs.set('page', '0'); qs.set('size', '100'); }
      if (selected === 'retrieve' || selected === 'inquiry') { qs.set('from_date', from); qs.set('to_date', to); }
      const paths = { accounts: 'accounts', balance: 'balances', history: 'transaction-history', statements: 'statements', retrieve: 'statement/retrieve', inquiry: 'statement/inquiry' };
      setResult(await api(`/api/acb/${paths[selected]}?${qs}`));
    } catch (error) { reportError((error as Error).message); } finally { setBusy(false); }
  };
  const register = async () => {
    setBusy(true); reportError('');
    try { setResult(await api('/api/acb/e-statement/registration', { method: 'POST', body: JSON.stringify({ account, callback_url: config?.statementCallbackUrl }) })); }
    catch (error) { reportError((error as Error).message); } finally { setBusy(false); }
  };
  return <div className="workspace-grid"><Panel eyebrow="ACB ACCOUNT INFORMATION" title="Tra cứu trực tiếp ACB Sandbox"><div className={`config-banner ${outboundReady ? 'ready' : 'warning'}`}><ShieldCheck />{outboundReady ? 'Client credentials và header ACB đã được cấu hình; Bearer token tự làm mới khi hết hạn.' : 'Chưa đủ ClientID/SecretID, X-Channel hoặc tên header ACB từ Developer Portal.'}</div><div className="query-form"><label>Số tài khoản<input value={account} onChange={e => setAccount(e.target.value)} placeholder="Bỏ trống khi lấy danh sách tài khoản" /></label><label>Từ ngày<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Đến ngày<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div><div className="action-grid"><button onClick={() => execute('accounts')}>Danh sách tài khoản</button><button onClick={() => execute('balance')}>Số dư</button><button onClick={() => execute('history')}>Lịch sử giao dịch</button><button onClick={() => execute('statements')}>Danh sách giao dịch</button><button onClick={() => execute('retrieve')}>Yêu cầu sổ phụ</button><button onClick={() => execute('inquiry')}>Sổ phụ đồng bộ</button><button onClick={register}>Đăng ký giấy báo nợ/có</button></div><p className="form-hint">ACB cho phép tối đa 100 giao dịch gần nhất hoặc tối đa 500 giao dịch trong cùng một ngày.</p></Panel><Panel eyebrow={mode.toUpperCase()} title="Kết quả ACB">{busy ? <div className="loading-block"><RefreshCw className="spin" /> Đang kết nối ACB…</div> : <ResultView data={result} />}</Panel></div>;
}

function Operations({ ops, load, requeue }: { ops: Ops | null; load: () => void; requeue: (id: string) => void }) {
  return <><section className="ops-metrics">{['PENDING', 'PROCESSING', 'RETRY', 'DEAD_LETTER', 'PROCESSED'].map(status => <article className="panel" key={status}><span>{status}</span><strong>{ops?.queues[status] || 0}</strong></article>)}</section><section className="panel transactions-panel"><div className="panel-head transactions-title"><div><p className="eyebrow">DURABLE INBOX</p><h2>Callback gần đây</h2></div><button className="export-btn" onClick={load}><RefreshCw /> Làm mới</button></div><div className="table-wrap"><table><thead><tr><th>Nhận lúc</th><th>Loại</th><th>Trạng thái</th><th>Xác thực</th><th>Lần chạy</th><th>Lỗi</th><th></th></tr></thead><tbody>{ops?.latest.map(item => <tr key={item.id}><td>{dateTime(item.received_at)}</td><td>{item.event_type}</td><td><span className={`status-pill ${item.status.toLowerCase()}`}>{item.status}</span></td><td>{item.authenticated ? 'Có' : 'Không'}</td><td>{item.attempts}</td><td className="description-cell">{item.error_message || '—'}</td><td>{['RETRY', 'DEAD_LETTER'].includes(item.status) && <button className="tiny-btn" onClick={() => requeue(item.id)}><ListRestart /> Chạy lại</button>}</td></tr>)}</tbody></table></div></section><div className="ops-columns"><Panel eyebrow="OUTBOUND AUDIT" title="Lệnh gọi API ACB"><div className="audit-list">{ops?.apiRequests.map(item => <article key={item.id}><div><strong>{item.operation}</strong><span>{dateTime(item.created_at)}</span></div><code className={item.response_status && item.response_status < 300 ? 'ok' : 'bad'}>{item.response_status || 'ERR'}</code><span>{item.duration_ms ?? '—'} ms</span></article>)}</div></Panel><Panel eyebrow="STATEMENT CALLBACK" title="Kết quả sổ phụ"><ResultView data={ops?.statementResults || []} /></Panel></div></>;
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null); const [tab, setTab] = useState<Tab>('cashflow');
  const [summary, setSummary] = useState<Summary | null>(null); const [list, setList] = useState<ListResponse>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [config, setConfig] = useState<AppConfig | null>(null); const [ops, setOps] = useState<Ops | null>(null);
  const [query, setQuery] = useState(''); const [direction, setDirection] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Transaction | null>(null); const [loading, setLoading] = useState(false); const [copied, setCopied] = useState(false); const [error, setError] = useState('');
  useEffect(() => { api('/api/auth/session').then(() => setAuthenticated(true)).catch(() => setAuthenticated(false)); }, []);
  const params = useMemo(() => new URLSearchParams({ page: String(page), pageSize: '20', ...(query && { q: query }), ...(direction && { direction }), ...(from && { from }), ...(to && { to }) }).toString(), [page, query, direction, from, to]);
  const loadCashflow = useCallback(async () => { if (!authenticated) return; setLoading(true); try { const [s, l, c] = await Promise.all([api<Summary>('/api/summary'), api<ListResponse>(`/api/transactions?${params}`), api<AppConfig>('/api/config')]); setSummary(s); setList(l); setConfig(c); } catch (e) { if ((e as Error).message === 'UNAUTHORIZED') setAuthenticated(false); else setError((e as Error).message); } finally { setLoading(false); } }, [authenticated, params]);
  const loadOps = useCallback(async () => { try { setOps(await api('/api/ops/status')); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { const id = setTimeout(loadCashflow, query ? 300 : 0); return () => clearTimeout(id); }, [loadCashflow, query]);
  useEffect(() => { if (tab === 'ops') loadOps(); }, [tab, loadOps]);
  useEffect(() => { const id = setInterval(() => { if (tab === 'cashflow') loadCashflow(); if (tab === 'ops') loadOps(); }, 30000); return () => clearInterval(id); }, [tab, loadCashflow, loadOps]);
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }); setAuthenticated(false); };
  const requeue = async (id: string) => { try { await api(`/api/ops/deliveries/${id}/requeue`, { method: 'POST' }); await loadOps(); } catch (e) { setError((e as Error).message); } };
  if (authenticated === null) return <div className="splash"><div className="brand-mark dark"><span>BY</span>DUNI</div><RefreshCw className="spin" /></div>;
  if (!authenticated) return <Login onSuccess={() => setAuthenticated(true)} />;
  return <div className="app-shell"><header><div className="brand-mark dark"><span>BY</span>DUNI</div><nav className="main-nav"><button className={tab === 'cashflow' ? 'active' : ''} onClick={() => setTab('cashflow')}><Activity /> Dòng tiền</button><button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}><Landmark /> Tài khoản ACB</button><button className={tab === 'ops' ? 'active' : ''} onClick={() => setTab('ops')}><ServerCog /> Vận hành</button></nav><div className="header-actions"><button className="icon-btn" onClick={() => tab === 'ops' ? loadOps() : loadCashflow()}><RefreshCw className={loading ? 'spin' : ''} /></button><button className="avatar" onClick={logout}>AD <LogOut size={15} /></button></div></header>{error && <div className="global-error"><span>{error}</span><button onClick={() => setError('')}><X /></button></div>}<main className="dashboard">{tab === 'cashflow' && <><section className="welcome-row"><div><p className="eyebrow">TỔNG QUAN DÒNG TIỀN</p><h1>Payment Hub</h1><p>Dữ liệu callback ACB được ghi bền vững trước khi xử lý.</p></div><div className="last-sync"><Webhook /><div><span>Webhook gần nhất</span><strong>{dateTime(summary?.lastWebhookAt || null)}</strong></div></div></section><section className="metric-grid"><article className="metric credit"><div className="metric-icon"><ArrowDownLeft /></div><div><span>Tổng tiền vào · 30 ngày</span><strong>{money(summary?.totalCredit || 0)}</strong><small>{summary?.count || 0} giao dịch</small></div></article><article className="metric debit"><div className="metric-icon"><ArrowUpRight /></div><div><span>Tổng tiền ra · 30 ngày</span><strong>{money(summary?.totalDebit || 0)}</strong><small>Dữ liệu đã chuẩn hóa</small></div></article><article className="metric net"><div className="metric-icon"><CircleDollarSign /></div><div><span>Dòng tiền thuần · 30 ngày</span><strong>{money(summary?.net || 0)}</strong><small>Tiền vào trừ tiền ra</small></div></article></section><section className="content-grid"><article className="panel chart-panel"><div className="panel-head"><div><p className="eyebrow">14 NGÀY GẦN NHẤT</p><h2>Xu hướng dòng tiền</h2></div></div><Trend data={summary?.daily || []} /></article><article className="panel callback-panel"><div className="callback-icon"><Webhook /></div><p className="eyebrow">ACB CALLBACK</p><h2>Điểm nhận giao dịch & sổ phụ</h2><p>URL chính để ACB gửi thông báo. Payload được chống trùng và đưa vào durable inbox.</p><div className="callback-url"><code>{config?.callbackUrl}</code><button onClick={async () => { await navigator.clipboard.writeText(config?.callbackUrl || ''); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? <Check /> : <Clipboard />}</button></div><small><ShieldCheck size={14} /> HTTPS · retry · dead-letter</small></article></section><section className="panel transactions-panel"><div className="panel-head transactions-title"><div><p className="eyebrow">SỔ GIAO DỊCH</p><h2>Giao dịch gần đây</h2></div><a className="export-btn" href={`/api/transactions/export.csv?${params}`}><Download /> Xuất CSV</a></div><div className="filters"><div className="search-box"><Search /><input placeholder="Tìm mã, nội dung, tài khoản…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></div><select value={direction} onChange={e => { setDirection(e.target.value); setPage(1); }}><option value="">Tất cả dòng tiền</option><option value="CREDIT">Tiền vào</option><option value="DEBIT">Tiền ra</option><option value="UNKNOWN">Chưa xác định</option></select><label className="date-filter"><CalendarDays /><input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><span className="date-sep">đến</span><label className="date-filter"><input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label></div><div className="table-wrap"><table><thead><tr><th>Thời gian</th><th>Loại</th><th>Tài khoản / Đối tác</th><th>Nội dung</th><th>Mã tham chiếu</th><th className="amount-col">Số tiền</th></tr></thead><tbody>{list.items.map(item => <tr key={item.id} onClick={async () => { try { setSelected(await api(`/api/transactions/${item.id}`)); } catch { /* no-op */ } }}><td><strong>{new Date(item.transaction_time).toLocaleDateString('vi-VN')}</strong><small>{new Date(item.transaction_time).toLocaleTimeString('vi-VN')}</small></td><td><span className={`direction-pill ${item.direction.toLowerCase()}`}>{item.direction === 'CREDIT' ? <ArrowDownLeft /> : item.direction === 'DEBIT' ? <ArrowUpRight /> : <Banknote />}{item.direction === 'CREDIT' ? 'Tiền vào' : item.direction === 'DEBIT' ? 'Tiền ra' : 'Khác'}</span></td><td><strong>{item.counterparty_name || item.counterparty_account || 'ACB'}</strong><small>{item.account_number || '—'}</small></td><td className="description-cell">{item.description || '—'}</td><td><code>{item.bank_reference || '—'}</code></td><td className={`amount-col amount ${item.direction.toLowerCase()}`}>{item.direction === 'DEBIT' ? '−' : '+'}{money(item.amount, item.currency)}</td></tr>)}{!loading && !list.items.length && <tr><td colSpan={6}><div className="empty-state"><Banknote /><strong>Chưa có giao dịch</strong><span>Callback ACB đầu tiên sẽ xuất hiện tại đây.</span></div></td></tr>}</tbody></table></div><div className="pagination"><span>Hiển thị {list.items.length} / {list.total}</span><div><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft /></button><span>Trang {page} / {Math.max(1, Math.ceil(list.total / list.pageSize))}</span><button disabled={page >= Math.ceil(list.total / list.pageSize)} onClick={() => setPage(p => p + 1)}><ChevronRight /></button></div></div></section></>}{tab === 'accounts' && <Accounts config={config} reportError={setError} />}{tab === 'ops' && <Operations ops={ops} load={loadOps} requeue={requeue} />}</main>{selected && <Detail transaction={selected} onClose={() => setSelected(null)} />}</div>;
}
