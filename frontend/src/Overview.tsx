import { useEffect, useState, type ReactNode } from 'react'
import { Activity, ArrowDownRight, ArrowUpRight, Building2, Clock3, Ticket, Users } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

type Range = 7 | 30 | 90
type EventPoint = { date: string; created: number; closed: number; reopened: number; moved: number }
type GrowthPoint = { date: string; new_tenants: number; new_users: number }
type ProblemStatus = 'identified' | 'progress_fixing' | 'fixed' | 'recurring'
type ProblemPage = { items: { status: ProblemStatus }[]; total: number }
type TenantMetrics = {
  range: { days: number; start: string; end: string }
  metrics: { open_tickets: number; closed_tickets: number; created_tickets: number; previous_period_created: number }
  events: EventPoint[]
  tickets_by_step: { step_id: number; step_name: string; tickets: number }[]
  insights: { created_change: number; created_change_percent: number | null; daily_average_created: number; busiest_day: string | null; busiest_day_events: number; busiest_step: string | null }
}
type PlatformMetrics = {
  range: { days: number; start: string; end: string }
  metrics: { active_tenants: number; tenant_users: number; open_tickets: number; closed_tickets: number; created_tickets: number; previous_period_created: number }
  ticket_events: EventPoint[]
  account_growth: GrowthPoint[]
  insights: { created_change: number; created_change_percent: number | null; daily_average_created: number; busiest_day: string | null; busiest_day_events: number }
}

const chartColors = { green: '#147d79', blue: '#5897b4', amber: '#d5a343', slate: '#9cabb4' }
const chartDate = (day: string) => day.slice(5)

async function loadAnalytics<T>(endpoint: string, days: Range): Promise<T> {
  const response = await fetch(`/api/${endpoint}?days=${days}`, { credentials: 'same-origin' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not load overview analytics')
  }
  return response.json()
}

function useAnalytics<T>(endpoint: string, days: Range) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setLoading(true)
    loadAnalytics<T>(endpoint, days).then(result => {
      if (live) { setData(result); setError('') }
    }).catch(e => {
      if (live) setError(e instanceof Error ? e.message : 'Could not load overview analytics')
    }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [endpoint, days])
  return { data, loading, error }
}

