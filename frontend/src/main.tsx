import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LayoutDashboard, Building2, Users, Layers3, ListTodo, Ticket as TicketIcon, LogOut, Plus, Download, ArrowRight, X, Search, ChevronLeft, ChevronRight, Pencil, Trash2, CheckCircle2, Settings2, Bug } from 'lucide-react'
import { TicketWorkspace } from './TicketWorkspace'
import { PlatformOverview, TenantOverview } from './Overview'
import './index.css'

export type Base = { id: number; created_at: string; updated_at: string }
type Tenant = Base & { name: string; slug: string; identifier_label: string; workspace_name?: string; workspace_icon_url?: string | null }
type User = Base & { email: string; role?: string; tenant_id: number | null }
export type Field = Base & { name: string; key: string; type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'array' | 'file' | 'problem'; options: string[] }
export type ProblemAttachment = { file_id: number; name: string; size: number; content_type: string; access_url: string }
export type Problem = Base & { name: string; description: string; status: 'identified' | 'progress_fixing' | 'fixed' | 'recurring' | 'reappeared'; files: ProblemAttachment[]; generated_step_id?: number | null }
export type ProblemSummary = Pick<Problem, 'id' | 'name' | 'description' | 'status'>
type Binding = { field_id: number; required: boolean }
export type Step = Base & { name: string; description: string; fields: Binding[] }
export type Event = Base & { kind: string; actor_id: number; actor_name?: string | null; problem?: (ProblemSummary & { status_at_event: Problem['status'] | null }) | null; from_step_id: number | null; to_step_id: number; snapshot: Record<string, unknown>; snapshot_fields?: Record<string, string>; snapshot_problems?: Record<string, { name: string; status: Problem['status'] }>; from_step_name?: string | null; to_step_name?: string | null; identifier: string | null; title: string | null }
export type Ticket = Base & { title: string; identifier: string; title_overridden: boolean; step_id: number; status: 'open' | 'closed'; closed_at: string | null; created_by: number; problem?: ProblemSummary | null; values?: Record<string, unknown>; events?: Event[] }
export type Page<T> = { items: T[]; total: number }
export type Column<T> = { title: string; render: (row: T) => React.ReactNode }
export const issueStatusLabel = (status: Problem['status']) => ({ identified: 'Identified', progress_fixing: 'Progress fixing', fixed: 'Fixed', recurring: 'Recurring', reappeared: 'Recurring' })[status]

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options })
  if (!res.ok) { const error = await res.json().catch(() => ({})); throw new Error(typeof error.detail === 'string' ? error.detail : `Request failed (${res.status})`) }
  const result = await res.json()
  const method = (options?.method ?? 'GET').toUpperCase()
  if ((path === '/auth/login' || path === '/auth/logout') && method === 'POST') {
    window.dispatchEvent(new Event('waymark:session-changed'))
  }
  if ((path === '/workspace' && method === 'PUT') ||
      (path === '/workspace/icon' && (method === 'POST' || method === 'DELETE'))) {
    window.dispatchEvent(new Event('waymark:workspace-changed'))
  }
  return result
}
export const send = <T,>(path: string, method: string, data?: unknown) => api<T>(path, { method, body: data === undefined ? undefined : JSON.stringify(data) })
export const date = (value?: string | null) => value ? new Date(value).toLocaleString() : '—'
export const errorText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong'
export function displayFieldValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(displayFieldValue).join(', ')
  if (value && typeof value === 'object') {
    const file = value as { name?: unknown; filename?: unknown }
    if (typeof file.name === 'string') return file.name
    if (typeof file.filename === 'string') return file.filename
    return JSON.stringify(value)
  }
  return value == null ? '' : String(value)
}

