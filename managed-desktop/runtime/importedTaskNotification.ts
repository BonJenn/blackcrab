/** Presentation only: never rewrite history or turn notification text into actions. */
export interface ImportedTaskNotification {
  readonly summary: string;
  readonly event: string;
}

const MONITOR_FOOTER =
  "If this event is something the user would act on now, send a PushNotification. Routine or benign output doesn't need one.";

export function importedTaskNotification(message: {
  readonly id?: string;
  readonly role: string;
  readonly text: string;
  readonly createdBy?: string;
  readonly creationSource?: string;
  readonly attachments?: ReadonlyArray<unknown> | undefined;
}): ImportedTaskNotification | undefined {
  // The historical importer retained these provider envelopes as user records.
  // Never classify a new web/mobile prompt, quoted XML, or an attachment by text alone.
  if (
    message.role !== "user" ||
    message.createdBy !== "user" ||
    message.creationSource !== "server" ||
    !/^import:[^\r\n]+:[0-9]{6}$/.test(message.id ?? "") ||
    (message.attachments?.length ?? 0) !== 0 ||
    message.text.length > 64 * 1024
  ) return undefined;

  const text = message.text.trim();
  for (const tag of ["task-notification", "task-id", "summary", "event"]) {
    if (text.split(`<${tag}>`).length !== 2 || text.split(`</${tag}>`).length !== 2) {
      return undefined;
    }
  }
  const match = /^<task-notification>\s*<task-id>[A-Za-z0-9_-]{1,128}<\/task-id>\s*<summary>([^<>]+)<\/summary>\s*<event>([\s\S]+?)<\/event>\s*([\s\S]*?)\s*<\/task-notification>$/.exec(text);
  if (!match || match[3]?.trim() !== MONITOR_FOOTER) return undefined;
  const summary = match[1]!.trim();
  const event = match[2]!.trim();
  if (!summary.startsWith("Monitor event:") || summary.length > 1024 || !event) return undefined;
  return { summary, event };
}