function RangeSelect({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  return <div className="flex items-center gap-1 rounded-xl border border-[#e5ebee] bg-white p-1">
    {([7, 30, 90] as const).map(day => <button key={day} onClick={() => onChange(day)}
      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${value === day ? 'bg-[#e5f3f0] text-accent' : 'text-[#7c8d98] hover:bg-[#f5f8f8]'}`}>{day}d</button>)}
  </div>
}

function PanelHeading({ eyebrow, title, subtitle, range, setRange }: { eyebrow: string; title: string; subtitle: string; range: Range; setRange: (range: Range) => void }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
    <div><p className="label !mb-2 text-accent">{eyebrow}</p><h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">{title}</h1>
      <p className="mt-2 text-sm text-[#718292]">{subtitle}</p></div><RangeSelect value={range} onChange={setRange}/>
  </div>
}

function MetricCard({ label, value, icon, foot }: { label: string; value: number | string; icon: ReactNode; foot?: ReactNode }) {
  return <div className="card p-5"><div className="flex items-start justify-between"><p className="text-sm font-semibold text-[#718292]">{label}</p><div className="rounded-xl bg-[#e9f5f2] p-2.5 text-accent">{icon}</div></div>
    <p className="mt-4 font-[Manrope] text-3xl font-extrabold tracking-tight">{value}</p>{foot && <div className="mt-2 text-xs text-[#84939c]">{foot}</div>}</div>
}

function ChartCard({ title, subtitle, children, className = '' }: { title: string; subtitle: string; children: ReactNode; className?: string }) {
  return <section className={`card min-w-0 p-5 lg:p-6 ${className}`}><div className="mb-5"><h2 className="font-[Manrope] text-base font-extrabold">{title}</h2><p className="mt-1 text-xs text-[#8797a1]">{subtitle}</p></div>{children}</section>
}

function ChartLoading({ loading, error }: { loading: boolean; error: string }) {
  if (loading) return <div className="flex h-[270px] items-center justify-center text-sm text-[#91a0a9]">Loading chart data…</div>
  if (error) return <div className="flex h-[270px] items-center justify-center rounded-xl bg-[#fff7f5] px-5 text-center text-sm text-[#aa5144]">{error}</div>
  return null
}

function TooltipStyle() {
  return { background: '#fff', border: '1px solid #e5ebee', borderRadius: 12, fontSize: 12, boxShadow: '0 8px 28px rgba(23,40,61,.08)' }
}

function CreatedInsight({ count, change, percent, days }: { count: number; change: number; percent: number | null; days: number }) {
  const up = change >= 0
  return <div className="flex items-center gap-2 rounded-xl bg-[#f7f9f9] px-3 py-2 text-xs">
    {up ? <ArrowUpRight size={15} className="text-accent"/> : <ArrowDownRight size={15} className="text-amber-600"/>}
    <span><b>{count}</b> created · {change > 0 ? '+' : ''}{change} vs previous {days} days</span>
    {percent !== null && <span className="text-[#84939c]">({percent > 0 ? '+' : ''}{percent}%)</span>}
  </div>
}

export function PlatformOverview() {
  const [days, setDays] = useState<Range>(30)
  const { data, loading, error } = useAnalytics<PlatformMetrics>('admin/analytics', days)
  const metrics = data?.metrics
  return <>
    <PanelHeading eyebrow="PLATFORM OVERVIEW" title="Platform at a glance" subtitle="Aggregated usage and account growth across the platform." range={days} setRange={setDays}/>
    {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Active tenants" value={metrics?.active_tenants ?? '—'} icon={<Building2 size={18}/>}/>
      <MetricCard label="Tenant users" value={metrics?.tenant_users ?? '—'} icon={<Users size={18}/>}/>
      <MetricCard label="Open tickets" value={metrics?.open_tickets ?? '—'} icon={<Ticket size={18}/>}/>
      <MetricCard label="Closed tickets" value={metrics?.closed_tickets ?? '—'} icon={<CheckIcon/>}/>
    </div>
    {metrics && data && <div className="mb-6 flex flex-wrap items-center gap-3">
      <CreatedInsight count={metrics.created_tickets} change={data.insights.created_change} percent={data.insights.created_change_percent} days={days}/>
      {data.insights.busiest_day && <div className="flex items-center gap-2 rounded-xl bg-[#f7f9f9] px-3 py-2 text-xs text-[#687c88]"><Clock3 size={14}/>{data.insights.busiest_day} · {data.insights.busiest_day_events} lifecycle events</div>}
      <div className="rounded-xl bg-[#f7f9f9] px-3 py-2 text-xs text-[#687c88]">{data.insights.daily_average_created} tickets/day on average</div>
    </div>}
    <div className="grid gap-5 xl:grid-cols-2">
      <ChartCard title="Ticket lifecycle" subtitle={`Daily created, closed, reopened and moved events · ${days} days`}>
        {loading || error ? <ChartLoading loading={loading} error={error}/> : <ResponsiveContainer width="100%" height={270}><LineChart data={data?.ticket_events} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="date" tickFormatter={chartDate} tickLine={false} axisLine={false} tick={{ fill: '#8b9aa3', fontSize: 11 }} minTickGap={24}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b9aa3', fontSize: 11 }}/><Tooltip labelFormatter={label => `Date: ${label}`} contentStyle={TooltipStyle()}/>
          <Line type="monotone" dataKey="created" name="Created" stroke={chartColors.green} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }}/><Line type="monotone" dataKey="closed" name="Closed" stroke={chartColors.blue} strokeWidth={2} dot={false}/><Line type="monotone" dataKey="reopened" name="Reopened" stroke={chartColors.amber} strokeWidth={2} dot={false}/><Line type="monotone" dataKey="moved" name="Moved" stroke={chartColors.slate} strokeWidth={2} dot={false}/>
        </LineChart></ResponsiveContainer>}
      </ChartCard>
      <ChartCard title="Account growth" subtitle="New active tenant accounts and tenant users by day">
        {loading || error ? <ChartLoading loading={loading} error={error}/> : <ResponsiveContainer width="100%" height={270}><LineChart data={data?.account_growth} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="date" tickFormatter={chartDate} tickLine={false} axisLine={false} tick={{ fill: '#8b9aa3', fontSize: 11 }} minTickGap={24}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b9aa3', fontSize: 11 }}/><Tooltip labelFormatter={label => `Date: ${label}`} contentStyle={TooltipStyle()}/>
          <Line type="monotone" dataKey="new_tenants" name="New tenants" stroke={chartColors.green} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }}/><Line type="monotone" dataKey="new_users" name="New users" stroke={chartColors.blue} strokeWidth={2} dot={false}/>
        </LineChart></ResponsiveContainer>}
      </ChartCard>
    </div>
    <p className="mt-5 text-xs text-[#9aa8af]">Platform charts show totals and daily aggregate counts only; tenant-specific names, ticket details and individual tenant series are excluded.</p>
  </>
}

function CheckIcon() { return <Activity size={18}/> }

export function TenantOverview() {
  const [days, setDays] = useState<Range>(30)
  const { data, loading, error } = useAnalytics<TenantMetrics>('analytics/tenant', days)
  const [problemCounts, setProblemCounts] = useState<{ status: string; label: string; count: number; color: string }[] | null>(null)
  const [problemError, setProblemError] = useState('')
  useEffect(() => {
    let live = true
    async function loadProblems() {
      try {
        const counts: Record<ProblemStatus, number> = { identified: 0, progress_fixing: 0, fixed: 0, recurring: 0 }
        let total = 0
        for (let offset = 0; ; offset += 100) {
          const response = await fetch(`/api/issues?limit=100&offset=${offset}`, { credentials: 'same-origin' })
          if (!response.ok) throw new Error('Could not load issue status counts')
          const page: ProblemPage = await response.json()
          page.items.forEach(problem => { counts[problem.status]++ })
          total = page.total
          if (offset + page.items.length >= total || !page.items.length) break
        }
        if (live) {
          setProblemCounts([
            { status: 'identified', label: 'New', count: counts.identified, color: chartColors.blue },
            { status: 'progress_fixing', label: 'In progress / fixing', count: counts.progress_fixing, color: chartColors.amber },
            { status: 'fixed', label: 'Fixed', count: counts.fixed, color: chartColors.green },
            { status: 'recurring', label: 'Recurring', count: counts.recurring, color: '#be7770' },
          ])
          setProblemError('')
        }
      } catch (e) { if (live) setProblemError(e instanceof Error ? e.message : 'Could not load issue status counts') }
    }
    void loadProblems()
    return () => { live = false }
  }, [])
  const metrics = data?.metrics
  return <>
    <PanelHeading eyebrow="WORKSPACE OVERVIEW" title="Keep work moving." subtitle="Ticket activity and current workload in your workspace." range={days} setRange={setDays}/>
    {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard label="Open tickets" value={metrics?.open_tickets ?? '—'} icon={<Ticket size={18}/>}/>
      <MetricCard label="Closed tickets" value={metrics?.closed_tickets ?? '—'} icon={<CheckIcon/>}/>
      <MetricCard label={`Created · last ${days} days`} value={metrics?.created_tickets ?? '—'} icon={<Activity size={18}/>}/>
    </div>
    {metrics && data && <div className="mb-6 flex flex-wrap items-center gap-3">
      <CreatedInsight count={metrics.created_tickets} change={data.insights.created_change} percent={data.insights.created_change_percent} days={days}/>
      {data.insights.busiest_step && <div className="rounded-xl bg-[#f7f9f9] px-3 py-2 text-xs text-[#687c88]">Busiest step: <b>{data.insights.busiest_step}</b></div>}
      {data.insights.busiest_day && <div className="flex items-center gap-2 rounded-xl bg-[#f7f9f9] px-3 py-2 text-xs text-[#687c88]"><Clock3 size={14}/>{data.insights.busiest_day} · {data.insights.busiest_day_events} lifecycle events</div>}
    </div>}
    <div className="grid gap-5 xl:grid-cols-5">
      <ChartCard className="xl:col-span-3" title="Ticket lifecycle" subtitle={`Daily created, closed, reopened and moved events · ${days} days`}>
        {loading || error ? <ChartLoading loading={loading} error={error}/> : <ResponsiveContainer width="100%" height={270}><LineChart data={data?.events} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="date" tickFormatter={chartDate} tickLine={false} axisLine={false} tick={{ fill: '#8b9aa3', fontSize: 11 }} minTickGap={24}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b9aa3', fontSize: 11 }}/><Tooltip labelFormatter={label => `Date: ${label}`} contentStyle={TooltipStyle()}/>
          <Line type="monotone" dataKey="created" name="Created" stroke={chartColors.green} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }}/><Line type="monotone" dataKey="closed" name="Closed" stroke={chartColors.blue} strokeWidth={2} dot={false}/><Line type="monotone" dataKey="reopened" name="Reopened" stroke={chartColors.amber} strokeWidth={2} dot={false}/><Line type="monotone" dataKey="moved" name="Moved" stroke={chartColors.slate} strokeWidth={2} dot={false}/>
        </LineChart></ResponsiveContainer>}
      </ChartCard>
      <ChartCard className="xl:col-span-2" title="Current tickets by step" subtitle="Open and closed tickets grouped by their current step">
        {loading || error ? <ChartLoading loading={loading} error={error}/> : data?.tickets_by_step.length ? <ResponsiveContainer width="100%" height={270}><BarChart data={data.tickets_by_step} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="#edf1f2" horizontal={false}/><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b9aa3', fontSize: 11 }}/><YAxis type="category" dataKey="step_name" width={125} tickLine={false} axisLine={false} tick={{ fill: '#718292', fontSize: 10 }}/><Tooltip contentStyle={TooltipStyle()}/><Bar dataKey="tickets" name="Tickets" fill={chartColors.green} radius={[0, 6, 6, 0]} barSize={18}/>
        </BarChart></ResponsiveContainer> : <div className="flex h-[270px] items-center justify-center text-sm text-[#91a0a9]">No workflow steps yet.</div>}
      </ChartCard>
    </div>
    <div className="mt-5">
          <ChartCard title="Issues by status" subtitle="Current count of issues in each resolution status">
        {problemError ? <ChartLoading loading={false} error={problemError}/> : !problemCounts ? <ChartLoading loading error=""/> : <ResponsiveContainer width="100%" height={270}><BarChart data={problemCounts} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#718292', fontSize: 11 }}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b9aa3', fontSize: 11 }}/><Tooltip contentStyle={TooltipStyle()}/><Bar dataKey="count" name="Issues" radius={[6, 6, 0, 0]} barSize={42}>{problemCounts.map(issue => <Cell key={issue.status} fill={issue.color}/>)}</Bar>
        </BarChart></ResponsiveContainer>}
      </ChartCard>
    </div>
  </>
}