export function usePage<T>(path: string, refresh: number, limit: number, offset: number, enabled = true) {
  const [result, setResult] = useState<Page<T>>({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { if (!enabled) { setLoading(false); return }; let live = true; setLoading(true); api<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}limit=${limit}&offset=${offset}`).then(r => { if (live) { setResult(r); setError('') } }).catch(e => { if (live) setError(errorText(e)) }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [path, refresh, limit, offset, enabled])
  return { ...result, loading, error }
}

async function all<T>(path: string): Promise<T[]> {
  const output: T[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await api<Page<T>>(`${path}?limit=100&offset=${offset}`)
    output.push(...page.items)
    if (output.length >= page.total) return output
  }
}

export function DataTable<T extends Base>({ columns, rows, total, limit, offset, setLimit, setOffset, loading }: { columns: Column<T>[]; rows: T[]; total: number; limit: number; offset: number; setLimit: (n: number) => void; setOffset: (n: number) => void; loading: boolean }) {
  return <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-sm"><thead className="bg-[#f9fbfb] text-[11px] font-bold uppercase tracking-[.12em] text-[#778996]"><tr>{columns.map((c, i) => <th key={i} className="px-5 py-4">{c.title}</th>)}<th className="px-5 py-4">Created at ↓</th></tr></thead><tbody className="divide-y divide-[#eef2f4]">{rows.map(row => <tr key={row.id} className="hover:bg-[#fafcfc]">{columns.map((c, i) => <td key={i} className="px-5 py-4">{c.render(row)}</td>)}<td className="whitespace-nowrap px-5 py-4 text-[#728392]">{date(row.created_at)}</td></tr>)}{!rows.length && <tr><td colSpan={columns.length + 1} className="px-5 py-16 text-center text-[#7b8b98]">{loading ? 'Loading…' : 'Nothing here yet.'}</td></tr>}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eef2f4] px-5 py-3 text-sm text-[#728392]"><div className="flex items-center gap-3"><span>{total ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : '0 results'}</span><select aria-label="Rows per page" className="input !w-auto !py-1.5" value={limit} onChange={e => { setOffset(0); setLimit(Number(e.target.value)) }}>{[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} rows</option>)}</select></div><div className="flex gap-2"><button className="btn-secondary !p-2" aria-label="Previous page" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - limit))}><ChevronLeft size={16}/></button><button className="btn-secondary !p-2" aria-label="Next page" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}><ChevronRight size={16}/></button></div></div></div>
}

function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [bootstrap, setBootstrap] = useState(false)
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [key, setKey] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { const user = await send<User>(bootstrap ? '/auth/bootstrap' : '/auth/login', 'POST', bootstrap ? { email, password, key } : { email, password }); onLogin(user) } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  return <main className="flex min-h-screen items-center justify-center bg-[#edf4f3] p-5"><div className="w-full max-w-md"><div className="mb-8 flex items-center justify-center gap-3"><div className="rounded-xl bg-accent p-2.5 text-white"><TicketIcon size={25}/></div><span className="font-[Manrope] text-2xl font-extrabold tracking-tight">waymark<span className="text-accent">.</span></span></div><div className="card p-8"><p className="label text-accent">YOUR WORKSPACE</p><h1 className="mb-2 text-2xl font-extrabold">{bootstrap ? 'Set up your admin account' : 'Welcome back'}</h1><p className="mb-7 text-sm text-[#718292]">{bootstrap ? 'Enter the one-time key generated by Docker.' : 'Sign in to keep your tickets moving.'}</p><form onSubmit={submit} className="space-y-4">{bootstrap && <div><label className="label">Bootstrap key</label><input className="input" value={key} onChange={e => setKey(e.target.value)} required/></div>}<div><label className="label">Email</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required/></div><div><label className="label">Password</label><input className="input" type="password" minLength={bootstrap ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)} required/></div>{error && <p className="text-sm text-red-600">{error}</p>}<button disabled={busy} className="btn-primary w-full">{busy ? 'Please wait…' : bootstrap ? 'Create account' : 'Sign in'} <ArrowRight size={16}/></button></form><button className="mt-6 w-full text-center text-sm font-semibold text-accent" onClick={() => { setBootstrap(!bootstrap); setError('') }}>{bootstrap ? 'Back to sign in' : 'First time here? Set up admin'}</button></div></div></main>
}

function TenantWorkspaceBrand() {
  useEffect(() => {
    let live = true
    const clearBrand = () => {
      document.body.removeAttribute('data-workspace-role')
      document.body.removeAttribute('data-workspace-icon')
      document.body.style.removeProperty('--workspace-icon-url')
      document.querySelector('aside > div:first-child > span')?.removeAttribute('data-workspace-name')
      document.querySelector('header > div:first-child')?.removeAttribute('data-workspace-label')
    }
    const sync = async () => {
      try {
        const user = await api<User>('/auth/me')
        if (!live || user.role !== 'tenant') { clearBrand(); return }
        const workspace = await api<Tenant>('/workspace')
        if (!live) return
        const displayName = workspace.workspace_name || workspace.name
        document.body.dataset.workspaceRole = 'tenant'
        document.body.dataset.workspaceIcon = workspace.workspace_icon_url ? 'true' : 'false'
        document.body.style.setProperty('--workspace-icon-url', workspace.workspace_icon_url
          ? `url("${workspace.workspace_icon_url}?v=${encodeURIComponent(workspace.updated_at)}")` : 'none')
        const brand = document.querySelector('aside > div:first-child > span')
        brand?.setAttribute('data-workspace-name', displayName)
        document.querySelector('header > div:first-child')?.setAttribute('data-workspace-label', displayName)
      } catch { if (live) clearBrand() }
    }
    window.addEventListener('waymark:session-changed', sync)
    window.addEventListener('waymark:workspace-changed', sync)
    void sync()
    return () => { live = false; window.removeEventListener('waymark:session-changed', sync); window.removeEventListener('waymark:workspace-changed', sync); clearBrand() }
  }, [])
  return null
}

function FloatingModalBehavior() {
  useEffect(() => {
    const modalSelector = 'main form.card.mb-6, main form.card.mt-6, main [data-modal-detail="true"]'
    const previousFocus = new Map<Element, Element | null>()

    const sync = () => {
      const modals = Array.from(document.querySelectorAll(modalSelector))
      for (const modal of modals) {
        if (modal.getAttribute('data-floating-modal') === 'true') continue
        previousFocus.set(modal, document.activeElement)
        modal.setAttribute('data-floating-modal', 'true')
        modal.setAttribute('role', 'dialog')
        modal.setAttribute('aria-modal', 'true')

        const heading = modal.querySelector('h2, h3')
        if (heading) {
          if (!heading.id) heading.id = `dialog-title-${Math.random().toString(36).slice(2)}`
          modal.setAttribute('aria-labelledby', heading.id)
        }
        const closeButton = modal.querySelector('button[aria-label="Close ticket details"], button[aria-label="Close form"], button[type="button"]')
        if (closeButton && !closeButton.hasAttribute('aria-label')) closeButton.setAttribute('aria-label', 'Close dialog')
        requestAnimationFrame(() => {
          const firstControl = modal.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)')
          firstControl?.focus()
        })
      }

      for (const [modal, focus] of previousFocus) {
        if (!modal.isConnected) {
          previousFocus.delete(modal)
          if (focus instanceof HTMLElement && focus.isConnected) focus.focus()
        }
      }
      document.body.toggleAttribute('data-modal-open', modals.length > 0)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const modal = document.querySelector<HTMLElement>('[data-floating-modal="true"]')
      if (!modal) return
      if (event.key === 'Escape') {
        event.preventDefault()
        modal.querySelector<HTMLButtonElement>('button[aria-label="Close ticket details"], button[aria-label="Close form"], button[aria-label="Close dialog"]')?.click()
      } else if (event.key === 'Tab') {
        const controls = Array.from(modal.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          .filter(control => control.offsetParent !== null)
        if (!controls.length) return
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }

    const onBackdropClick = (event: MouseEvent) => {
      if (event.target !== document.body || !document.body.hasAttribute('data-modal-open')) return
      const modal = document.querySelector<HTMLElement>('[data-floating-modal="true"]')
      if (!modal) return
      const inside = (() => {
        const rect = modal.getBoundingClientRect()
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
      })()
      if (inside) return
      modal.querySelector<HTMLButtonElement>('button[aria-label="Close ticket details"], button[aria-label="Close form"], button[aria-label="Close dialog"]')?.click()
    }

    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('click', onBackdropClick)
    sync()
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('click', onBackdropClick)
      document.body.removeAttribute('data-modal-open')
      previousFocus.clear()
    }
  }, [])
  return null
}

type Section = 'overview' | 'tenants' | 'users' | 'tickets' | 'steps' | 'fields' | 'problems' | 'settings'
function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [section, setSection] = useState<Section>('overview')
  useEffect(() => { api<User>('/auth/me').then(setUser).catch(() => setUser(null)) }, [])
  if (user === undefined) return <div className="p-10">Loading…</div>
  if (!user) return <Auth onLogin={u => { setUser(u); setSection('overview') }}/>
  const isAdmin = user.role === 'admin'
  const nav: { id: Section; title: string; icon: React.ReactNode }[] = isAdmin ? [{ id: 'overview', title: 'Overview', icon: <LayoutDashboard size={18}/> }, { id: 'tenants', title: 'Tenants', icon: <Building2 size={18}/> }, { id: 'users', title: 'Tenant users', icon: <Users size={18}/> }] : [{ id: 'overview', title: 'Overview', icon: <LayoutDashboard size={18}/> }, { id: 'tickets', title: 'Tickets', icon: <TicketIcon size={18}/> }, { id: 'steps', title: 'Workflow steps', icon: <ListTodo size={18}/> }, { id: 'fields', title: 'Master fields', icon: <Layers3 size={18}/> }, { id: 'problems', title: 'Issues', icon: <Bug size={18}/> }, { id: 'settings', title: 'Settings', icon: <Settings2 size={18}/> }]
  return <div className="min-h-screen lg:flex"><aside className="flex shrink-0 flex-col border-b border-[#e5ebee] bg-white lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r"><div className="flex items-center gap-3 px-6 py-7"><div className="rounded-xl bg-accent p-2 text-white"><TicketIcon size={23}/></div><span className="font-[Manrope] text-xl font-extrabold tracking-tight">waymark<span className="text-accent">.</span></span></div><div className="px-5 pb-3 text-[10px] font-bold uppercase tracking-[.17em] text-[#9aaab2]">WORKSPACE</div><nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col">{nav.map(n => <button key={n.id} onClick={() => setSection(n.id)} className={`flex min-w-max items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${section === n.id ? 'bg-[#e7f4f1] text-[#08756e]' : 'text-[#6d7e8c] hover:bg-[#f5f8f8]'}`}>{n.icon}{n.title}</button>)}</nav><div className="mt-auto hidden border-t border-[#edf1f2] p-5 lg:block"><p className="truncate text-sm font-semibold">{user.email}</p><p className="mt-1 text-xs capitalize text-[#8a9aa5]">{isAdmin ? 'Platform admin' : 'Tenant workspace'}</p><button onClick={() => send('/auth/logout', 'POST').finally(() => setUser(null))} className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#718292] hover:text-accent"><LogOut size={16}/> Sign out</button></div></aside><main className="min-w-0 flex-1 lg:ml-64"><header className="flex items-center justify-between border-b border-[#e7edef] bg-white px-5 py-4 lg:px-10"><div className="text-xs font-semibold text-[#9aabb4]">Workspace <span className="mx-2">/</span> <span className="text-ink">{nav.find(n => n.id === section)?.title}</span></div><button className="flex items-center gap-2 text-sm text-[#687b89] lg:hidden" onClick={() => send('/auth/logout', 'POST').finally(() => setUser(null))}><LogOut size={16}/> Sign out</button><div className="hidden h-9 w-9 items-center justify-center rounded-full bg-[#daf0ec] text-sm font-bold text-accent lg:flex">{user.email[0].toUpperCase()}</div></header><div className="mx-auto max-w-7xl p-5 lg:p-10">{isAdmin ? <AdminPanel section={section} setSection={setSection}/> : <TenantPanel section={section} setSection={setSection}/>}</div></main></div>
}

export function Heading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) { return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="label !mb-2 text-accent">{eyebrow}</p><h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">{title}</h1><p className="mt-2 text-sm text-[#718292]">{subtitle}</p></div>{action}</div> }
export function Notice({ message }: { message: string }) { return message ? <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</div> : null }
function Actions({ edit, remove }: { edit: () => void; remove: () => void }) { return <div className="flex gap-1"><button title="Edit" className="btn-secondary !p-2" onClick={edit}><Pencil size={15}/></button><button title="Delete" className="btn-danger !p-2" onClick={remove}><Trash2 size={15}/></button></div> }
function AdminPanel({ section, setSection }: { section: Section; setSection: (s: Section) => void }) {
  const [version, reload] = useState(0), [limit, setLimit] = useState(20), [offset, setOffset] = useState(0), [error, setError] = useState(''), [editing, setEditing] = useState<number | null>(null), [showForm, setShowForm] = useState(false)
  const [name, setName] = useState(''), [slug, setSlug] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [tenantId, setTenantId] = useState(0)
  const [tenantList, setTenantList] = useState<Tenant[]>([]), [issuedKey, setIssuedKey] = useState('')
  useEffect(() => { if (section === 'users') all<Tenant>('/admin/tenants').then(setTenantList).catch(e => setError(errorText(e))) }, [version, section])
  const tenants = usePage<Tenant>('/admin/tenants', version, limit, offset, section === 'tenants')
  const users = usePage<User>('/admin/users', version, limit, offset, section === 'users')
  const isUsers = section === 'users'
  function openTenant(t?: Tenant) { setEditing(t?.id ?? null); setName(t?.name ?? ''); setSlug(t?.slug ?? ''); setShowForm(true); setError('') }
  function openUser(u?: User) { setEditing(u?.id ?? null); setEmail(u?.email ?? ''); setPassword(''); setTenantId(u?.tenant_id ?? tenantList[0]?.id ?? 0); setShowForm(true); setError('') }
  async function save(e: React.FormEvent) { e.preventDefault(); try { const result = await send<{ api_key?: string }>(isUsers ? `/admin/users${editing ? `/${editing}` : ''}` : `/admin/tenants${editing ? `/${editing}` : ''}`, editing ? 'PUT' : 'POST', isUsers ? { email, password, tenant_id: tenantId } : { name, slug }); setIssuedKey(result.api_key ?? ''); setShowForm(false); reload(version + 1) } catch (e) { setError(errorText(e)) } }
  async function rotateKey(id: number) { if (!confirm('Rotate this tenant API key? Existing file links and integrations using the old key will stop working.')) return; try { const result = await send<{ api_key: string }>(`/admin/tenants/${id}/api-key`, 'POST'); setIssuedKey(result.api_key) } catch (e) { setError(errorText(e)) } }
  async function remove(path: string) { if (!window.confirm('Delete this item?')) return; try { await send(path, 'DELETE'); reload(version + 1) } catch (e) { setError(errorText(e)) } }
  if (section === 'overview') return <><PlatformOverview/><div className="mt-6 grid gap-5 md:grid-cols-2"><button onClick={() => setSection('tenants')} className="card p-6 text-left hover:border-accent"><Building2 className="mb-4 text-accent" size={24}/><p className="text-sm font-bold">Manage tenants</p><p className="mt-1 text-xs text-[#718292]">Provision and manage tenant workspaces.</p></button><button onClick={() => setSection('users')} className="card p-6 text-left hover:border-accent"><Users className="mb-4 text-accent" size={24}/><p className="text-sm font-bold">Manage tenant users</p><p className="mt-1 text-xs text-[#718292]">Create and administer tenant accounts.</p></button></div></>
  if (section !== 'tenants' && section !== 'users') return null
  return <><Heading eyebrow="PLATFORM ADMINISTRATION" title={isUsers ? 'Tenant users' : 'Tenants'} subtitle={isUsers ? 'Give people access to their tenant workspace.' : 'Create and manage independent workspaces.'} action={<button className="btn-primary" onClick={() => isUsers ? openUser() : openTenant()}><Plus size={17}/> {isUsers ? 'Add user' : 'New tenant'}</button>}/><Notice message={error || (isUsers ? users.error : tenants.error)}/>{issuedKey && <div className="card mb-6 border-accent p-5"><div className="flex justify-between"><b>Tenant API key — copy it now</b><button onClick={() => setIssuedKey('')}><X size={18}/></button></div><p className="my-2 break-all rounded bg-[#f5f8f8] p-3 font-mono text-xs">{issuedKey}</p><p className="text-xs text-[#718292]">This key is shown only once. Keep it secret; rotating it revokes access links and integrations using the previous key.</p><button className="btn-secondary mt-3" onClick={() => navigator.clipboard.writeText(issuedKey)}>Copy API key</button></div>}{showForm && <form onSubmit={save} className="card mb-6 grid gap-4 p-6 md:grid-cols-2"><div className="col-span-full flex justify-between"><h2 className="font-bold">{editing ? 'Edit' : 'Create'} {isUsers ? 'user' : 'tenant'}</h2><button type="button" onClick={() => setShowForm(false)}><X size={18}/></button></div>{isUsers ? <><div><label className="label">Email</label><input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)}/></div><div><label className="label">Tenant</label><select className="input" required value={tenantId} onChange={e => setTenantId(Number(e.target.value))}><option value={0}>Select tenant</option>{tenantList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div><div><label className="label">{editing ? 'New password' : 'Password'} (12+ characters)</label><input className="input" type="password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)}/></div></> : <><div><label className="label">Name</label><input className="input" required value={name} onChange={e => setName(e.target.value)}/></div><div><label className="label">Slug</label><input className="input" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={e => setSlug(e.target.value)} placeholder="my-workspace"/></div></>}<div className="col-span-full"><button className="btn-primary">Save {isUsers ? 'user' : 'tenant'}</button></div></form>}{isUsers ? <DataTable columns={[{ title: 'Email', render: u => <b>{u.email}</b> }, { title: 'Tenant', render: u => tenantList.find(t => t.id === u.tenant_id)?.name ?? `#${u.tenant_id}` }, { title: 'Actions', render: u => <Actions edit={() => openUser(u)} remove={() => remove(`/admin/users/${u.id}`)}/> }]} rows={users.items} total={users.total} loading={users.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset}/> : <DataTable columns={[{ title: 'Name', render: t => <b>{t.name}</b> }, { title: 'Slug', render: t => <span className="rounded-md bg-[#eef5f5] px-2 py-1 font-mono text-xs text-accent">{t.slug}</span> }, { title: 'Actions', render: t => <div className="flex items-center gap-2"><button className="btn-secondary !px-2 !py-2 text-xs" onClick={() => rotateKey(t.id)}>Rotate API key</button><Actions edit={() => openTenant(t)} remove={() => remove(`/admin/tenants/${t.id}`)}/></div> }]} rows={tenants.items} total={tenants.total} loading={tenants.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset}/>}</>
}

function TenantPanel({ section, setSection }: { section: Section; setSection: (s: Section) => void }) {
  const [version, reload] = useState(0), [fields, setFields] = useState<Field[]>([]), [steps, setSteps] = useState<Step[]>([]), [problems, setProblems] = useState<Problem[]>([]), [error, setError] = useState('')
  const [workspace, setWorkspace] = useState<Tenant | null>(null)
  useEffect(() => { Promise.all([all<Field>('/fields'), all<Step>('/steps'), all<Problem>('/issues')]).then(([f, s, p]) => { setFields(f); setSteps(s); setProblems(p) }).catch(e => setError(errorText(e))) }, [version])
  useEffect(() => { api<Tenant>('/workspace').then(setWorkspace).catch(e => setError(errorText(e))) }, [version])
  const updated = () => { reload(v => v + 1); setError('') }
  if (section === 'overview') return <><TenantOverview/><div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{([{ id: 'tickets', title: 'Tickets', desc: 'Track and move requests', icon: <TicketIcon size={24}/> }, { id: 'steps', title: 'Workflow steps', desc: `${steps.length} steps configured`, icon: <ListTodo size={24}/> }, { id: 'fields', title: 'Master fields', desc: `${fields.length} reusable fields`, icon: <Layers3 size={24}/> }, { id: 'problems', title: 'Issues', desc: `${problems.length} shared issue records`, icon: <Bug size={24}/> }] as const).map(item => <button key={item.id} onClick={() => setSection(item.id)} className="card p-6 text-left hover:border-accent"><div className="mb-4 text-accent">{item.icon}</div><h2 className="font-extrabold">{item.title}</h2><p className="mt-1 text-sm text-[#718292]">{item.desc}</p><p className="mt-5 text-sm font-bold text-accent">Open {item.title.toLowerCase()} →</p></button>)}</div></>
  return <><Notice message={error}/>{section === 'fields' ? <FieldsPanel fields={fields} updated={updated}/> : section === 'steps' ? <StepsPanel steps={steps} fields={fields} updated={updated}/> : section === 'problems' ? <IssuesPanel issues={problems} updated={updated}/> : section === 'tickets' ? <TicketWorkspace steps={steps} fields={fields} problems={problems} identifierLabel={workspace?.identifier_label ?? 'Company name'} updated={updated}/> : section === 'settings' ? <SettingsPanel workspace={workspace} updated={updated}/> : null}</>
}

function SettingsPanel({ workspace, updated }: { workspace: Tenant | null; updated: () => void }) {
  const [label, setLabel] = useState(''), [workspaceName, setWorkspaceName] = useState(''), [error, setError] = useState('')
  const [iconBusy, setIconBusy] = useState(false), [iconVersion, setIconVersion] = useState(Date.now())
  useEffect(() => { setLabel(workspace?.identifier_label ?? ''); setWorkspaceName(workspace?.workspace_name ?? workspace?.name ?? '') }, [workspace?.identifier_label, workspace?.workspace_name, workspace?.name, workspace?.updated_at])
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try { await send('/workspace', 'PUT', { identifier_label: label, workspace_name: workspaceName }); updated() } catch (e) { setError(errorText(e)) }
  }
  async function uploadIcon(file?: File) {
    if (!file) return
    setIconBusy(true); setError('')
    try {
      const form = new FormData(); form.append('file', file)
      const response = await fetch('/api/workspace/icon', { method: 'POST', credentials: 'same-origin', body: form })
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || `Icon upload failed (${response.status})`) }
      await response.json(); setIconVersion(Date.now()); window.dispatchEvent(new Event('waymark:workspace-changed')); updated()
    } catch (e) { setError(errorText(e)) } finally { setIconBusy(false) }
  }
  async function removeIcon() {
    try { await send('/workspace/icon', 'DELETE'); setIconVersion(Date.now()); updated() } catch (e) { setError(errorText(e)) }
  }
  const iconSrc = workspace?.workspace_icon_url ? `${workspace.workspace_icon_url}?v=${iconVersion}` : ''
  return <><Heading eyebrow="WORKSPACE SETTINGS" title="Workspace identity" subtitle="Choose the name and icon tenant users see throughout this workspace."/><Notice message={error}/><div className="max-w-2xl space-y-5"><form onSubmit={save} className="card space-y-5 p-6"><div><label className="label">Workspace name</label><input className="input" maxLength={120} required value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="My workspace"/><p className="mt-2 text-xs text-[#82929b]">This display name is separate from the platform tenant name.</p></div><div><label className="label">Ticket identifier label</label><input className="input" maxLength={80} required value={label} onChange={e => setLabel(e.target.value)} placeholder="Nama Perusahaan"/><p className="mt-2 text-xs text-[#82929b]">For example, “Nama Perusahaan” labels the identifier shown on every ticket.</p></div><button className="btn-primary">Save settings</button></form><section className="card flex flex-wrap items-center gap-5 p-6"><div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-[#e5f3f0] text-xl font-extrabold text-accent">{iconSrc ? <img src={iconSrc} alt="Workspace icon preview" className="h-full w-full object-cover"/> : (workspaceName.trim()[0]?.toUpperCase() || 'W')}</div><div className="min-w-[200px] flex-1"><h2 className="font-[Manrope] font-extrabold">Workspace icon</h2><p className="mt-1 text-xs text-[#82929b]">PNG, JPEG or WebP. Images are resized to a 256 px square icon.</p><div className="mt-3 flex flex-wrap gap-2"><label className={`btn-secondary cursor-pointer !py-2 ${iconBusy ? 'pointer-events-none opacity-50' : ''}`}>{iconBusy ? 'Uploading…' : workspace?.workspace_icon_url ? 'Replace icon' : 'Upload icon'}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={iconBusy} onChange={e => { void uploadIcon(e.target.files?.[0]); e.currentTarget.value = '' }}/></label>{workspace?.workspace_icon_url && <button className="btn-danger !py-2" onClick={removeIcon}>Remove icon</button>}</div></div></section></div></>
}

