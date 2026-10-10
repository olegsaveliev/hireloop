// "Try an example" on the New brief page: fictional, messy client emails (no real people or companies). Senders use
// test.inbox+101 (Brightline), +102 (Haldor), +103 (Kestrel); saving turns them into your test inbox (src/lib/test-inbox.ts),
// so submissions and client emails really arrive there.
// clientId points at a seed client; if that client isn't in the database, the form fills "+ New client…" from `client`.
export const exampleBriefs = [
  {
    clientId: "client-haldor",
    client: { name: "Haldor Mobility GmbH", country: "Germany", timezone: "Europe/Berlin" },
    fromName: "Jonas Reiter",
    fromEmail: "test.inbox+102@example.com",
    subject: "Senior Go developer for a growing team",
    body: `Hi,

as discussed on the call – we need another backend person for the fleet routing team. Mostly Go, some Kafka, Postgres. Senior, ideally someone who has done event-driven stuff before.

Remote from EU is ok, but they should come to Munich maybe once a quarter. Budget around what we paid last time, I think? Start asap, January latest.

German not needed. Can you send first profiles next week?

Thanks
Jonas`,
  },
  {
    clientId: "client-brightline",
    client: { name: "Brightline Payments", country: "United States", timezone: "America/New_York" },
    fromName: "Dana Whitfield",
    fromEmail: "test.inbox+101@example.com",
    subject: "frontend person?? (react)",
    body: `hey – quick one, our mobile web checkout is a mess and the one FE dev we have is drowning.

looking for React + TypeScript, someone who cares about performance and accessibility. bonus if they've touched payments/PCI before. needs ~4h overlap with NY.

contract to start, 6 months, could go perm. rate tbd, let me know what's realistic.

d.`,
  },
  {
    clientId: "client-kestrel",
    client: { name: "Kestrel Health B.V.", country: "Netherlands", timezone: "Europe/Amsterdam" },
    fromName: "Sanne de Vries",
    fromEmail: "test.inbox+103@example.com",
    subject: "Data engineer – patient analytics",
    body: `Dear Hireloop team,

We are starting a new analytics platform and need a data engineer (mid or senior, we are flexible for the right person).

Stack: Python, dbt, Airflow, Snowflake. Healthcare data experience is a plus but not a must. GDPR awareness is important.

Hybrid in Utrecht would be ideal, full remote within EU possible. Salary range still to be confirmed by HR.

Two more roles may follow in Q2.

Kind regards,
Sanne`,
  },
];
