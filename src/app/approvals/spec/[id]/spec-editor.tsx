"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SENIORITIES, type JobSpecData, type OpenQuestionAnswer } from "@/agents/job-spec/schema";
import type { ActionState } from "../../../action-state";
import { Dropdown } from "../../../dropdown";
import { icons } from "../../../icons";
import { applyAnswersAction, approveSpecAction, rejectSpecAction } from "../../actions";

const LIST_FIELDS = [
  ["must_have", "Must have"],
  ["nice_to_have", "Nice to have"],
  ["dealbreakers", "Dealbreakers"],
  ["location", "Location"],
  ["selling_points", "Selling points"],
] as const;

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

// Job spec review mockup (2026-10-09): cream fields, numbered sections, cream question cards, lime Approve spec.
const label = "mb-3 block text-base text-stone-600";
const input =
  "w-full rounded-lg border border-stone-300 bg-field px-4 py-3 text-lg text-ink placeholder:text-stone-400 focus:border-ink focus:bg-white focus:outline-none disabled:resize-none disabled:bg-panel disabled:text-stone-700";
const section = "border-b border-stone-200 px-6 py-8 sm:px-10";
const askClient = "mt-2 text-sm text-amber-800";
const seniorityOptions = [{ value: "", label: "Unclear (see open questions)" }, ...SENIORITIES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))];