export function LegacyProblemsPanelBeforeProblemChanges({ problems, updated }: { problems: Problem[]; updated: () => void }) {
  const [limit, setLimit] = useState(20), [offset, setOffset] = useState(0), [version, reload] = useState(0)
  const result = usePage<Problem>('/issues', version, limit, offset)
  const [editing, setEditing] = useState<Problem | null>(null), [show, setShow] = useState(false)
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [status, setStatus] = useState<Problem['status']>('identified'), [error, setError] = useState('')
  const done = () => { reload(v => v + 1); updated(); setShow(false); setEditing(null); setError('') }
  const open = (problem?: Problem) => { setEditing(problem ?? null); setName(problem?.name ?? ''); setDescription(problem?.description ?? ''); setStatus(problem?.status ?? 'identified'); setError(''); setShow(true) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try { await send(`/issues${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST', { name, description, status }); done() }
    catch (e) { setError(errorText(e)) }
  }
  async function remove(problem: Problem) {
    if (!confirm(`Delete problem “${problem.name}”? Problems referenced by tickets cannot be deleted.`)) return
    try { await send(`/issues/${problem.id}`, 'DELETE'); done() } catch (e) { setError(errorText(e)) }
  }
  const label = (value: Problem['status']) => ({ identified: 'Identified', progress_fixing: 'Progress fixing', fixed: 'Fixed', recurring: 'Recurring', reappeared: 'Recurring' })[value]
  return <><Heading eyebrow="WORKFLOW MASTER DATA" title="Problems" subtitle="Manage reusable problems and track their resolution status." action={<button className="btn-primary" onClick={() => open()}><Plus size={17}/> New problem</button>}/><Notice message={error || result.error}/>{show && <form onSubmit={save} className="card mb-6 grid gap-4 p-6 md:grid-cols-2"><div><label className="label">Problem name</label><input className="input" required maxLength={160} value={name} onChange={e => setName(e.target.value)} placeholder="PIB not available"/></div><div><label className="label">Status</label>{editing?.status === 'reappeared' ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700">Reappeared <span className="ml-1 text-xs font-normal">(set automatically when selected again after being fixed)</span></div> : <select className="input" value={status} onChange={e => setStatus(e.target.value as Problem['status'])}><option value="identified">Identified</option><option value="progress_fixing">Progress fixing</option><option value="fixed">Fixed</option></select>}</div><div className="md:col-span-2"><label className="label">Description</label><textarea className="input min-h-24" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional details about the known problem."/></div><div className="flex gap-2 md:col-span-2"><button className="btn-primary">{editing ? 'Save problem' : 'Create problem'}</button><button type="button" className="btn-secondary" onClick={() => setShow(false)}>Cancel</button></div></form>}<DataTable rows={result.items} total={result.total} loading={result.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset} columns={[{ title: 'Problem', render: p => <div><b>{p.name}</b>{p.description && <p className="mt-1 max-w-md truncate text-xs text-[#82929b]">{p.description}</p>}</div> }, { title: 'Status', render: p => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${p.status === 'fixed' ? 'bg-emerald-50 text-emerald-700' : p.status === 'reappeared' ? 'bg-amber-50 text-amber-700' : 'bg-[#eef4f5] text-[#5f7380]'}`}>{label(p.status)}</span> }, { title: 'Problem step', render: p => p.generated_step_id ? <span className="rounded-md bg-[#eef5f5] px-2 py-1 text-xs font-semibold text-accent">Generated</span> : <span className="text-xs text-[#9aa8af]">Generated on first use</span> }, { title: 'Actions', render: p => <Actions edit={() => open(p)} remove={() => remove(p)}/> }]} /><p className="mt-4 text-xs text-[#8998a1]">{problems.length} active Problem records. A workflow step is generated when a ticket first selects a Problem. Selecting a fixed Problem marks it Reappeared automatically.</p></>
}

