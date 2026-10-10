// Fictional clients, briefs, and past jobs (mock_ats). Any resemblance to real companies is accidental.

export const clients = [
  {
    id: "client-brightline",
    name: "Brightline Payments",
    country: "United States",
    timezone: "America/New_York",
  },
  {
    id: "client-haldor",
    name: "Haldor Mobility GmbH",
    country: "Germany",
    timezone: "Europe/Berlin",
  },
  {
    id: "client-kestrel",
    name: "Kestrel Health B.V.",
    country: "Netherlands",
    timezone: "Europe/Amsterdam",
  },
];

export const briefs = [
  {
    id: "brief-001",
    clientId: "client-brightline",
    fromName: "Dana Whitfield",
    fromEmail: "test.inbox+101@example.com",
    subject: "Re: backend help for Q1 - python person",
    receivedAt: "2026-09-29T14:12:00Z",
    body: `Hi team,

Following up on our call last week. We're ready to bring on a Senior Python engineer for the payments reconciliation squad. Quick summary so you have it in writing:

- Python 3, FastAPI (we're moving off Django slowly, so Django experience is fine too)
- AWS is a must: Lambda, SQS, RDS Postgres. Terraform would be great but we can teach it
- Someone who has actually been on-call for a production system
- Remote from Poland or Ukraine is totally fine, but they need ~4h overlap with New York (so roughly until 7pm their time)
- Budget is $55-65/hr, B2B contract, 12 months with extension

Honestly the one thing we won't do again: no AWS experience. Last contractor was GCP-only and it was a mess, so please don't send anyone who hasn't worked with AWS commercially.

Nice to have: fintech/payments background, some Kafka, any exposure to PCI DSS.

We'd like to start interviews in the next 2 weeks if possible.

Thanks!
Dana

--
Dana Whitfield | Engineering Manager, Reconciliation
Brightline Payments`,
  },
  {
    id: "brief-002",
    clientId: "client-haldor",
    fromName: "Markus Feld",
    fromEmail: "test.inbox+102@example.com",
    subject: "two openings + question",
    receivedAt: "2026-10-01T08:47:00Z",
    body: `Hello Hireloop,

we have two things now, sorry for the long mail.

1) Firmware for our new telematics box. We are rewriting parts from C to Rust. We need somebody who knows embedded Rust (no_std, embassy or RTIC), CAN bus, ideally STM32. Yocto would also help but is not critical. On-site in Munich one week per quarter, rest remote. Rate like before.

2) For the fleet dashboard a frontend developer, React + TypeScript, maps (Mapbox or Leaflet). Should be junior level because of budget, but with 8+ years of experience and able to lead the frontend architecture alone. English B2 minimum, German is a plus.

For both: EU timezone, contract via B2B. Start ASAP, latest December.

Question: can you also do QA? We maybe need someone in 2027.

Best regards
Markus Feld
Head of Engineering, Haldor Mobility GmbH`,
  },
  {
    id: "brief-003",
    clientId: "client-kestrel",
    fromName: "Sophie van Dijk",
    fromEmail: "test.inbox+103@example.com",
    subject: "urgent",
    receivedAt: "2026-10-03T16:30:00Z",
    body: `hey, need a strong backend dev asap, our guy is leaving end of month. can you send people this week? thx

Sent from my iPhone`,
  },
];

export const pastJobs = [
  {
    id: "pastjob-001",
    clientId: "client-brightline",
    title: "Senior Python Engineer (Payments API)",
    seniority: "senior",
    stack: ["Python", "Django", "AWS", "PostgreSQL"],
    rateRange: "$55-62/hr",
    outcome: "filled",
    notes: "Hired from Lviv. Client valued on-call experience and clear written English.",
    closedAt: "2025-11-14T00:00:00Z",
  },
  {
    id: "pastjob-002",
    clientId: "client-brightline",
    title: "Data Engineer",
    seniority: "middle",
    stack: ["Python", "Airflow", "AWS Glue", "Redshift"],
    rateRange: "$45-50/hr",
    outcome: "cancelled",
    notes: "Role cancelled after budget freeze.",
    closedAt: "2026-03-02T00:00:00Z",
  },
  {
    id: "pastjob-003",
    clientId: "client-haldor",
    title: "Embedded C++ Engineer (Telematics)",
    seniority: "senior",
    stack: ["C++", "STM32", "FreeRTOS", "CAN"],
    rateRange: "€50-58/hr",
    outcome: "filled",
    notes: "Client requires anonymized profiles. Quarterly on-site visit in Munich.",
    closedAt: "2025-06-20T00:00:00Z",
  },
  {
    id: "pastjob-004",
    clientId: "client-haldor",
    title: "Frontend Developer (Angular)",
    seniority: "middle",
    stack: ["Angular", "TypeScript", "RxJS"],
    rateRange: "€38-45/hr",
    outcome: "filled",
    notes: "Client asked for B2 English minimum.",
    closedAt: "2026-01-30T00:00:00Z",
  },
  {
    id: "pastjob-005",
    clientId: "client-kestrel",
    title: "Backend Developer (Kotlin)",
    seniority: "senior",
    stack: ["Kotlin", "Spring Boot", "PostgreSQL", "Kafka"],
    rateRange: "€52-60/hr",
    outcome: "filled",
    notes: "Healthcare data; client asked about GDPR awareness. Team in Amsterdam, CET hours.",
    closedAt: "2025-09-05T00:00:00Z",
  },
];

// Simulated inbound candidate replies (mock_inbox). `intent` = the correct classification.
export const seedReplies = [
  {
    id: "reply-interested",
    intent: "interested",
    body: "Hi, thanks for reaching out! The payments project sounds interesting and I'm open to a change. When could we talk? Tuesday or Wednesday afternoon works for me.",
  },
  {
    id: "reply-not-interested",
    intent: "not_interested",
    body: "Thanks, but I'm happy where I am and not looking. Please stop sending me messages about new roles.",
  },
  {
    id: "reply-rate-question",
    intent: "question",
    body: "Hey, could be interesting. How much does it pay? And is it B2B or employment?",
  },
  {
    id: "reply-out-of-office",
    intent: "out_of_office",
    body: "Automatic reply: I'm on vacation with limited access to email until 20 October 2026. I will reply after I'm back.",
  },
  {
    id: "reply-later",
    intent: "later",
    body: "Not the right time for me, my current project ends in March. Feel free to ping me again in February.",
  },
];
