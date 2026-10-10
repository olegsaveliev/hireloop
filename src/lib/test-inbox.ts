// Demo data (seed candidates, clients, "Try an example" briefs) uses placeholder addresses like
// test.inbox+12@example.com. When you set a test inbox (Keys menu or GOOGLE_TEST_INBOX), they become
// you+12@gmail.com, so emails the app sends to demo candidates and clients land in your own test inbox.
export const PLACEHOLDER_INBOX = "test.inbox@example.com";

export function toTestInbox(text: string, inbox = process.env.GOOGLE_TEST_INBOX): string {
  const target = (inbox ?? "").split(",")[0].trim().toLowerCase();
  const [local, domain] = target.split("@");
  if (!local || !domain) return text;
  return text.replace(/test\.inbox(\+[\w-]+)?@example\.com/g, (_, plus: string | undefined) => `${local}${plus ?? ""}@${domain}`);
}