export function LegacyProblemsPanel({ problems, updated }: { problems: Problem[]; updated: () => void }) {
  const [limit, setLimit] = useState(20), [offset, setOffset] = useState(0), [version, reload] = useState(0)
  const result = usePage<Problem>('/issues', version, limit, offset)
  const [editing, setEditing] = useState<Problem | null>(null), [show, setShow] = useState(false)
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [status, setStatus] = useState<Problem['status']>('identified'), [error, setError] = useState('')
  const done = () => { reload(v => v + 1); updated(); setShow(false); setEditing(null); setError('') }
  const open = (problem?: Problem) => { setEditing(problem ?? null); setName(problem?.name ?? ''); setDescription(problem?.description ?? ''); setStatus(problem?.status ?? 'identified'); setError(''); setShow(true) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try { await send(`/issues${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST', { name, description, status }); done() }
    catch (e) { setError(errorText(e)) }
  }
  async function remove(problem: Problem) {
    if (!confirm(`Delete problem “${problem.name}”? Problems attached to tickets cannot be deleted.`)) return
    try { await send(`/issues/${problem.id}`, 'DELETE'); done() } catch (e) { setError(errorText(e)) }
  }
  const label = (value: Problem['status']) => ({ identified: 'Identified', progress_fixing: 'Progress fixing', fixed: 'Fixed', recurring: 'Recurring', reappeared: 'Recurring' })[value]
  return <><Heading eyebrow="TICKET MASTER DATA" title="Problems" subtitle="Problem records attach directly to tickets; workflow steps remain independent." action={<button className="btn-primary" onClick={() => open()}><Plus size={17}/> New problem</button>}/><Notice message={error || result.error}/>{show && <form onSubmit={save} className="card mb-6 grid gap-4 p-6 md:grid-cols-2"><div><label className="label">Problem name</label><input className="input" required maxLength={160} value={name} onChange={e => setName(e.target.value)} placeholder="PIB unavailable"/></div><div><label className="label">Status</label>{editing?.status === 'reappeared' ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700">Reappeared <span className="ml-1 text-xs font-normal">(set automatically)</span></div> : <select className="input" value={status} onChange={e => setStatus(e.target.value as Problem['status'])}><option value="identified">Identified</option><option value="progress_fixing">Progress fixing</option><option value="fixed">Fixed</option></select>}</div><div className="md:col-span-2"><label className="label">Description</label><textarea className="input min-h-24" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional details about the known problem."/></div><div className="flex gap-2 md:col-span-2"><button className="btn-primary">{editing ? 'Save problem' : 'Create problem'}</button><button type="button" className="btn-secondary" onClick={() => setShow(false)}>Cancel</button></div></form>}<DataTable rows={result.items} total={result.total} loading={result.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset} columns={[{ title: 'Problem', render: p => <div><b>{p.name}</b>{p.description && <p className="mt-1 max-w-md truncate text-xs text-[#82929b]">{p.description}</p>}</div> }, { title: 'Status', render: p => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${p.status === 'fixed' ? 'bg-emerald-50 text-emerald-700' : p.status === 'reappeared' ? 'bg-amber-50 text-amber-700' : 'bg-[#eef4f5] text-[#5f7380]'}`}>{label(p.status)}</span> }, { title: 'Ticket behavior', render: p => <span className="text-xs text-[#718292]">{p.status === 'fixed' ? 'Linked open tickets are closed' : 'Attached on steps that use Problem'}</span> }, { title: 'Actions', render: p => <Actions edit={() => open(p)} remove={() => remove(p)}/> }]} /><p className="mt-4 text-xs text-[#8998a1]">{problems.length} active Problems. Add the Problem master field to any step where users can set or change ticket metadata. Fixed Problems close their open tickets without changing workflow steps.</p></>
}

export function LegacyProblemsPanelWithAttachments({ problems, updated }: { problems: Problem[]; updated: () => void }) {
  const [limit, setLimit] = useState(20), [offset, setOffset] = useState(0), [version, reload] = useState(0)
  const result = usePage<Problem>('/issues', version, limit, offset)
  const [editing, setEditing] = useState<Problem | null>(null), [show, setShow] = useState(false)
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [status, setStatus] = useState<Problem['status']>('identified')
  const [attachments, setAttachments] = useState<ProblemAttachment[]>([]), [uploading, setUploading] = useState(false), [error, setError] = useState('')
  const done = () => { reload(v => v + 1); updated(); setShow(false); setEditing(null); setError('') }
  const open = (problem?: Problem) => {
    setEditing(problem ?? null); setName(problem?.name ?? ''); setDescription(problem?.description ?? '')
    setStatus(problem?.status ?? 'identified'); setAttachments(problem?.files ?? []); setError(''); setShow(true)
  }
  async function uploadFiles(list: FileList | null) {
    if (!list?.length) return
    setUploading(true); setError('')
    try {
      for (const file of Array.from(list).slice(0, Math.max(0, 20 - attachments.length))) {
        const form = new FormData(); form.append('file', file)
        const response = await fetch('/api/files', { method: 'POST', credentials: 'same-origin', body: form })
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || `Upload failed (${response.status})`) }
        const uploaded = await response.json() as ProblemAttachment
        setAttachments(current => [...current, uploaded])
      }
    } catch (e) { setError(errorText(e)) } finally { setUploading(false) }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      await send(`/issues${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST',
        { name, description, status, file_ids: attachments.map(file => file.file_id) })
      done()
    } catch (e) { setError(errorText(e)) }
  }
  async function remove(problem: Problem) {
    if (!confirm(`Delete problem “${problem.name}”? Problems attached to tickets cannot be deleted.`)) return
    try { await send(`/issues/${problem.id}`, 'DELETE'); done() } catch (e) { setError(errorText(e)) }
  }
  const statusLabel = (value: Problem['status']) => ({ identified: 'Identified', progress_fixing: 'Progress fixing', fixed: 'Fixed', recurring: 'Recurring', reappeared: 'Recurring' })[value]
  return <><Heading eyebrow="TICKET MASTER DATA" title="Problems" subtitle="Manage ticket-level problems and attach supporting files." action={<button className="btn-primary" onClick={() => open()}><Plus size={17}/> New problem</button>}/><Notice message={error || result.error}/>{show && <form onSubmit={save} className="card mb-6 grid gap-4 p-6 md:grid-cols-2">
    <div><label className="label">Problem name</label><input className="input" required maxLength={160} value={name} onChange={e => setName(e.target.value)}/></div>
    <div><label className="label">Status</label><select className="input" value={status} onChange={e => setStatus(e.target.value as Problem['status'])}><option value="identified">Identified</option><option value="progress_fixing">Progress fixing</option><option value="fixed">Fixed</option><option value="reappeared" disabled>Reappeared (automatic)</option></select>{status === 'reappeared' && <p className="mt-1 text-xs text-[#82929b]">Choose an active status to continue working on this problem.</p>}</div>
    <div className="md:col-span-2"><label className="label">Description</label><textarea className="input min-h-24" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)}/></div>
    <div className="md:col-span-2"><label className="label">Attachments ({attachments.length}/20)</label><input className="input" type="file" multiple disabled={uploading || attachments.length >= 20} onChange={e => { void uploadFiles(e.target.files); e.currentTarget.value = '' }}/>{uploading && <p className="mt-1 text-xs text-[#718292]">Uploading…</p>}<div className="mt-2 space-y-2">{attachments.map(file => <div key={file.file_id} className="flex items-center justify-between gap-3 rounded-lg bg-[#f7f9f9] px-3 py-2 text-sm"><a className="truncate font-semibold text-accent underline" href={file.access_url} target="_blank" rel="noreferrer">{file.name}</a><button type="button" className="text-xs font-bold text-red-600" onClick={() => setAttachments(current => current.filter(item => item.file_id !== file.file_id))}>Remove</button></div>)}</div></div>
    <div className="flex gap-2 md:col-span-2"><button className="btn-primary" disabled={uploading}>{editing ? 'Save problem' : 'Create problem'}</button><button type="button" className="btn-secondary" onClick={() => setShow(false)}>Cancel</button></div>
  </form>}<DataTable rows={result.items} total={result.total} loading={result.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset} columns={[{ title: 'Problem', render: p => <div><b>{p.name}</b>{p.description && <p className="mt-1 max-w-md truncate text-xs text-[#82929b]">{p.description}</p>}</div> }, { title: 'Attachments', render: p => p.files.length ? <div className="flex max-w-sm flex-wrap gap-1">{p.files.map(file => <a key={file.file_id} className="rounded bg-[#eef5f5] px-2 py-1 text-xs font-semibold text-accent hover:underline" href={file.access_url} target="_blank" rel="noreferrer">{file.name}</a>)}</div> : <span className="text-xs text-[#a1adb4]">—</span> }, { title: 'Status', render: p => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${p.status === 'fixed' ? 'bg-emerald-50 text-emerald-700' : p.status === 'reappeared' ? 'bg-amber-50 text-amber-700' : 'bg-[#eef4f5] text-[#5f7380]'}`}>{statusLabel(p.status)}</span> }, { title: 'Actions', render: p => <Actions edit={() => open(p)} remove={() => remove(p)}/> }]} /><p className="mt-4 text-xs text-[#8998a1]">{problems.length} active Problem records. Attachments are protected by this tenant’s file-access key.</p></>
}

