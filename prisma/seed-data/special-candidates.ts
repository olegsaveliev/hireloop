// Hand-written candidate profiles, each built to exercise a specific test case in /specs.
// The `testCase` field is only for humans reading this file; it is NOT stored or shown to agents.

export const specialCandidates = [
  {
    id: "cand-001",
    testCase: "Step 4 #1: perfect fit for brief-001 (Senior Python/AWS) -> expect 85+",
    fullName: "Andriy Kovalchuk",
    source: "cv_upload",
    language: "en",
    rawProfile: `ANDRIY KOVALCHUK
Senior Python Engineer | Kraków, Poland (relocated from Lviv in 2022)
test.inbox+1@example.com | linkedin.example.com/in/andriy-kovalchuk

SUMMARY
Backend engineer with 8+ years in Python, the last 5 in payments. Comfortable owning services end to end, including on-call. Working hours flexible, regularly overlap with US East Coast until 19:00 CET.

EXPERIENCE
Amber Ledger (fintech, card payments) — Senior Python Engineer, Mar 2021 – Present
- Built settlement & reconciliation services in FastAPI on AWS (Lambda, SQS, RDS PostgreSQL, Step Functions)
- Infrastructure as code with Terraform; migrated 14 services from manually managed EC2
- In the on-call rotation (PagerDuty) for 3 years; led 2 incident postmortems
- Worked under PCI DSS constraints; Kafka consumer for transaction events

Orbita Outsourcing — Python Developer, Jun 2018 – Feb 2021
- Django + PostgreSQL backends for e-commerce clients, AWS ECS deployments, Celery, Redis

Nebo Software — Junior Python Developer, Sep 2016 – May 2018
- Internal tools in Django, REST APIs

SKILLS
Python, FastAPI, Django, PostgreSQL, AWS (Lambda, SQS, RDS, ECS, Step Functions), Terraform, Kafka, Docker, pytest

LANGUAGES
English — C1, Ukrainian — native, Polish — B2`,
  },
  {
    id: "cand-002",
    testCase: "Strong second match for brief-001 (Python/AWS, no payments)",
    fullName: "Kateryna Bondar",
    source: "linkedin_export",
    language: "en",
    rawProfile: `Kateryna Bondar
Headline: Senior Backend Engineer · Python · AWS
Location: Lviv, Ukraine
Contact: test.inbox+2@example.com

About:
Python backend developer focused on event-driven systems on AWS. I like boring, reliable infrastructure.

Experience:
Senior Backend Engineer — Sokil Logistics · Full-time
Apr 2022 - Present
Python 3.12, FastAPI, AWS Lambda, SQS, SNS, DynamoDB and RDS Postgres. Part of on-call rotation.

Backend Developer — Hoverla Tech · Full-time
Jan 2019 - Mar 2022
Django REST Framework, PostgreSQL, Celery, AWS (EC2, S3, RDS).

Skills: Python, FastAPI, Django, AWS, PostgreSQL, SQS, Docker, GitHub Actions
Languages: English (Upper-Intermediate / B2)`,
  },
  {
    id: "cand-003",
    testCase: "Step 4 #2: dealbreaker for brief-001 (no commercial AWS, GCP only) -> expect <=20",
    fullName: "Piotr Zieliński",
    source: "cv_upload",
    language: "en",
    rawProfile: `Piotr Zieliński — Senior Python Developer
Wrocław, Poland · test.inbox+3@example.com · +48 600 000 113

Profile
9 years of Python. All of my commercial cloud work has been on Google Cloud (Cloud Run, Pub/Sub, BigQuery, Cloud SQL). I have never used AWS in a commercial project, only a personal hobby account.

Experience
2020–present  Senior Python Developer, Wawel Soft — FastAPI microservices on GCP, Pub/Sub, Cloud SQL (Postgres). On-call 1 week per month.
2017–2020     Python Developer, Kraków Analytics Hub — Flask APIs, data pipelines on GCP.

Skills: Python, FastAPI, Flask, PostgreSQL, GCP, Pub/Sub, BigQuery, Kubernetes, Kafka
English: C1`,
  },
  {
    id: "cand-004",
    testCase: "Step 3 #2: Ukrainian-language profile (Python backend) -> English output",
    fullName: "Олександр Шевчук",
    source: "referral_note",
    language: "uk",
    rawProfile: `Олександр Шевчук
Python-розробник, Харків (зараз працює віддалено)
Пошта: test.inbox+4@example.com

Досвід:
• Stepova AI — Middle Python Developer, лютий 2023 – дотепер. FastAPI, PostgreSQL, Redis, AWS (S3, Lambda, SQS). Інтеграції з платіжними системами.
• Kashtan Media — Junior Python Developer, вересень 2021 – січень 2023. Django, Celery, MySQL.

Навички: Python, FastAPI, Django, PostgreSQL, Redis, AWS, Docker
Англійська: B1, вчиться далі.`,
  },
  {
    id: "cand-005",
    testCase: "Step 3: Polish-language profile (Java backend) -> English output",
    fullName: "Magdalena Wójcik",
    source: "cv_upload",
    language: "pl",
    rawProfile: `Magdalena Wójcik
Starszy programista Java · Wrocław
e-mail: test.inbox+5@example.com | linkedin.example.com/in/mwojcik

Doświadczenie zawodowe
Bursztyn Commerce — Senior Java Developer (05.2021 – obecnie)
Mikroserwisy w Spring Boot, Kafka, PostgreSQL, Kubernetes na AWS (EKS).

Odra Mobility — Java Developer (09.2017 – 04.2021)
Systemy rezerwacji, Spring, Hibernate, Oracle.

Umiejętności: Java 17, Spring Boot, Kafka, PostgreSQL, Kubernetes, AWS, Docker
Języki: angielski C1, niemiecki A2`,
  },
  {
    id: "cand-006",
    testCase: "Step 3: Ukrainian-language profile (React frontend)",
    fullName: "Ірина Мороз",
    source: "linkedin_export",
    language: "uk",
    rawProfile: `Ірина Мороз — Frontend-розробниця (React)
Місто: Одеса
LinkedIn: linkedin.example.com/in/iryna-moroz
Пошта: test.inbox+6@example.com

Про себе: 6 років у фронтенді, останні 4 — React і TypeScript. Робила інтерактивні карти для логістики (Leaflet, Mapbox GL).

Досвід:
- Sokil Logistics, Frontend Developer, 03.2022 – теперішній час: React, TypeScript, Redux Toolkit, Mapbox GL, Storybook.
- Nebo Software, Junior Frontend Developer, 06.2020 – 02.2022: Angular, потім React.

Англійська — Upper-Intermediate.`,
  },
  {
    id: "cand-007",
    testCase: "Step 3: Polish-language profile (embedded C, CAN)",
    fullName: "Tomasz Krawczyk",
    source: "referral_note",
    language: "pl",
    rawProfile: `Notatka od rekrutera (polecenie od Marka z Tatra IoT):
Tomasz Krawczyk, Gdańsk. Programista systemów wbudowanych, ok. 7 lat doświadczenia.
Obecnie Tatra IoT (od 2020): firmware w C dla STM32, FreeRTOS, magistrala CAN, trochę Yocto.
Wcześniej Gdańsk Shipping Digital (2018–2020): C++ dla urządzeń pokładowych.
Uczy się Rusta po godzinach, nie używał komercyjnie.
Kontakt: test.inbox+7@example.com. Angielski komunikatywny (B2).`,
  },
  {
    id: "cand-008",
    testCase: "Step 4 #3: thin profile -> low confidence",
    fullName: "Dmytro L.",
    source: "referral_note",
    language: "en",
    rawProfile: `Dmytro L. — python dev, some AWS. Kyiv. Friend of a friend, says he's "senior". No CV yet. Email: test.inbox+8@example.com`,
  },
  {
    id: "cand-009",
    testCase: "Step 3: full profile, email in the header line, no LinkedIn",
    fullName: "Natalia Kamińska",
    source: "cv_upload",
    language: "en",
    rawProfile: `Natalia Kamińska
Go Backend Engineer, Poznań · test.inbox+9@example.com

Experience
- Baltic Byte, Senior Go Engineer (Jan 2022 – present): gRPC services, PostgreSQL, Kubernetes on GCP, Prometheus/Grafana.
- Mazury Games, Backend Developer (Jul 2018 – Dec 2021): Go and Python services for game leaderboards, Redis.

Skills: Go, gRPC, PostgreSQL, Redis, Kubernetes, GCP, Python
English: B2`,
  },
  {
    id: "cand-010",
    testCase: "Step 3: overlapping job dates (freelance + full-time) -> count overlap once",
    fullName: "Serhii Tkachenko",
    source: "cv_upload",
    language: "en",
    rawProfile: `Serhii Tkachenko — Node.js / TypeScript Developer
Dnipro, Ukraine | test.inbox+10@example.com

Experience
Dnipro Data Works — Node.js Developer, Jan 2021 – Present
NestJS, PostgreSQL, AWS (ECS, SQS), REST and GraphQL APIs.

Freelance (Upwork) — Full-stack Developer, Jun 2020 – Dec 2022 (part-time, alongside main job)
Small Node/React projects for US clients.

Kashtan Media — Junior JavaScript Developer, Jun 2019 – Dec 2020
Express.js, MongoDB, some React.

Skills: Node.js, TypeScript, NestJS, Express, PostgreSQL, MongoDB, AWS, React
English: B2`,
  },
  {
    id: "cand-011",
    testCase: "Sourcing #2: niche Rust + embedded match for brief-002 role 1",
    fullName: "Oksana Hrytsenko",
    source: "linkedin_export",
    language: "en",
    rawProfile: `Oksana Hrytsenko
Headline: Embedded Rust Engineer | no_std | CAN | STM32
Location: Gdańsk, Poland
Contact: test.inbox+11@example.com · linkedin.example.com/in/ohrytsenko

Experience:
Embedded Software Engineer — Tatra IoT
Feb 2022 - Present
Rewrote telematics firmware modules from C to Rust (no_std, Embassy). CAN bus drivers, STM32F4/H7, defmt, probe-rs. Some Yocto for the Linux gateway.

Firmware Developer — Desna Robotics
Aug 2018 - Jan 2022
C and C++ on STM32 with FreeRTOS. Motor control, CAN, UART.

Skills: Rust (embedded, no_std, Embassy, RTIC), C, C++, STM32, CAN, FreeRTOS, Yocto
Languages: English C1, German B1`,
  },
  {
    id: "cand-012",
    testCase: "Sourcing #2: Rust but backend only (partial match for embedded Rust role)",
    fullName: "Marcin Lewandowski",
    source: "cv_upload",
    language: "en",
    rawProfile: `Marcin Lewandowski
Rust Backend Engineer · Łódź, Poland · test.inbox+12@example.com

2021–now: Rust Engineer at Prut Energy — energy trading platform in Rust (Tokio, Axum, SQLx), PostgreSQL, Kafka.
2017–2021: C++ Developer at Polonia Telecom — network services in C++ on Linux.

No embedded or microcontroller experience.
Skills: Rust, Tokio, Axum, C++, PostgreSQL, Kafka, Linux
English: B2+`,
  },
  {
    id: "cand-013",
    testCase: "Step 3: mentions protected attributes (age, family) -> must not be stored",
    fullName: "Yulia Savchenko",
    source: "referral_note",
    language: "en",
    rawProfile: `Recruiter call notes, 12 Sep 2026:
Yulia Savchenko, 34 years old, married, two kids, lives in Vinnytsia. Very friendly.
React + TypeScript dev, around 8 years in frontend total. Currently at Lumen Insurance Tech since 2021 as Lead Frontend Developer (owns frontend architecture for a team of 5, Next.js, React Query, design system). Before that Zorya Fintech 2018-2021 (React, Redux), and Orbita Outsourcing 2017-2018 (jQuery, then React).
Has done map-heavy dashboards with Leaflet for an insurance claims tool.
English: B2, some German (A2).
Email: test.inbox+13@example.com`,
  },
  {
    id: "cand-014",
    testCase: "Sourcing dedupe: same person as cand-015 (same email), different source",
    fullName: "Bohdan Petrenko",
    source: "linkedin_export",
    language: "en",
    rawProfile: `Bohdan Petrenko
Headline: Senior Kotlin/Java Backend Engineer
Location: Warsaw, Poland
Contact: test.inbox+14@example.com

Experience:
Senior Backend Engineer — Kvitka Health · Full-time
Mar 2021 - Present
Kotlin, Spring Boot, PostgreSQL, Kafka. Patient-records platform, GDPR-compliant data handling.

Java Developer — Saga Outsourcing Group
Jul 2016 - Feb 2021

Skills: Kotlin, Java, Spring Boot, PostgreSQL, Kafka, Kubernetes
English: C1`,
  },
  {
    id: "cand-015",
    testCase: "Sourcing dedupe: duplicate of cand-014 (old CV upload)",
    fullName: "Bogdan Petrenko",
    source: "cv_upload",
    language: "en",
    rawProfile: `Bogdan Petrenko — Java Developer (CV from 2020)
Kyiv · test.inbox+14@example.com
Saga Outsourcing Group, Java Developer, 2016–present. Spring, Hibernate, PostgreSQL, some Kotlin.
English: Upper-Intermediate`,
  },
];
