// Step 5 outreach settings, in one place (docs/specs/05-outreach-agent.md).

// Who signs outreach messages (no user accounts in the prototype).
export const SENDER_NAME = "Anna";
export const SENDER_SIGNATURE = "Anna, Hireloop";

// Added by the app under every outbound message. Not written by the agent, not editable.
export const OPT_OUT_LINE = 'Not interested? Just reply "stop" and I won\'t message you again.';

// Draft limit (the opt-out line doesn't count).
export const MAX_DRAFT_WORDS = 120;

// A follow-up is due this many days after the last message with no reply, at most MAX_FOLLOW_UPS times.
export const FOLLOW_UP_AFTER_DAYS = 3;
export const MAX_FOLLOW_UPS = 2;
// Out-of-office reply without a return date: pause follow-ups this long.
export const OUT_OF_OFFICE_DEFAULT_DAYS = 7;