function IssuesPanel({ issues, updated }: { issues: Problem[]; updated: () => void }) {
  const [limit, setLimit] = useState(20), [offset, setOffset] = useState(0), [version, reload] = useState(0)
  const result = usePage<Problem>('/issues', version, limit, offset)
  const [editing, setEditing] = useState<Problem | null>(null), [show, setShow] = useState(false)
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [status, setStatus] = useState<Problem['status']>('identified')
  const [attachments, setAttachments] = useState<ProblemAttachment[]>([]), [uploading, setUploading] = useState(false), [error, setError] = useState('')
  const done = () => { reload(v => v + 1); updated(); setShow(false); setEditing(null); setError('') }
  const open = (issue?: Problem) => {
    setEditing(issue ?? null); setName(issue?.name ?? ''); setDescription(issue?.description ?? '')
    setStatus(issue?.status ?? 'identified'); setAttachments(issue?.files ?? []); setError(''); setShow(true)
  }
  async function uploadFiles(list: FileList | null) {
    if (!list?.length) return
    setUploading(true); setError('')
    try {
      for (const file of Array.from(list).slice(0, Math.max(0, 20 - attachments.length))) {
        const form = new FormData(); form.append('file', file)
        const response = await fetch('/api/files', { method: 'POST', credentials: 'same-origin', body: form })
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || `Upload failed (${response.status})`) }
        const uploaded = await response.json() as ProblemAttachment
        setAttachments(current => [...current, uploaded])
      }
    } catch (e) { setError(errorText(e)) } finally { setUploading(false) }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      await send(`/issues${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST',
        { name, description, status, file_ids: attachments.map(file => file.file_id) })
      done()
    } catch (e) { setError(errorText(e)) }
  }
  async function remove(issue: Problem) {
    if (!confirm(`Delete issue “${issue.name}”? Issues attached to tickets cannot be deleted.`)) return
    try { await send(`/issues/${issue.id}`, 'DELETE'); done() } catch (e) { setError(errorText(e)) }
  }
  const statusLabel = (value: Problem['status']) => ({ identified: 'Identified', progress_fixing: 'Progress fixing', fixed: 'Fixed', recurring: 'Recurring', reappeared: 'Recurring' })[value]
  return <><Heading eyebrow="TICKET MASTER DATA" title="Issues" subtitle="Manage issue records, statuses and supporting files attached to tickets." action={<button className="btn-primary" onClick={() => open()}><Plus size={17}/> New issue</button>}/><Notice message={error || result.error}/>{show && <form onSubmit={save} className="card mb-6 grid gap-4 p-6 md:grid-cols-2">
    <div><label className="label">Issue name</label><input className="input" required maxLength={160} value={name} onChange={e => setName(e.target.value)} placeholder="PIB unavailable"/></div>
    <div><label className="label">Status</label><select className="input" value={status} onChange={e => setStatus(e.target.value as Problem['status'])}><option value="identified">Identified</option><option value="progress_fixing">Progress fixing</option><option value="fixed">Fixed</option><option value="recurring" disabled>Recurring (automatic)</option></select>{status === 'recurring' && <p className="mt-1 text-xs text-[#82929b]">Choose an active status to continue working on this issue.</p>}</div>
    <div className="md:col-span-2"><label className="label">Description</label><textarea className="input min-h-24" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional details about the issue."/></div>
    <div className="md:col-span-2"><label className="label">Attachments ({attachments.length}/20)</label><input className="input" type="file" multiple disabled={uploading || attachments.length >= 20} onChange={e => { void uploadFiles(e.target.files); e.currentTarget.value = '' }}/>{uploading && <p className="mt-1 text-xs text-[#718292]">Uploading…</p>}<div className="mt-2 space-y-2">{attachments.map(file => <div key={file.file_id} className="flex items-center justify-between gap-3 rounded-lg bg-[#f7f9f9] px-3 py-2 text-sm"><a className="truncate font-semibold text-accent underline" href={file.access_url} target="_blank" rel="noreferrer">{file.name}</a><button type="button" className="text-xs font-bold text-red-600" onClick={() => setAttachments(current => current.filter(item => item.file_id !== file.file_id))}>Remove</button></div>)}</div></div>
    <div className="flex gap-2 md:col-span-2"><button className="btn-primary" disabled={uploading}>{editing ? 'Save issue' : 'Create issue'}</button><button type="button" className="btn-secondary" onClick={() => setShow(false)}>Cancel</button></div>
  </form>}<DataTable rows={result.items} total={result.total} loading={result.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset} columns={[{ title: 'Issue', render: issue => <div><b>{issue.name}</b>{issue.description && <p className="mt-1 max-w-md truncate text-xs text-[#82929b]">{issue.description}</p>}</div> }, { title: 'Attachments', render: issue => issue.files.length ? <div className="flex max-w-sm flex-wrap gap-1">{issue.files.map(file => <a key={file.file_id} className="rounded bg-[#eef5f5] px-2 py-1 text-xs font-semibold text-accent hover:underline" href={file.access_url} target="_blank" rel="noreferrer">{file.name}</a>)}</div> : <span className="text-xs text-[#a1adb4]">—</span> }, { title: 'Status', render: issue => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${issue.status === 'fixed' ? 'bg-emerald-50 text-emerald-700' : issue.status === 'reappeared' ? 'bg-amber-50 text-amber-700' : 'bg-[#eef4f5] text-[#5f7380]'}`}>{statusLabel(issue.status)}</span> }, { title: 'Actions', render: issue => <Actions edit={() => open(issue)} remove={() => remove(issue)}/> }]} /><p className="mt-4 text-xs text-[#8998a1]">{issues.length} active issues. Fixed issues close linked open tickets; selecting a fixed issue again marks it Recurring.</p></>
}

export function LegacyFieldsPanel({ fields, updated }: { fields: Field[]; updated: () => void }) {
  const [limit, setLimit] = useState(20), [offset, setOffset] = useState(0), [version, reload] = useState(0)
  const result = usePage<Field>('/fields', version, limit, offset)
  const [editing, setEditing] = useState<number | null>(null), [show, setShow] = useState(false), [name, setName] = useState(''), [key, setKey] = useState(''), [type, setType] = useState<Field['type']>('text'), [options, setOptions] = useState(''), [error, setError] = useState('')
  const done = () => { reload(v => v + 1); updated(); setShow(false) }
  const open = (f?: Field) => { setEditing(f?.id ?? null); setName(f?.name ?? ''); setKey(f?.key ?? ''); setType(f?.type ?? 'text'); setOptions(f?.options.join(', ') ?? ''); setShow(true); setError('') }
  async function save(e: React.FormEvent) { e.preventDefault(); try { await send(`/fields${editing ? `/${editing}` : ''}`, editing ? 'PUT' : 'POST', { name, key, type, options: type === 'select' ? options.split(',').map(s => s.trim()).filter(Boolean) : [] }); done() } catch (e) { setError(errorText(e)) } }
  async function remove(id: number) { if (!confirm('Delete this master field?')) return; try { await send(`/fields/${id}`, 'DELETE'); done() } catch (e) { setError(errorText(e)) } }
  return <><Heading eyebrow="WORKFLOW BUILDER" title="Master fields" subtitle="Create fields once and reuse them across workflow steps." action={<button className="btn-primary" onClick={() => open()}><Plus size={17}/> New field</button>}/><Notice message={error || result.error}/>{show && <form onSubmit={save} className="card mb-6 grid gap-4 p-6 md:grid-cols-2"><div className="col-span-full flex justify-between"><h2 className="font-bold">{editing ? 'Edit field' : 'New field'}</h2><button type="button" onClick={() => setShow(false)}><X size={18}/></button></div><div><label className="label">Name</label><input className="input" required value={name} onChange={e => setName(e.target.value)}/></div><div><label className="label">Key</label><input className="input" required pattern="[a-z][a-z0-9_]*" disabled={!!editing} value={key} onChange={e => setKey(e.target.value)} placeholder="customer_name"/></div><div><label className="label">Type</label><select className="input" disabled={!!editing} value={type} onChange={e => setType(e.target.value as Field['type'])}>{['text', 'number', 'date', 'boolean', 'select', 'array', 'file', 'problem'].map(t => <option key={t}>{t}</option>)}</select></div>{type === 'select' && <div><label className="label">Options (comma-separated)</label><input className="input" required value={options} onChange={e => setOptions(e.target.value)}/></div>}{type === 'array' && <p className="text-xs text-[#718292]">Array fields accept any number of string values, entered separately on ticket forms.</p>}{type === 'file' && <p className="text-xs text-[#718292]">Upload a tenant-owned file; links use this tenant’s API key.</p>}{type === 'problem' && <p className="text-xs text-[#718292]">Problem choices come from Problem master data. Each step can use this field once; each Problem gets its own generated step.</p>}<div className="col-span-full"><button className="btn-primary">Save field</button></div></form>}<DataTable columns={[{ title: 'Field', render: f => <b>{f.name}</b> }, { title: 'Key', render: f => <span className="font-mono text-xs text-accent">{f.key}</span> }, { title: 'Type', render: f => <span className="capitalize">{f.type}</span> }, { title: 'Actions', render: f => <Actions edit={() => open(f)} remove={() => remove(f.id)}/> }]} rows={result.items} total={result.total} loading={result.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset}/><p className="mt-4 text-xs text-[#8a9aa5]">{fields.length} fields available for step forms.</p></>
}