export function SpecEditor({
  specId,
  initialSpec,
  initialAnswers,
  readOnly,
}: {
  specId: string;
  initialSpec: JobSpecData;
  initialAnswers: OpenQuestionAnswer[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialSpec.title);
  const [seniority, setSeniority] = useState(initialSpec.seniority ?? "");
  const [rate, setRate] = useState(initialSpec.rate_range ?? "");
  const [lists, setLists] = useState(() =>
    Object.fromEntries(LIST_FIELDS.map(([k]) => [k, initialSpec[k].join("\n")])) as Record<(typeof LIST_FIELDS)[number][0], string>,
  );
  // Saved answers hold the still-open questions (in order) plus ones already merged into the fields ("applied").
  const [questions, setQuestions] = useState<OpenQuestionAnswer[]>(() => {
    const open = initialAnswers.filter((a) => !a.applied);
    return open.length === initialSpec.open_questions.length
      ? open
      : initialSpec.open_questions.map((q) => ({ question: q, answered: false, answer: "" }));
  });
  const [applied, setApplied] = useState<OpenQuestionAnswer[]>(initialAnswers.filter((a) => a.applied));
  const [applyNote, setApplyNote] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [rejecting, setRejecting] = useState(false); // the comment box under "Reject and regenerate" is open
  const [result, setResult] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"approve" | "reject" | "apply" | null>(null);

  const setQuestion = (i: number, patch: Partial<OpenQuestionAnswer>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  function currentSpec(): JobSpecData {
    const qs = questions.filter((q) => q.question.trim());
    return {
      title: title.trim(),
      seniority: (seniority || null) as JobSpecData["seniority"],
      must_have: lines(lists.must_have),
      nice_to_have: lines(lists.nice_to_have),
      dealbreakers: lines(lists.dealbreakers),
      location: lines(lists.location),
      rate_range: rate.trim() || null,
      selling_points: lines(lists.selling_points),
      open_questions: qs.map((q) => q.question.trim()),
    };
  }

  const unapplied = questions.filter((q) => q.question.trim() && q.answer.trim());
  const unresolved = questions.filter((q) => q.question.trim() && !q.answered).length;

  function applyAnswers() {
    setBusy("apply");
    setResult(null);
    startTransition(async () => {
      const r = await applyAnswersAction(specId, currentSpec(), unapplied.map((q) => ({ question: q.question.trim(), answer: q.answer.trim() })));
      setBusy(null);
      if (!r.ok || !r.spec) {
        setResult({ ok: false, message: r.message });
        return;
      }
      const s = r.spec;
      setTitle(s.title);
      setSeniority(s.seniority ?? "");
      setRate(s.rate_range ?? "");
      setLists(Object.fromEntries(LIST_FIELDS.map(([k]) => [k, s[k].join("\n")])) as typeof lists);
      // Questions the agent kept (unclear answers, follow-ups) stay open; the rest move to "applied".
      const stillOpen = new Set(s.open_questions);
      const kept = new Map(questions.map((q) => [q.question.trim(), q] as const));
      setQuestions(s.open_questions.map((q) => kept.get(q) ?? { question: q, answered: false, answer: "" }));
      setApplied((a) => [...a, ...unapplied.filter((q) => !stillOpen.has(q.question.trim())).map((q) => ({ ...q, answered: true, applied: true }))]);
      setApplyNote(r.note ?? null);
      setResult({ ok: true, message: r.message });
    });
  }

  function run(kind: "approve" | "reject") {
    setBusy(kind);
    startTransition(async () => {
      const r =
        kind === "approve"
          ? await approveSpecAction(specId, currentSpec(), [...questions.filter((q) => q.question.trim()), ...applied])
          : await rejectSpecAction(specId, comment);
      setResult(r);
      setBusy(null);
      if (r?.ok && r.specId) router.push(`/approvals/spec/${r.specId}`);
      else router.refresh();
    });
  }

  // One list field (one item per line), e.g. Must have.
  const listBox = (key: (typeof LIST_FIELDS)[number][0], placeholder = "None specified") => {
    const name = LIST_FIELDS.find(([k]) => k === key)![1];
    return (
      <div>
        <label htmlFor={`spec-${key}`} className={label}>
          {name}
        </label>
        <textarea
          id={`spec-${key}`}
          className={`${input} field-sizing-content min-h-[5.5rem] resize-y font-sans leading-relaxed`}
          rows={Math.max(2, lists[key].split("\n").length)}
          placeholder={readOnly ? "None" : placeholder}
          value={lists[key]}
          onChange={(e) => setLists((l) => ({ ...l, [key]: e.target.value }))}
          disabled={readOnly}
        />
      </div>
    );
  };

  return (
    <div>
      <div className={section}>
        <SectionTitle n="01">Role &amp; compensation</SectionTitle>
        <div className="mt-6 space-y-6">
          <div>
            <label htmlFor="spec-title" className={label}>
              Job title
            </label>
            <input id="spec-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
          </div>
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-5">
            <div>
              <span className={label}>Seniority</span>
              <Dropdown
                label="Seniority"
                size="lg"
                options={seniorityOptions}
                value={seniority}
                onChange={setSeniority}
                disabled={readOnly}
                buttonClassName={input}
              />
              {!seniority && !readOnly && <p className={askClient}>Open question · confirm with client</p>}
            </div>
            <div>
              <label htmlFor="spec-rate" className={label}>
                Rate range
              </label>
              <input id="spec-rate" className={input} value={rate} placeholder="Not provided" onChange={(e) => setRate(e.target.value)} disabled={readOnly} />
              {!rate.trim() && !readOnly && <p className={askClient}>Open question · confirm with client</p>}
            </div>
          </div>
        </div>
      </div>

      <div className={section}>
        <SectionTitle n="02">Requirements</SectionTitle>
        <div className="mt-6 space-y-6">
          {listBox("must_have")}
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-5">
            {listBox("nice_to_have")}
            {listBox("dealbreakers")}
          </div>
        </div>
        {!readOnly && <p className="mt-4 text-sm text-stone-500">Enter one item per line in each list.</p>}
      </div>

      <div className={section}>
        <SectionTitle n="03">Location &amp; selling points</SectionTitle>
        <div className="mt-6 space-y-6">
          {listBox("location")}
          {listBox("selling_points")}
        </div>
      </div>

      <div id="open-questions" className={`${section} scroll-mt-8 ${readOnly ? "border-b-0" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-2xl">Open questions</h3>
          {unresolved > 0 ? (
            <span className="rounded-md bg-amber-100 px-3 py-1 text-sm text-amber-800">{unresolved} unresolved</span>
          ) : (
            questions.length > 0 && <span className="rounded-md bg-emerald-100 px-3 py-1 text-sm text-emerald-800">All answered</span>
          )}
        </div>
        {questions.length === 0 && <p className="mt-4 text-lg text-stone-500">No open questions.</p>}
        <ul className="mt-6 space-y-4">
          {questions.map((q, i) => (
            <li key={i} className={`rounded-xl border px-5 py-4 ${q.answered ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex items-start gap-4">
                <input
                  type="checkbox"
                  className="mt-1.5 size-5 shrink-0 accent-ink"
                  checked={q.answered}
                  onChange={(e) => setQuestion(i, { answered: e.target.checked })}
                  disabled={readOnly}
                  title="Mark as answered"
                  aria-label="Mark as answered"
                />
                <textarea
                  className="field-sizing-content min-h-[5.5rem] min-w-0 flex-1 resize-y bg-transparent disabled:resize-none text-lg leading-relaxed text-ink placeholder:text-stone-400 focus:outline-none"
                  rows={3}
                  placeholder="Type a question for the client"
                  value={q.question}
                  onChange={(e) => setQuestion(i, { question: e.target.value })}
                  disabled={readOnly}
                  aria-label="Question"
                />
                {!readOnly && (
                  <button
                    className="rounded-md p-1 text-stone-500 hover:bg-stone-200/60 hover:text-rose-700"
                    title="Remove question"
                    aria-label="Remove question"
                    onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                  >
                    {icons.x}
                  </button>
                )}
              </div>
              {(q.answered || q.answer) && (
                <input
                  className={`${input} mt-3 bg-white`}
                  placeholder="Answer (optional)"
                  value={q.answer}
                  onChange={(e) => setQuestion(i, { answer: e.target.value })}
                  disabled={readOnly}
                  aria-label="Answer"
                />
              )}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4">
              <button
                className="inline-flex items-center gap-2 border-b border-ink pb-0.5 text-lg"
                onClick={() => setQuestions((qs) => [...qs, { question: "", answered: false, answer: "" }])}
              >
                <span aria-hidden="true">+</span> Add question
              </button>
              <button
                disabled={pending || unapplied.length === 0}
                onClick={applyAnswers}
                title="The agent copies your answers into the spec fields (seniority, rate, must-haves…). You review the result before approving."
                className="rounded-xl border border-stone-300 bg-white px-6 py-3.5 text-lg text-ink hover:bg-stone-100 disabled:border-stone-200 disabled:text-stone-400 disabled:hover:bg-white"
              >
                {busy === "apply" ? "Agent is updating the fields… (~15s)" : `Apply answers to fields${unapplied.length ? ` (${unapplied.length})` : ""}`}
              </button>
            </div>
            <p className="mt-5 text-base text-stone-500">Select a question to add its answer, then apply it to the draft.</p>
          </>
        )}
        {applyNote && <p className="mt-5 rounded-xl border border-stone-300 bg-field px-5 py-4 text-lg">Agent: {applyNote}</p>}
        {applied.length > 0 && (
          <details className="mt-5 text-base text-stone-600">
            <summary className="cursor-pointer">Answers applied to the fields ({applied.length})</summary>
            <ul className="mt-2 space-y-1">
              {applied.map((a, i) => (
                <li key={i}>
                  {a.question} <span className="font-medium text-ink">→ {a.answer}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {!readOnly && (
        <div className="space-y-5 bg-panel px-6 py-8 sm:px-10">
          {unapplied.length > 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-base text-amber-900">
              {unapplied.length} answer(s) are not applied to the fields yet. Click “Apply answers to fields” first, or sourcing won’t see them.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 sm:flex-nowrap">
            <span className="text-lg text-stone-500">Approving creates the job.</span>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:shrink-0 sm:flex-nowrap">
              <button onClick={() => setRejecting((r) => !r)} aria-expanded={rejecting} className="text-lg text-rose-700 hover:underline">
                Reject and regenerate
              </button>
              <button
                disabled={pending}
                onClick={() => run("approve")}
                className="inline-flex items-center gap-6 rounded-xl bg-brand px-8 py-4 text-xl font-semibold text-ink hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed disabled:text-ink/40"
              >
                {busy === "approve" ? "Approving…" : "Approve spec"} {icons.arrowUpRight}
              </button>
            </div>
          </div>
          {rejecting && (
            <div className="rounded-xl border border-stone-300 bg-white p-5">
              <label htmlFor="reject-comment" className={label}>
                What should the agent change? Your comment goes to the agent, which writes a new draft.
              </label>
              <textarea
                id="reject-comment"
                className={input}
                rows={3}
                placeholder='e.g. "Client confirmed: senior level, rate €45-50/hr."'
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                autoFocus
              />
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                <button
                  disabled={pending || !comment.trim()}
                  onClick={() => run("reject")}
                  className="rounded-xl border border-rose-300 bg-white px-6 py-3.5 text-lg text-rose-800 hover:bg-rose-50 disabled:opacity-40 disabled:hover:bg-white"
                >
                  {busy === "reject" ? "Agent is rewriting the spec… (~30s)" : "Reject and regenerate"}
                </button>
                <button onClick={() => setRejecting(false)} className="text-lg text-stone-500 hover:text-ink">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {result && <p className={`text-lg ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.message}</p>}
        </div>
      )}
      {/* After approving, the page's green "Spec approved · job created" panel says it; only errors show here. */}
      {readOnly && result && !result.ok && <p className="px-6 pb-6 text-lg text-red-700 sm:px-10">{result.message}</p>}
    </div>
  );
}

function SectionTitle({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-4 text-xl font-semibold">
      <span className="rounded-md bg-stone-100 px-2 py-1 font-mono text-sm font-normal text-stone-600">{n}</span>
      {children}
    </h3>
  );
}
