# NextStep — Compliance Reference

This file is MANDATORY reading for Backend, AI, and Integration agents before touching any student data.

---

## FERPA (Family Educational Rights and Privacy Act)

### What it protects
Student education records — grades, transcripts, GPA, attendance, disciplinary records, and any personally identifiable information (PII) derived from them.

### NextStep obligations
- Students (or parents if under 18) must provide written consent before we access or share education records.
- We may only use education records for the stated purpose (academic guidance) — not advertising, not resale.
- Students/parents have the right to inspect their records and request corrections.
- We must maintain an audit log of every access to education records.

### Implementation requirements
- `compliance_audit_log` table: records `user_id`, `resource_type`, `resource_id`, `action`, `timestamp`, `ip_address` for every read/write of student records.
- Consent must be captured and stored before the first grade sync.
- Data deletion requests must purge ALL student data within 30 days.
- No student PII in logs, error messages, or analytics events — use `student_id` (UUID) only.

---

## COPPA (Children's Online Privacy Protection Act)

### What it covers
Users under 13. Any data collection from users under 13 requires verifiable parental consent.

### NextStep obligations
- Age gate on signup — collect date of birth.
- If age < 13: block account creation until parent provides verifiable consent (email confirmation minimum, or parental email + acknowledgment).
- Do not collect any data beyond what is strictly necessary for the service.
- Parents can review, correct, or delete their child's data at any time.

### Implementation requirements
- `users` table: `date_of_birth` (encrypted), `coppa_consent_status` (`pending` | `verified` | `not_required`), `coppa_consent_timestamp`, `coppa_parent_email`.
- All data collection endpoints must check `coppa_consent_status` before proceeding for users under 13.
- Marketing emails: never send to users under 13.

---

## State Privacy Laws (varies by district)

### Key laws to be aware of
- **SOPIPA** (CA) — No targeted advertising based on student data. No sale of student data.
- **NY Ed Law 2-d** — Strict data security requirements for NY districts.
- **TX SPEEA** — Similar restrictions to SOPIPA.

### NextStep approach
- Default to the most restrictive interpretation across all states.
- Legal review ($3k–$7.5k) required before any school district goes live.
- Privacy Policy and Terms of Service must be attorney-reviewed.
- No student data used for advertising — ever.

---

## Data Handling Rules (for all agents)

| Rule | Requirement |
|------|-------------|
| Encryption at rest | AES-256 on all student data fields |
| Encryption in transit | TLS 1.3 minimum |
| School credentials | AWS Secrets Manager only — never in DB |
| PII in logs | NEVER — use UUID references only |
| Data retention | Configurable per district; default 1 year after last login |
| Data deletion | Full purge within 30 days of request |
| Third-party sharing | Prohibited without explicit consent and FERPA-compliant data sharing agreement |
| AI training on student data | PROHIBITED — never use student data to fine-tune models |

---

## Consent Flow (required before any data collection)

```
1. User enters date of birth
   → If ≥ 13: show standard Terms + Privacy Policy → student accepts
   → If < 13: collect parent email → send parent consent email
              → Parent confirms → coppa_consent_status = 'verified'
              → Only then allow account creation

2. Before first grade sync:
   → Show "What data we access and why" screen
   → Explicit "Connect my school account" consent
   → Record consent in compliance_audit_log

3. School credential input:
   → Clear UI: "We store this securely and never share it"
   → Credentials go directly to Secrets Manager — never to DB
```

---

## Agent Checklist — Before writing any code that touches student data

- [ ] Is this endpoint auth-guarded?
- [ ] Does the query include a `WHERE user_id = :requestingUserId` or equivalent RLS enforcement?
- [ ] Is student PII excluded from all logs and error responses?
- [ ] Is a compliance_audit_log entry written for this access?
- [ ] Has consent been verified before this data is accessed?
- [ ] Are school credentials handled via Secrets Manager (not DB)?

If any checkbox is unchecked, do NOT ship the code. Fix it first.