export function LegacyFieldsPanelWithOriginalTerms({ fields, updated }: { fields: Field[]; updated: () => void }) {
  const [limit, setLimit] = useState(20), [offset, setOffset] = useState(0), [version, reload] = useState(0)
  const result = usePage<Field>('/fields', version, limit, offset)
  const [editing, setEditing] = useState<number | null>(null), [show, setShow] = useState(false)
  const [name, setName] = useState(''), [key, setKey] = useState(''), [type, setType] = useState<Field['type']>('text')
  const [options, setOptions] = useState(''), [error, setError] = useState('')
  const done = () => { reload(v => v + 1); updated(); setShow(false) }
  const open = (field?: Field) => {
    setEditing(field?.id ?? null); setName(field?.name ?? ''); setKey(field?.key ?? '')
    setType(field?.type ?? 'text'); setOptions(field?.options.join(', ') ?? ''); setError(''); setShow(true)
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      await send(`/fields${editing ? `/${editing}` : ''}`, editing ? 'PUT' : 'POST', {
        name, key, type, options: type === 'select' ? options.split(',').map(value => value.trim()).filter(Boolean) : [],
      })
      done()
    } catch (e) { setError(errorText(e)) }
  }
  async function remove(field: Field) {
    if (!confirm(`Delete master field “${field.name}”?`)) return
    try { await send(`/fields/${field.id}`, 'DELETE'); done() } catch (e) { setError(errorText(e)) }
  }
  return <><Heading eyebrow="WORKFLOW BUILDER" title="Master fields" subtitle="Create reusable fields and attach them to workflow steps." action={<button className="btn-primary" onClick={() => open()}><Plus size={17}/> New field</button>}/><Notice message={error || result.error}/>{show && <form onSubmit={save} className="card mb-6 grid gap-4 p-6 md:grid-cols-2"><div><label className="label">Name</label><input className="input" required value={name} onChange={e => setName(e.target.value)}/></div><div><label className="label">Key</label><input className="input" required pattern="[a-z][a-z0-9_]*" disabled={!!editing} value={key} onChange={e => setKey(e.target.value)} placeholder="customer_name"/></div><div><label className="label">Type</label><select className="input" disabled={!!editing} value={type} onChange={e => setType(e.target.value as Field['type'])}>{['text', 'number', 'date', 'boolean', 'select', 'array', 'file', 'problem'].map(value => <option key={value}>{value}</option>)}</select></div>{type === 'select' && <div><label className="label">Options (comma-separated)</label><input className="input" required value={options} onChange={e => setOptions(e.target.value)}/></div>}{type === 'array' && <p className="text-xs text-[#718292]">Enter free-form string values on the ticket form; exports join them with commas.</p>}{type === 'file' && <p className="text-xs text-[#718292]">Upload a tenant-owned file from the ticket form.</p>}{type === 'problem' && <p className="text-xs text-[#718292]">Selecting this field lets the step set the ticket’s Problem. The association remains on the ticket when it moves to other steps.</p>}<div className="flex gap-2 md:col-span-2"><button className="btn-primary">{editing ? 'Save field' : 'Create field'}</button><button type="button" className="btn-secondary" onClick={() => setShow(false)}>Cancel</button></div></form>}<DataTable rows={result.items} total={result.total} loading={result.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset} columns={[{ title: 'Field', render: field => <b>{field.name}</b> }, { title: 'Key', render: field => <span className="font-mono text-xs text-accent">{field.key}</span> }, { title: 'Type', render: field => <span className="capitalize">{field.type}</span> }, { title: 'Actions', render: field => <Actions edit={() => open(field)} remove={() => remove(field)}/> }]} /><p className="mt-4 text-xs text-[#8a9aa5]">{fields.length} reusable fields. Problem choices are managed separately from this catalog.</p></>
}

function FieldsPanel({ fields, updated }: { fields: Field[]; updated: () => void }) {
  const [limit, setLimit] = useState(20), [offset, setOffset] = useState(0), [version, reload] = useState(0)
  const result = usePage<Field>('/fields', version, limit, offset)
  const [editing, setEditing] = useState<number | null>(null), [show, setShow] = useState(false)
  const [name, setName] = useState(''), [key, setKey] = useState(''), [type, setType] = useState<Field['type']>('text')
  const [options, setOptions] = useState(''), [error, setError] = useState('')
  const done = () => { reload(v => v + 1); updated(); setShow(false) }
  const open = (field?: Field) => {
    setEditing(field?.id ?? null); setName(field?.name ?? ''); setKey(field?.key ?? '')
    setType(field?.type ?? 'text'); setOptions(field?.options.join(', ') ?? ''); setError(''); setShow(true)
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try { await send(`/fields${editing ? `/${editing}` : ''}`, editing ? 'PUT' : 'POST', { name, key, type, options: type === 'select' ? options.split(',').map(v => v.trim()).filter(Boolean) : [] }); done() }
    catch (e) { setError(errorText(e)) }
  }
  async function remove(field: Field) {
    if (!confirm(`Delete master field “${field.name}”?`)) return
    try { await send(`/fields/${field.id}`, 'DELETE'); done() } catch (e) { setError(errorText(e)) }
  }
  const types: Field['type'][] = ['text', 'number', 'date', 'boolean', 'select', 'array', 'file', 'problem']
  const typeLabel = (value: Field['type']) => value === 'problem' ? 'Issue' : value
  return <><Heading eyebrow="WORKFLOW BUILDER" title="Master fields" subtitle="Create reusable fields and attach them to workflow steps." action={<button className="btn-primary" onClick={() => open()}><Plus size={17}/> New field</button>}/><Notice message={error || result.error}/>{show && <form onSubmit={save} className="card mb-6 grid gap-4 p-6 md:grid-cols-2"><div><label className="label">Field name</label><input className="input" required value={name} onChange={e => setName(e.target.value)}/></div><div><label className="label">Key</label><input className="input" required pattern="[a-z][a-z0-9_]*" disabled={!!editing} value={key} onChange={e => setKey(e.target.value)} placeholder="customer_name"/></div><div><label className="label">Type</label><select className="input" disabled={!!editing} value={type} onChange={e => setType(e.target.value as Field['type'])}>{types.map(value => <option key={value} value={value}>{typeLabel(value)}</option>)}</select></div>{type === 'select' && <div><label className="label">Options (comma-separated)</label><input className="input" required value={options} onChange={e => setOptions(e.target.value)}/></div>}{type === 'problem' && <p className="text-xs text-[#718292]">Issue choices come from the Issues master list. The selected issue is saved on the ticket and stays attached across workflow steps.</p>}{type === 'array' && <p className="text-xs text-[#718292]">Array values are free-form strings entered separately on the ticket form.</p>}{type === 'file' && <p className="text-xs text-[#718292]">Upload tenant-owned files on the ticket form.</p>}<div className="flex gap-2 md:col-span-2"><button className="btn-primary">{editing ? 'Save field' : 'Create field'}</button><button type="button" className="btn-secondary" onClick={() => setShow(false)}>Cancel</button></div></form>}<DataTable rows={result.items} total={result.total} loading={result.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset} columns={[{ title: 'Field', render: field => <b>{field.name}</b> }, { title: 'Key', render: field => <span className="font-mono text-xs text-accent">{field.key}</span> }, { title: 'Type', render: field => <span className="capitalize">{typeLabel(field.type)}</span> }, { title: 'Actions', render: field => <Actions edit={() => open(field)} remove={() => remove(field)}/> }]} /><p className="mt-4 text-xs text-[#8a9aa5]">{fields.length} active custom fields available across workflow steps.</p></>
}

