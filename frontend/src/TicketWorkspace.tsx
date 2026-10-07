import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  api,
  DataTable,
  date,
  displayFieldValue,
  errorText,
  FieldForm,
  FilePreviewList,
  Heading,
  issueStatusLabel,
  Notice,
  send,
  TicketTimeline,
  usePage,
} from "./main";
import type { Field, Problem, Step, Ticket } from "./main";

type Mode = "create" | "identity" | "fields" | "move";

function isProblemValue(value: unknown): value is { problem_id: number; name: string; status: Problem["status"] } {
  return !!value && typeof value === "object" && "problem_id" in value && "name" in value && "status" in value;
}

function hasImageFile(value: unknown) {
  const files = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : []
  return files.some((file) => !!file && typeof file === "object" && "content_type" in file && String(file.content_type).startsWith("image/"))
}

export function TicketWorkspace({
  steps,
  fields,
  problems,
  identifierLabel,
  updated,
}: {
  steps: Step[];
  fields: Field[];
  problems: Problem[];
  identifierLabel: string;
  updated: () => void;
}) {
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [selectedSteps, setSelectedSteps] = useState<number[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [title, setTitle] = useState("");
  const [overridden, setOverridden] = useState(false);
  const [stepId, setStepId] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});

  const params = new URLSearchParams();
  selectedSteps.forEach((id) => params.append("step_ids", String(id)));
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  const filters = `?${params}`;
  const result = usePage<Ticket>(`/tickets${filters}`, version, limit, offset);

  function refresh(ticket?: Ticket) {
    setVersion((v) => v + 1);
    updated();
    setSelected(ticket ?? null);
    setMode(null);
    setError("");
  }

  function create() {
    setSelected(null);
    setIdentifier("");
    setTitle("");
    setOverridden(false);
    setStepId(steps[0]?.id ?? 0);
    setValues({});
    setMode("create");
    setError("");
  }

  async function showTicket(id: number) {
    try {
      setSelected(await api<Ticket>(`/tickets/${id}`));
      setMode(null);
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }

  function editIdentity() {
    if (!selected) return;
    setIdentifier(selected.identifier);
    setTitle(selected.title);
    setOverridden(selected.title_overridden);
    setMode("identity");
  }

  function editFields() {
    if (!selected) return;
    setStepId(selected.step_id);
    setValues(normalizeValues(selected.values ?? {}));
    setMode("fields");
  }

  function move() {
    setStepId(0);
    setValues({});
    setMode("move");
  }

  function normalizeValues(source: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(source).map(([key, value]) => {
      const field = fields.find(candidate => candidate.id === Number(key))
      if (field?.type === "problem" && value && typeof value === "object" && "problem_id" in value) {
        return [key, Number((value as { problem_id: number }).problem_id)]
      }
      return [key, value]
    }))
  }

  function chooseStep(id: number) {
    setStepId(id);
    const nextStep = steps.find((s) => s.id === id)
    const allowed = new Set(nextStep?.fields.map((b) => String(b.field_id)))
    const nextValues = mode === "move"
      ? Object.fromEntries(Object.entries(normalizeValues(selected?.values ?? {})).filter(([key]) => allowed.has(key)))
      : {}
    const problemBinding = nextStep?.fields.find(binding => fields.find(field => field.id === binding.field_id)?.type === "problem")
    if (problemBinding && selected?.problem && nextValues[String(problemBinding.field_id)] === undefined) {
      nextValues[String(problemBinding.field_id)] = selected.problem.id
    }
    setValues(nextValues)
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      let ticket: Ticket;
      if (mode === "create") {
        ticket = await send<Ticket>("/tickets", "POST", {
          identifier,
          title: overridden ? title : null,
          step_id: stepId,
          values,
        });
      } else if (mode === "identity") {
        ticket = await send<Ticket>(
          `/tickets/${selected!.id}/identity`,
          "PUT",
          {
            identifier,
            title: overridden ? title : null,
          },
        );
      } else if (mode === "fields") {
        ticket = await send<Ticket>(`/tickets/${selected!.id}/values`, "PUT", {
          values,
        });
      } else {
        ticket = await send<Ticket>(`/tickets/${selected!.id}/move`, "POST", {
          step_id: stepId,
          values,
        });
      }
      refresh(ticket);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function act(action: "close" | "reopen" | "delete") {
    const prompt =
      action === "close"
        ? "Close this ticket at its current step?"
        : action === "reopen"
          ? "Reopen this ticket at its current step?"
          : "Delete this ticket?";
    if (!selected || !window.confirm(prompt)) return;
    try {
      if (action === "close" || action === "reopen") {
        refresh(
          await send<Ticket>(`/tickets/${selected.id}/${action}`, "POST"),
        );
      } else {
        await send(`/tickets/${selected.id}`, "DELETE");
        refresh();
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function exportXlsx() {
    try {
      const response = await fetch("/api/tickets/export" + filters, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "tickets.xlsx";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <Heading
        eyebrow="TICKET WORKSPACE"
        title="Tickets"
        subtitle="Every request, every handoff, all in one place."
        action={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={exportXlsx}>
              <Download size={16} /> Export Excel
            </button>
            <button
              className="btn-primary"
              disabled={!steps.length}
              onClick={create}
            >
              <Plus size={16} /> New ticket
            </button>
          </div>
        }
      />
      <Notice message={error || result.error} />
      <div className="card mb-5 space-y-3 p-5">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Search size={16} className="text-accent" /> Filter tickets
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="input !w-auto min-w-[200px]"
            aria-label={`Search ${identifierLabel}`}
            placeholder={`Search ${identifierLabel}`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
          <select
            className="input !w-auto"
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          {(selectedSteps.length > 0 || status || search) && (
            <button
              className="text-xs font-bold text-accent"
              onClick={() => {
                setSelectedSteps([]);
                setStatus("");
                setSearch("");
                setOffset(0);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {steps.map((step) => (
            <label
              key={step.id}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedSteps.includes(step.id) ? "border-accent bg-[#e5f5f0] text-accent" : "border-[#e0e8ea] text-[#718292]"}`}
            >
              <input
                className="sr-only"
                type="checkbox"
                checked={selectedSteps.includes(step.id)}
                onChange={() => {
                  setOffset(0);
                  setSelectedSteps(
                    selectedSteps.includes(step.id)
                      ? selectedSteps.filter((id) => id !== step.id)
                      : [...selectedSteps, step.id],
                  );
                }}
              />
              {step.name}
            </label>
          ))}
        </div>
      </div>
      {selected && !mode && (
        <div className="card mt-6 p-6" data-modal-detail="true">
          <div className="flex justify-between gap-4">
            <div>
              <p className="label text-accent">TICKET #{selected.id}</p>
              <h2 className="text-xl font-extrabold">{selected.title}</h2>
              <p className="mt-2 text-sm">
                <span className="font-semibold text-accent">
                  {identifierLabel}:
                </span>{" "}
                {selected.identifier}
              </p>
              <p className="mt-1 text-sm text-[#718292]">
                Issue: {selected.problem ? <><b className="text-ink">{selected.problem.name}</b><span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${selected.problem.status === "fixed" ? "bg-emerald-50 text-emerald-700" : selected.problem.status === "recurring" ? "bg-amber-50 text-amber-700" : "bg-[#eef4f5] text-[#5f7380]"}`}>{issueStatusLabel(selected.problem.status)}</span></> : "—"}
              </p>
              <p className="mt-1 text-sm text-[#718292]">
                {steps.find((s) => s.id === selected.step_id)?.name ??
                  `Step #${selected.step_id}`}{" "}
                · {selected.status} · opened {date(selected.created_at)}
              </p>
            </div>
            <button
              className="self-start"
              aria-label="Close ticket details"
              onClick={() => setSelected(null)}
            >
              <X size={20} />
            </button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {selected.status === "open" && (
              <>
                <button className="btn-secondary" onClick={editIdentity}>
                  Edit identity / title
                </button>
                <button className="btn-secondary" onClick={editFields}>
                  Edit step fields
                </button>
                <button className="btn-primary" onClick={move}>
                  Move to step <ArrowRight size={15} />
                </button>
                <button className="btn-secondary" onClick={() => act("close")}>
                  <CheckCircle2 size={16} /> Close here
                </button>
              </>
            )}
            {selected.status === "closed" && (
              <button className="btn-primary" onClick={() => act("reopen")}>
                <ArrowRight size={15} /> Reopen ticket
              </button>
            )}
            <button className="btn-danger" onClick={() => act("delete")}>
              Delete
            </button>
          </div>
          <h3 className="mb-3 mt-7 font-bold">Current step fields</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(selected.values ?? {}).map(([key, value]) => (
              <div key={key} className={`rounded-lg p-3 ${hasImageFile(value) ? "" : "bg-[#f7f9f9]"}`}>
                <span className="label">
                  {fields.find((f) => f.id === Number(key))?.name ?? key}
                </span>
                {isProblemValue(value) ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span>{value.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${value.status === "fixed" ? "bg-emerald-50 text-emerald-700" : value.status === "recurring" ? "bg-amber-50 text-amber-700" : "bg-[#eef4f5] text-[#5f7380]"}`}>
                      {issueStatusLabel(value.status)}
                    </span>
                  </div>
                ) : (value && typeof value === "object" && (Array.isArray(value)
                  ? value.some((file) => !!file && typeof file === "object" && "access_url" in file)
                  : "access_url" in value)) ? (
                  <FilePreviewList value={value}/>
                ) : (
                  <span className="text-sm font-semibold">
                    {displayFieldValue(value)}
                  </span>
                )}
              </div>
            ))}
            {!Object.keys(selected.values ?? {}).length && (
              <p className="text-sm text-[#718292]">No step fields.</p>
            )}
          </div>
          <h3 className="mb-5 mt-8 font-bold">Journey & activity</h3>
          <TicketTimeline
            ticket={selected}
            steps={steps}
            fields={fields}
            identifierLabel={identifierLabel}
          />
        </div>
      )}

      {mode && (
        <form onSubmit={save} className="card mt-6 space-y-5 p-6">
          <div className="flex justify-between">
            <h2 className="text-lg font-extrabold">
              {
                {
                  create: "New ticket",
                  identity: "Edit identity & title",
                  fields: "Edit step fields",
                  move: "Move ticket",
                }[mode]
              }
            </h2>
            <button
              type="button"
              aria-label="Close form"
              onClick={() => setMode(null)}
            >
              <X size={18} />
            </button>
          </div>
          {(mode === "create" || mode === "identity") && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="label">{identifierLabel} *</label>
                <input
                  className="input"
                  required
                  maxLength={200}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </div>
              <div>
                <label className="label">
                  Title {overridden ? "(custom)" : "(automatic)"}
                </label>
                {overridden ? (
                  <input
                    className="input"
                    required
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                ) : (
                  <div className="input bg-[#f5f9f8] text-[#657b85]">
                    {identifier.trim() || "Enter an identifier first"}
                  </div>
                )}
                <button
                  type="button"
                  className="mt-2 text-xs font-bold text-accent"
                  onClick={() => {
                    setOverridden(!overridden);
                    setTitle(overridden ? "" : identifier.trim());
                  }}
                >
                  {overridden ? "Use automatic title" : "Customize title"}
                </button>
              </div>
            </div>
          )}
          {(mode === "create" || mode === "move") && (
            <div>
              <label className="label">
                {mode === "move" ? "Destination step" : "Starting step"}
              </label>
              <select
                className="input"
                required
                value={stepId}
                onChange={(e) => chooseStep(Number(e.target.value))}
              >
                <option value={0}>Select step</option>
                {steps
                  .filter(
                    (step) => mode !== "move" || step.id !== selected?.step_id,
                  )
                  .map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {(mode === "create" || mode === "fields" || mode === "move") && (
            <>
              <FieldForm
                step={steps.find((step) => step.id === stepId)}
                fields={fields}
                values={values}
                setValues={setValues}
                problems={problems}
              />
              <p className="text-xs text-[#718292]">
                The ticket identifier stays at every step. Shared step fields
                carry forward; other values remain in history.
              </p>
            </>
          )}
          <button className="btn-primary">
            {mode === "move" ? "Move ticket" : "Save ticket"}
          </button>
        </form>
      )}

      <div className="mb-6"></div>
      <DataTable
        rows={result.items}
        total={result.total}
        loading={result.loading}
        limit={limit}
        offset={offset}
        setLimit={setLimit}
        setOffset={setOffset}
        columns={[
          {
            title: "Ticket",
            render: (ticket) => (
              <button
                className="text-left font-bold hover:text-accent"
                onClick={() => showTicket(ticket.id)}
              >
                #{ticket.id} · {ticket.title}
              </button>
            ),
          },
          {
            title: identifierLabel,
            render: (ticket) => (
              <span className="font-semibold">{ticket.identifier}</span>
            ),
          },
          {
            title: "Issue",
            render: (ticket) => ticket.problem ? <span className="font-semibold">{ticket.problem.name}<span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${ticket.problem.status === "fixed" ? "bg-emerald-50 text-emerald-700" : ticket.problem.status === "recurring" ? "bg-amber-50 text-amber-700" : "bg-[#eef4f5] text-[#5f7380]"}`}>{issueStatusLabel(ticket.problem.status)}</span></span> : <span className="text-[#a1adb4]">—</span>,
          },
          {
            title: "Current step",
            render: (ticket) => (
              <span className="rounded-md bg-[#eef5f5] px-2.5 py-1 text-xs font-bold text-accent">
                {steps.find((s) => s.id === ticket.step_id)?.name ??
                  `Step #${ticket.step_id}`}
              </span>
            ),
          },
          {
            title: "Status",
            render: (ticket) => (
              <span
                className={
                  ticket.status === "open"
                    ? "text-amber-600"
                    : "text-emerald-600"
                }
              >
                {ticket.status}
              </span>
            ),
          },
          {
            title: "View",
            render: (ticket) => (
              <button
                className="font-semibold text-accent"
                onClick={() => showTicket(ticket.id)}
              >
                Details →
              </button>
            ),
          },
        ]}
      />
    </>
  );
}
