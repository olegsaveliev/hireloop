import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { ActionButton } from "../action-button";
import { icons } from "../icons";
import { deleteClientAction } from "../inbound-actions";
import { ClientEmail } from "./client-email";

const ink = "text-ink";
const muted = "text-stone-500";
const line = "border-stone-300";
const outlineLink = `inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-5 py-2.5 text-base hover:bg-white ${line} ${ink}`;
const badge = "rounded px-2 py-0.5 text-xs font-normal tracking-normal";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const CLOSED = ["hired", "stopped"];

// Clients (2026-10-09; Briefs style 2026-10-10): every client with what hangs off it, and a bin for clients with no
// briefs and no jobs (docs/specs/11-gmail-inbound.md, "Clients page"). New clients are made on New brief or when a new
// sender is matched on Briefs, so the banner points there.
export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  await connection();
  const tab = (await searchParams).tab;
  const [clients, briefs, jobs, hires, contacts, pastJobs, newSenders] = await Promise.all([
    db.client.findMany({ orderBy: { name: "asc" } }),
    db.clientBrief.findMany({ select: { clientId: true, fromName: true, fromEmail: true, receivedAt: true }, orderBy: { receivedAt: "asc" } }),
    db.job.findMany({ select: { clientId: true, status: true } }),
    db.pipelineEntry.findMany({ where: { stage: "hired" }, select: { job: { select: { clientId: true } } } }),
    db.clientContact.findMany({ orderBy: { createdAt: "asc" } }),
    db.pastJob.groupBy({ by: ["clientId"], _count: true }),
    db.inboundEmail.findMany({ where: { status: "waiting_sender" }, orderBy: { receivedAt: "asc" } }),
  ]);
  const senders = newSenders.filter((e, i) => newSenders.findIndex((x) => x.gmailThreadId === e.gmailThreadId) === i);

  const rows = clients.map((c) => {
    const own = briefs.filter((b) => b.clientId === c.id);
    const ownJobs = jobs.filter((j) => j.clientId === c.id);
    // Where submissions go: the client's email, else the latest brief sender with an email (same as Step 7).
    const contact = contacts.find((x) => x.clientId === c.id);
    const sender = own.findLast((b) => b.fromEmail.trim());
    return {
      client: c,
      briefs: own.length,
      jobs: ownJobs.length,
      hires: hires.filter((h) => h.job.clientId === c.id).length,
      hiring: ownJobs.some((j) => !CLOSED.includes(j.status)),
      since: own[0]?.receivedAt,
      contact: contact
        ? { name: contact.name, email: contact.email }
        : sender
          ? { name: sender.fromName === "Unknown sender" ? null : sender.fromName, email: sender.fromEmail }
          : null,
      senders: contacts.filter((x) => x.clientId === c.id).length,
      pastJobs: pastJobs.find((p) => p.clientId === c.id)?._count ?? 0,
    };
  });
  type Row = (typeof rows)[number];

  const tabs = [
    { key: "all", label: "All", list: rows },
    { key: "hiring", label: "Hiring now", list: rows.filter((r) => r.hiring) },
    { key: "empty", label: "No briefs yet", list: rows.filter((r) => r.briefs === 0 && r.jobs === 0) },
  ];
  const active = tabs.find((t) => t.key === tab) ?? tabs[0];

  // "The next useful thing": a new sender to match first, then a client with nothing yet, else the calm line.
  const empty = tabs[2].list;
  const noEmail = rows.filter((r) => !r.contact);
  const hiring = tabs[1].list;
  const next = senders.length
    ? {
        title: senders.length === 1 ? "A new sender needs a client." : `${senders.length} new senders need a client.`,
        text: `${senders[0].fromName} (${senders[0].fromEmail}) wrote “${senders[0].subject}”. Pick their company on Briefs so the brief lands in the right place.${senders.length > 1 ? ` Also waiting: ${plural(senders.length - 1, "more sender", "more senders")}.` : ""}`,
        href: "/#list",
        cta: "Choose client",
      }
    : noEmail.length
      ? {
          title: noEmail.length === 1 ? `${noEmail[0].client.name} has no email yet.` : `${noEmail.length} clients have no email yet.`,
          text: "Submissions can't be sent to a client without one. Add it with Add email on the client below.",
          href: "#list",
          cta: "Add email",
        }
      : empty.length
        ? {
            title: empty.length === 1 ? `${empty[0].client.name} has no briefs yet.` : `${empty.length} clients have no briefs yet.`,
            text: "Paste their first brief to start a job, or delete the client if it was added by mistake.",
            href: "/briefs/new",
            cta: "New brief",
          }
        : clients.length
          ? {
              title: hiring.length ? `${plural(hiring.length, "client is", "clients are")} hiring now.` : "No open jobs right now.",
              text: `${plural(hires.length, "hire", "hires")} so far across ${plural(clients.length, "client", "clients")}. New clients come from New brief or a new sender on Briefs.`,
              href: hiring.length ? "/jobs" : "/briefs/new",
              cta: hiring.length ? "Open jobs" : "New brief",
            }
          : { title: "No clients yet.", text: "Add the first one with New brief: pick “+ New client…” in the Client list.", href: "/briefs/new", cta: "New brief" };

  const figure = (n: number, one: string, many: string) => (
    <div className="min-w-14">
      <div className="text-3xl leading-none font-bold tracking-[-0.03em] tabular-nums">{n}</div>
      <div className={`mt-1.5 text-xs tracking-[0.08em] uppercase ${muted}`}>{n === 1 ? one : many}</div>
    </div>
  );

  const row = (r: Row, n: number) => {
    const c = r.client;
    const inUse = r.briefs > 0 || r.jobs > 0;
    const goesToo = [r.senders && plural(r.senders, "known sender", "known senders"), r.pastJobs && plural(r.pastJobs, "past job", "past jobs")].filter(Boolean);
    const meta = [c.country, c.timezone.replace("_", " "), r.since && `Client since ${monthYear(r.since)}`].filter(Boolean).join(" / ");
    return (
      <li key={c.id} className="flex flex-wrap items-center gap-x-8 gap-y-4 py-7 sm:flex-nowrap">
        <span className={`w-8 shrink-0 self-start pt-2.5 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(n).padStart(2, "0")}</span>
        <div className="min-w-0 flex-[1_1_300px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-2xl font-semibold tracking-tight break-words sm:text-3xl">
            {c.name}
            {r.hiring ? (
              <span className={`${badge} bg-emerald-100 text-emerald-800`}>Hiring now</span>
            ) : !inUse ? (
              <span className={`${badge} bg-stone-200 text-stone-600`}>No briefs yet</span>
            ) : null}
          </div>
          <div className={`mt-1.5 text-sm tracking-wide uppercase ${muted}`}>{meta}</div>
          <ClientEmail clientId={c.id} contact={r.contact} />
        </div>
        <div className="flex gap-7 max-sm:basis-full max-sm:pl-8">
          {figure(r.briefs, "Brief", "Briefs")}
          {figure(r.jobs, "Job", "Jobs")}
          {figure(r.hires, "Hire", "Hires")}
        </div>
        <div className="flex items-center justify-end gap-2 max-sm:basis-full">
          {r.briefs > 0 && (
            <Link href="/" className={outlineLink}>
              Open briefs {icons.arrowUpRight}
            </Link>
          )}
          {r.jobs > 0 && (
            <Link href="/jobs?tab=all" className={outlineLink}>
              Jobs {icons.arrowUpRight}
            </Link>
          )}
          <ActionButton
            action={deleteClientAction.bind(null, c.id)}
            label={inUse ? "Can't delete: move or delete its briefs first" : `Delete ${c.name}`}
            variant="icon"
            icon={icons.trash}
            disabled={inUse}
            confirm={{
              title: `Delete ${c.name}?`,
              body: `${goesToo.length ? `This also deletes its ${goesToo.join(" and ")}. ` : ""}This can't be undone.`,
              ok: "Delete",
            }}
          />
        </div>
      </li>
    );
  };

  return (
    <div className={`flex flex-col gap-10 pt-2 sm:gap-12 ${ink}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className={`min-w-0 flex-[1_1_240px] text-lg font-semibold tracking-tight uppercase sm:text-xl ${muted}`}>Clients</div>
        <Link href="/briefs/new" className={outlineLink}>
          {icons.plus} New brief
        </Link>
      </div>

      <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] sm:text-7xl lg:text-[5.5rem]">
        The people
        <br />
        we hire for.
      </h1>

      <section aria-label="The next useful thing" className="flex flex-wrap items-center gap-x-8 gap-y-6 rounded-md bg-brand px-6 py-8 text-ink sm:px-12 sm:py-12">
        <div className="min-w-0 flex-[1_1_360px]">
          <div className="text-xs font-semibold tracking-[0.25em] uppercase sm:text-sm">The next useful thing</div>
          <p className="mt-4 text-2xl tracking-tight sm:text-4xl">{next.title}</p>
          <p className="mt-4 text-base break-words">{next.text}</p>
        </div>
        <Link href={next.href} className="inline-flex items-center gap-3 rounded-xl bg-ink px-7 py-4 text-lg font-semibold whitespace-nowrap text-white hover:bg-black">
          {next.cta} {icons.arrowUpRight}
        </Link>
      </section>

      <div id="list" className="flex scroll-mt-6 flex-col gap-4">
        <nav className="flex flex-wrap gap-1 sm:gap-2" aria-label="Clients">
          {tabs.map((t) => {
            const on = t.key === active.key;
            return (
              <Link
                key={t.key}
                href={t.key === "all" ? "/clients" : `/clients?tab=${t.key}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3.5 py-2.5 text-base whitespace-nowrap sm:px-5 sm:py-3 sm:text-lg ${on ? "bg-ink text-white" : `${muted} hover:text-ink`}`}
              >
                {t.label} · {t.list.length}
              </Link>
            );
          })}
        </nav>

        {active.list.length ? (
          <ul className={`divide-y divide-stone-300 border-b ${line}`}>{active.list.map((r, i) => row(r, i + 1))}</ul>
        ) : (
          <Empty>
            {{ hiring: "No client has an open job right now.", empty: "Every client has a brief or a job." }[active.key] ??
              "No clients yet. Add one from New brief (Client → + New client…)."}
          </Empty>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{children}</div>;
}
