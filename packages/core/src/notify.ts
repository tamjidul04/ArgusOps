import { spawn } from "node:child_process";

/**
 * Native desktop notifications with nothing to install: a Windows toast (via built-in PowerShell),
 * macOS Notification Center (osascript) or notify-send on Linux.
 * The text is never pasted into a script or shell line: it travels in environment variables
 * (Windows) or as separate arguments (macOS/Linux), so an agent name or log line can't inject a command.
 */

export interface DesktopCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const WINDOWS_TOAST = [
  "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
  "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
  "$t = $xml.GetElementsByTagName('text')",
  "$t.Item(0).AppendChild($xml.CreateTextNode($env:ARGUS_NOTIFY_TITLE)) > $null",
  "$t.Item(1).AppendChild($xml.CreateTextNode($env:ARGUS_NOTIFY_BODY)) > $null",
  "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
  // PowerShell's own app id, which Windows always allows to show toasts
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)",
].join("; ");

export function clip(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

/** The OS command that shows a notification, or null where we don't know how. */
export function desktopCommand(platform: NodeJS.Platform, title: string, body: string): DesktopCommand | null {
  const t = clip(title, 80);
  const b = clip(body, 220);
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", WINDOWS_TOAST],
      env: { ARGUS_NOTIFY_TITLE: t, ARGUS_NOTIFY_BODY: b },
    };
  }
  if (platform === "darwin") {
    return {
      command: "osascript",
      args: ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", t, b],
    };
  }
  if (platform === "linux" || platform === "freebsd" || platform === "openbsd") {
    return { command: "notify-send", args: ["--app-name=ArgusOps", t, b] };
  }
  return null;
}

/** Shows a desktop notification and never throws or blocks; does nothing if ARGUS_NO_DESKTOP_NOTIFY is set. */
export function desktopNotify(title: string, body: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.ARGUS_NO_DESKTOP_NOTIFY) return false;
  const cmd = desktopCommand(process.platform, title, body);
  if (!cmd) return false;
  try {
    const child = spawn(cmd.command, cmd.args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
      env: { ...env, ...cmd.env } as NodeJS.ProcessEnv,
    });
    child.on("error", () => undefined); // e.g. notify-send not installed
    child.unref();
    return true;
  } catch {
    return false;
  }
}