function StepsPanel({ steps, fields, updated }: { steps: Step[]; fields: Field[]; updated: () => void }) {
  const [limit, setLimit] = useState(20), [offset, setOffset] = useState(0), [version, reload] = useState(0)
  const result = usePage<Step>('/steps', version, limit, offset)
  const [editing, setEditing] = useState<number | null>(null), [show, setShow] = useState(false), [name, setName] = useState(''), [description, setDescription] = useState(''), [bindings, setBindings] = useState<Binding[]>([]), [error, setError] = useState('')
  const done = () => { reload(v => v + 1); updated(); setShow(false) }
  const open = (s?: Step) => { setEditing(s?.id ?? null); setName(s?.name ?? ''); setDescription(s?.description ?? ''); setBindings(s?.fields ?? []); setError(''); setShow(true) }
  async function save(e: React.FormEvent) { e.preventDefault(); try { await send(`/steps${editing ? `/${editing}` : ''}`, editing ? 'PUT' : 'POST', { name, description, fields: bindings }); done() } catch (e) { setError(errorText(e)) } }
  async function remove(id: number) { if (!confirm('Delete this step?')) return; try { await send(`/steps/${id}`, 'DELETE'); done() } catch (e) { setError(errorText(e)) } }
  return <><Heading eyebrow="WORKFLOW BUILDER" title="Workflow steps" subtitle="A ticket can begin, move, or finish at any step." action={<button className="btn-primary" onClick={() => open()}><Plus size={17}/> New step</button>}/><Notice message={error || result.error}/>{show && <form onSubmit={save} className="card mb-6 space-y-4 p-6"><div className="flex justify-between"><h2 className="font-bold">{editing ? 'Edit step' : 'New step'}</h2><button type="button" onClick={() => setShow(false)}><X size={18}/></button></div><div className="grid gap-4 md:grid-cols-2"><div><label className="label">Step name</label><input className="input" required value={name} onChange={e => setName(e.target.value)}/></div><div><label className="label">Description</label><input className="input" value={description} onChange={e => setDescription(e.target.value)}/></div></div><div><p className="label">Fields needed at this step</p><div className="grid gap-2 md:grid-cols-2">{fields.map(f => { const selected = bindings.find(b => b.field_id === f.id); return <div key={f.id} className="flex items-center justify-between rounded-lg border border-[#e7edef] p-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={!!selected} onChange={e => setBindings(e.target.checked ? [...bindings, { field_id: f.id, required: false }] : bindings.filter(b => b.field_id !== f.id))}/>{f.name}</label>{selected && <label className="flex items-center gap-2 text-xs text-[#748390]"><input type="checkbox" checked={selected.required} onChange={e => setBindings(bindings.map(b => b.field_id === f.id ? { ...b, required: e.target.checked } : b))}/> Required</label>}</div> })}</div>{!fields.length && <p className="text-sm text-[#718292]">Create master fields first to add them here.</p>}</div><button className="btn-primary">Save step</button></form>}<DataTable columns={[{ title: 'Step', render: s => <b>{s.name}</b> }, { title: 'Description', render: s => s.description || '—' }, { title: 'Fields', render: s => `${s.fields.length} fields` }, { title: 'Actions', render: s => <Actions edit={() => open(s)} remove={() => remove(s.id)}/> }]} rows={result.items} total={result.total} loading={result.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset}/><p className="mt-4 text-xs text-[#8a9aa5]">{steps.length} steps available for tickets.</p></>
}

export function FieldForm({ step, fields, values, setValues, problems = [] }: { step?: Step; fields: Field[]; values: Record<string, unknown>; setValues: (v: Record<string, unknown>) => void; problems?: Problem[] }) {
  if (!step) return <p className="text-sm text-[#718292]">Choose a step to see its fields.</p>
  return <div className="grid gap-4 md:grid-cols-2">{step.fields.map(binding => {
    const f = fields.find(field => field.id === binding.field_id)
    if (!f) return null
    const key = String(f.id), value = values[key]
    const problemValue = value && typeof value === 'object' && 'problem_id' in value
      ? Number((value as { problem_id: number }).problem_id) : Number(value)
    return <div key={key}><label className="label">{f.name} {binding.required && <span className="text-red-500">*</span>}</label>
      {f.type === 'boolean' ? <select className="input" value={value === undefined ? '' : String(value)} required={binding.required} onChange={e => setValues({ ...values, [key]: e.target.value === '' ? null : e.target.value === 'true' })}><option value="">Select</option><option value="true">Yes</option><option value="false">No</option></select>
        : f.type === 'select' ? <select className="input" value={String(value ?? '')} required={binding.required} onChange={e => setValues({ ...values, [key]: e.target.value })}><option value="">Select</option>{f.options.map(o => <option key={o}>{o}</option>)}</select>
        : f.type === 'problem' ? <select className="input" value={problemValue ? String(problemValue) : ''} required={binding.required} onChange={e => setValues({ ...values, [key]: e.target.value ? Number(e.target.value) : null })}><option value="">Choose an issue</option>{problems.map(problem => <option key={problem.id} value={problem.id}>{problem.name} · {issueStatusLabel(problem.status)}</option>)}</select>
        : f.type === 'array' ? <ArrayField value={value} onChange={v => setValues({ ...values, [key]: v })} required={binding.required}/>
        : f.type === 'file' ? <FileField value={value} onChange={v => setValues({ ...values, [key]: v })} required={binding.required}/>
        : <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step={f.type === 'number' ? 'any' : undefined} required={binding.required} value={String(value ?? '')} onChange={e => setValues({ ...values, [key]: f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })}/>}</div>
  })}{!step.fields.length && <p className="text-sm text-[#718292]">No fields required for this step.</p>}</div>
}

function ArrayField({ value, onChange, required }: { value: unknown; onChange: (value: string[]) => void; required: boolean }) {
  const items = Array.isArray(value) ? value.map(String) : []
  const update = (index: number, entry: string) => onChange(items.map((current, i) => i === index ? entry : current))
  return <div className="space-y-2">{items.map((entry, index) => <div className="flex gap-2" key={index}>
    <input className="input" aria-label={`Value ${index + 1}`} required={required && index === 0} value={entry} onChange={e => update(index, e.target.value)}/>
    <button type="button" className="btn-secondary !px-3" aria-label={`Remove value ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><X size={16}/></button>
  </div>)}
  {required && !items.length && <input className="input" required aria-label="Value 1" value="" onChange={e => onChange([e.target.value])}/>}
  <button type="button" className="btn-secondary !py-2" onClick={() => onChange([...items, ''])}><Plus size={14}/> Add value</button></div>
}

export type UploadedFileValue = { file_id: number; name?: string; access_url?: string; content_type?: string }

export async function uploadFile(file: File): Promise<UploadedFileValue> {
  const data = new FormData(); data.append('file', file)
  const res = await fetch('/api/files', { method: 'POST', credentials: 'same-origin', body: data })
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.detail || `Upload failed (${res.status})`) }
  return res.json()
}

export function FilePreviewList({ value, onRemove }: { value: unknown; onRemove?: (index: number) => void }) {
  const items: UploadedFileValue[] = Array.isArray(value) ? value : value && typeof value === 'object' ? [value as UploadedFileValue] : []
  return <div className="space-y-2">{items.map((item, index) => item.content_type?.startsWith('image/') ?
    <div key={item.file_id ?? index} className="flex items-start gap-2"><a href={item.access_url} target="_blank" rel="noreferrer" aria-label={`Preview ${item.name ?? 'image'}`}><img src={item.access_url} alt={item.name ?? 'Uploaded image'} className="max-h-40 max-w-full rounded-lg border border-[#e5ebee] object-contain"/></a>{onRemove && <button type="button" className="text-[#718292]" aria-label={`Remove ${item.name ?? 'image'}`} onClick={() => onRemove(index)}><X size={15}/></button>}</div> :
    <div key={item.file_id ?? index} className="flex items-center gap-2"><a className="btn-secondary !py-1.5 text-sm" href={item.access_url} download={item.name} target="_blank" rel="noreferrer"><Download size={14}/>{item.name ?? 'Download file'}</a>{onRemove && <button type="button" className="text-[#718292]" aria-label={`Remove ${item.name ?? 'file'}`} onClick={() => onRemove(index)}><X size={15}/></button>}</div>
  )}</div>
}

export function FileField({ value, onChange, required }: { value: unknown; onChange: (value: UploadedFileValue[]) => void; required: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const items: UploadedFileValue[] = Array.isArray(value) ? value : value && typeof value === 'object' ? [value as UploadedFileValue] : []
  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setError('')
    try { onChange([...items, ...await Promise.all(Array.from(files, uploadFile))]) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="space-y-2"><input className="input" type="file" multiple required={required && !items.length} disabled={busy} onChange={e => { void upload(e.target.files); e.currentTarget.value = '' }}/>{busy && <p className="text-xs text-[#718292]">Uploading…</p>}<FilePreviewList value={items} onRemove={index => onChange(items.filter((_, i) => i !== index))}/>{error && <p className="text-xs text-red-600">{error}</p>}</div>
}

export function TicketTimeline({ ticket, steps, fields, identifierLabel }: { ticket: Ticket; steps: Step[]; fields: Field[]; identifierLabel: string }) {
  const name = (id: number | null, event: Event) => steps.find(s => s.id === id)?.name ?? (id === event.from_step_id ? event.from_step_name : event.to_step_name) ?? (id === null ? 'Start' : `Step #${id}`)
  return <div className="relative ml-4 space-y-0 border-l-2 border-[#cde7e1] pb-1">
    {ticket.events?.map((event, index) => {
      const movement = event.kind === 'created' || event.kind === 'moved'
      const last = index === (ticket.events?.length ?? 0) - 1
      return <div key={event.id} className="relative pb-6 pl-7 last:pb-0">
        <div className={`absolute -left-[13px] top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow-sm ${last ? 'bg-accent text-white' : movement ? 'bg-[#b7e4d9] text-[#146d68]' : 'bg-[#eaf0f1] text-[#6d8490]'}`}>
          {event.kind.startsWith('closed') ? <CheckCircle2 size={13}/> : <span className="text-[10px] font-extrabold">{movement ? ticket.events!.slice(0, index + 1).filter(e => e.kind === 'created' || e.kind === 'moved').length : '•'}</span>}
        </div>
        <div className={`rounded-xl border p-4 ${last ? 'border-[#a6d8cd] bg-[#f2faf7]' : 'border-[#e5ebee] bg-white'}`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-md bg-[#e4f2ee] px-2 py-1 text-xs font-bold text-accent">{name(event.to_step_id, event)}</span>
            {event.kind === 'moved' && <span className="text-[#718292]">{name(event.from_step_id, event)} <ArrowRight size={13} className="inline"/> {name(event.to_step_id, event)}</span>}
            <b className="capitalize">{event.kind.replaceAll('_', ' ')}</b>
            {last && ticket.status === 'open' && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Current</span>}
          </div>
          <p className="mt-2 text-xs text-[#8496a0]">{date(event.created_at)} · {event.actor_name ?? `User #${event.actor_id}`}</p>
          {event.identifier !== null && <p className="mt-2 text-xs text-[#5d7180]">{identifierLabel}: <b>{event.identifier}</b>{event.title && event.title !== event.identifier ? ` · Title: ${event.title}` : ''}</p>}
          {event.problem && <p className="mt-1 text-xs text-[#5d7180]">Issue: <b>{event.problem.name}</b>{event.problem.status_at_event ? ` · ${issueStatusLabel(event.problem.status_at_event)}` : ''}</p>}
          {Object.keys(event.snapshot).length > 0 && <div className="mt-2 text-xs text-[#718292]">Fields: {Object.entries(event.snapshot).map(([key, value]) => {
            const problem = event.snapshot_problems?.[key]
            const label = fields.find(f => f.id === Number(key))?.name ?? event.snapshot_fields?.[key] ?? key
            return `${label}: ${problem ? `${problem.name} (${issueStatusLabel(problem.status)})` : displayFieldValue(value)}`
          }).join(' · ')}</div>}
        </div>
      </div>
    })}
  </div>
}

export function LegacyTicketsPanel({ steps, fields, updated }: { steps: Step[]; fields: Field[]; updated: () => void }) {
  const [limit, setLimit] = useState(20), [offset, setOffset] = useState(0), [version, reload] = useState(0), [selectedSteps, setSelectedSteps] = useState<number[]>([]), [status, setStatus] = useState(''), [error, setError] = useState('')
  const filters = `?${selectedSteps.map(id => `step_ids=${id}&`).join('')}${status ? `status=${status}` : ''}`
  const result = usePage<Ticket>(`/tickets${filters}`, version, limit, offset)
  const [show, setShow] = useState(false), [selected, setSelected] = useState<Ticket | null>(null), [mode, setMode] = useState<'create' | 'edit' | 'move'>('create'), [title, setTitle] = useState(''), [stepId, setStepId] = useState(0), [values, setValues] = useState<Record<string, unknown>>({})
  const done = () => { setShow(false); reload(v => v + 1); updated(); setError('') }
  const openCreate = () => { setMode('create'); setTitle(''); setStepId(steps[0]?.id ?? 0); setValues({}); setSelected(null); setShow(true); setError('') }
  async function openTicket(id: number) { try { const ticket = await api<Ticket>(`/tickets/${id}`); setSelected(ticket); setShow(false); setError('') } catch (e) { setError(errorText(e)) } }
  function startEdit() { if (!selected) return; setMode('edit'); setStepId(selected.step_id); setValues(selected.values ?? {}); setShow(true) }
  function startMove() { if (!selected) return; setMode('move'); setStepId(0); setValues({}); setShow(true) }
  function changeStep(id: number) { setStepId(id); const allowed = new Set(steps.find(s => s.id === id)?.fields.map(b => String(b.field_id))); setValues(mode === 'move' ? Object.fromEntries(Object.entries(selected?.values ?? {}).filter(([key]) => allowed.has(key))) : {}) }
  async function save(e: React.FormEvent) { e.preventDefault(); try { if (mode === 'create') await send('/tickets', 'POST', { title, step_id: stepId, values }); else if (mode === 'edit') await send(`/tickets/${selected!.id}/values`, 'PUT', { values }); else await send(`/tickets/${selected!.id}/move`, 'POST', { step_id: stepId, values }); done(); if (selected) await openTicket(selected.id) } catch (e) { setError(errorText(e)) } }
  async function action(kind: 'close' | 'delete') { if (!selected || !confirm(kind === 'delete' ? 'Delete this ticket?' : 'Close this ticket at its current step?')) return; try { await send(`/tickets/${selected.id}${kind === 'close' ? '/close' : ''}`, kind === 'close' ? 'POST' : 'DELETE'); done(); if (kind === 'close') await openTicket(selected.id); else setSelected(null) } catch (e) { setError(errorText(e)) } }
  async function exportXlsx() { try { const res = await fetch('/api/tickets/export' + filters, { credentials: 'same-origin' }); if (!res.ok) throw new Error('Export failed'); const url = URL.createObjectURL(await res.blob()); const link = document.createElement('a'); link.href = url; link.download = 'tickets.xlsx'; link.click(); URL.revokeObjectURL(url) } catch (e) { setError(errorText(e)) } }
  return <><Heading eyebrow="TICKET WORKSPACE" title="Tickets" subtitle="Every request, every handoff, all in one place." action={<div className="flex gap-2"><button className="btn-secondary" onClick={exportXlsx}><Download size={16}/> Export Excel</button><button className="btn-primary" disabled={!steps.length} onClick={openCreate}><Plus size={16}/> New ticket</button></div>}/><Notice message={error || result.error}/><div className="card mb-5 p-5"><div className="mb-3 flex items-center gap-2 text-sm font-bold"><Search size={16} className="text-accent"/> Filter tickets</div><div className="flex flex-wrap items-center gap-4"><div className="flex flex-wrap gap-2">{steps.map(s => <label key={s.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedSteps.includes(s.id) ? 'border-accent bg-[#e5f5f0] text-accent' : 'border-[#e0e8ea] text-[#718292]'}`}><input className="sr-only" type="checkbox" checked={selectedSteps.includes(s.id)} onChange={() => { setOffset(0); setSelectedSteps(selectedSteps.includes(s.id) ? selectedSteps.filter(id => id !== s.id) : [...selectedSteps, s.id]) }}/>{s.name}</label>)}{!steps.length && <span className="text-sm text-[#8696a0]">Add a step to start filtering.</span>}</div><select aria-label="Filter by status" className="input !w-auto" value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}><option value="">All statuses</option><option value="open">Open</option><option value="closed">Closed</option></select>{(selectedSteps.length > 0 || status) && <button className="text-xs font-bold text-accent" onClick={() => { setSelectedSteps([]); setStatus(''); setOffset(0) }}>Clear filters</button>}</div></div><DataTable columns={[{ title: 'Ticket', render: t => <button className="text-left font-bold hover:text-accent" onClick={() => openTicket(t.id)}>#{t.id} · {t.title}</button> }, { title: 'Current step', render: t => <span className="rounded-md bg-[#eef5f5] px-2.5 py-1 text-xs font-bold text-accent">{steps.find(s => s.id === t.step_id)?.name ?? `Step #${t.step_id}`}</span> }, { title: 'Status', render: t => <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${t.status === 'open' ? 'text-amber-600' : 'text-emerald-600'}`}><span className={`h-2 w-2 rounded-full ${t.status === 'open' ? 'bg-amber-400' : 'bg-emerald-500'}`}/>{t.status}</span> }, { title: 'View', render: t => <button className="text-sm font-semibold text-accent" onClick={() => openTicket(t.id)}>Details →</button> }]} rows={result.items} total={result.total} loading={result.loading} limit={limit} offset={offset} setLimit={setLimit} setOffset={setOffset}/>
  {selected && !show && <div className="card mt-6 p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="label text-accent">TICKET #{selected.id}</p><h2 className="text-xl font-extrabold">{selected.title}</h2><p className="mt-1 text-sm text-[#718292]">{steps.find(s => s.id === selected.step_id)?.name} · {selected.status} · opened {date(selected.created_at)}</p></div><button onClick={() => setSelected(null)}><X size={20}/></button></div><div className="mt-5 flex flex-wrap gap-2">{selected.status === 'open' && <><button className="btn-secondary" onClick={startEdit}>Edit fields</button><button className="btn-primary" onClick={startMove}>Move to step <ArrowRight size={15}/></button><button className="btn-secondary" onClick={() => action('close')}><CheckCircle2 size={16}/> Close here</button></>}<button className="btn-danger" onClick={() => action('delete')}>Delete</button></div><h3 className="mt-7 mb-3 font-bold">Current fields</h3><div className="grid gap-3 md:grid-cols-2">{Object.entries(selected.values ?? {}).map(([key, value]) => <div key={key} className="rounded-lg bg-[#f7f9f9] p-3"><span className="label">{fields.find(f => f.id === Number(key))?.name ?? key}</span><span className="text-sm font-semibold">{String(value)}</span></div>)}{!Object.keys(selected.values ?? {}).length && <p className="text-sm text-[#718292]">No fields on this step.</p>}</div><h3 className="mt-8 mb-4 font-bold">Activity history</h3><div className="space-y-3 border-l-2 border-[#dceae7] pl-5">{selected.events?.map(ev => <div key={ev.id} className="relative text-sm"><span className="absolute -left-[27px] top-1 h-2.5 w-2.5 rounded-full bg-accent"/><b className="capitalize">{ev.kind}</b> {ev.kind === 'moved' && <span>from {steps.find(s => s.id === ev.from_step_id)?.name ?? `step #${ev.from_step_id}`} to {steps.find(s => s.id === ev.to_step_id)?.name ?? `step #${ev.to_step_id}`}</span>}<p className="mt-1 text-xs text-[#8a9aa5]">{date(ev.created_at)} · User #{ev.actor_id} · Fields: {Object.entries(ev.snapshot).map(([key, v]) => `${fields.find(f => f.id === Number(key))?.name ?? key}: ${String(v)}`).join(', ') || 'none'}</p></div>)}</div></div>}
  {show && <form onSubmit={save} className="card mt-6 space-y-5 p-6"><div className="flex justify-between"><h2 className="text-lg font-extrabold">{mode === 'create' ? 'New ticket' : mode === 'move' ? 'Move ticket' : 'Edit ticket fields'}</h2><button type="button" onClick={() => setShow(false)}><X size={18}/></button></div>{mode === 'create' && <div><label className="label">Title</label><input className="input" required value={title} onChange={e => setTitle(e.target.value)}/></div>}{mode !== 'edit' && <div><label className="label">{mode === 'move' ? 'Destination step' : 'Starting step'}</label><select className="input" required value={stepId} onChange={e => changeStep(Number(e.target.value))}><option value={0}>Select step</option>{steps.filter(s => mode !== 'move' || s.id !== selected?.step_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}<FieldForm step={steps.find(s => s.id === stepId)} fields={fields} values={values} setValues={setValues}/><p className="text-xs text-[#718292]">Shared fields carry forward when moving. Other values stay in the activity history.</p><button className="btn-primary">{mode === 'move' ? 'Move ticket' : 'Save ticket'}</button></form>}</>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><><App/><TenantWorkspaceBrand/><FloatingModalBehavior/></></React.StrictMode>)
