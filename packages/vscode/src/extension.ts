import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { ApiError, ArgusClient, type AgentsResponse, type NotificationBrief, type UsageBrief } from "./api";
import { Supervisor } from "./supervise";
import { overviewBody, overviewHtml, type OverviewState } from "./overview";
import { clip, diffForAlerts, formatTokens, kindOf, KIND_LABEL, normalizeServerUrl, statusBar, summarize, timeAgo, type AgentView, type Kind } from "./model";

const SECRET = "argusops.credentials";
const DEFAULT_SERVER = "http://localhost:3000";
const SUPERVISE_KEY = "argusops.supervise"; // "yes" | "no" | unset (never asked)

interface Credentials {
  url: string;
  key: string;
}

type Node =
  | { type: "agent"; agent: AgentView }
  | { type: "suggestion"; agent: AgentView }
  | { type: "detail"; label: string; description: string; icon: string };

const ICON: Record<Kind, { id: string; color: string }> = {
  running: { id: "play-circle", color: "testing.iconPassed" },
  paused: { id: "debug-pause", color: "list.warningForeground" },
  stopped: { id: "stop-circle", color: "testing.iconFailed" },
  idle: { id: "circle-outline", color: "disabledForeground" },
};

const ORDER: Record<Kind, number> = { paused: 0, running: 1, stopped: 2, idle: 3 };

/** Messages the dashboard panel may send. Anything else is ignored. */
const PANEL_ACTIONS = new Set(["approve", "resume", "stop", "dashboard", "refresh", "signin"]);
/** The panel's extra numbers change slowly, so they are fetched less often than the agent list. */
const EXTRAS_EVERY_MS = 20_000;

export class ArgusController implements vscode.TreeDataProvider<Node>, vscode.WebviewViewProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private creds: Credentials | null = null;
  private data: AgentsResponse | null = null;
  private previous: AgentView[] | null = null;
  private offline = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly bar: vscode.StatusBarItem;
  private view: vscode.TreeView<Node> | undefined;
  private panel: vscode.WebviewView | undefined;
  private panelBody = "";
  private extras: { usage: UsageBrief | null; notifications: NotificationBrief[] | null; unread: number; at: number } = { usage: null, notifications: null, unread: 0, at: 0 };

  constructor(private readonly context: vscode.ExtensionContext) {
    this.bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.bar.command = "argusops.showAgents";
  }

  /* ------------------------------ lifecycle ------------------------------ */

  async start() {
    this.view = vscode.window.createTreeView("argusops.agents", { treeDataProvider: this, showCollapseAll: false });
    this.context.subscriptions.push(
      this.view,
      this.bar,
      this,
      vscode.window.registerWebviewViewProvider("argusops.overview", this, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("argusops")) {
          this.schedule();
          void this.refresh();
        }
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) void this.refresh();
      })
    );
    this.bar.show();
    await this.loadCredentials();
    await this.refresh();
    this.schedule();
    this.welcome();
    await this.syncSupervision(false);
  }

  /* --------------------- supervising the Claude Code panel --------------------- */

  private supervisor: Supervisor | null = null;

  private getSupervisor(): Supervisor {
    if (!this.supervisor) {
      const out = vscode.window.createOutputChannel("ArgusOps");
      this.context.subscriptions.push(out);
      this.supervisor = new Supervisor({
        readEnv: () => vscode.workspace.getConfiguration("claudeCode").inspect("environmentVariables")?.globalValue,
        writeEnv: async (list) => {
          try {
            await vscode.workspace.getConfiguration("claudeCode").update("environmentVariables", list, vscode.ConfigurationTarget.Global);
          } catch {
            // the Claude Code extension isn't installed, so there is nothing to point
          }
        },
        log: (t) => out.append(t),
      });
    }
    return this.supervisor;
  }

  /** Starts or stops supervision to match the saved choice. The first time after sign-in it asks, once. */
  async syncSupervision(offer: boolean): Promise<void> {
    const state = this.context.globalState;
    const choice = state?.get<string>(SUPERVISE_KEY);
    if (!this.creds || choice === "no") return this.supervisor?.set(null);
    if (choice === "yes") return this.getSupervisor().set(this.creds);
    if (!offer) return;
    const pick = await vscode.window.showInformationMessage(
      "Let ArgusOps watch Claude Code in VS Code? It catches loops, pauses the spend and tells you. Your Claude login is not touched, and you can turn this off any time.",
      "Allow",
      "Not now"
    );
    if (pick === "Allow") await this.setSupervision(true);
  }

  async setSupervision(on: boolean): Promise<void> {
    await this.context.globalState?.update(SUPERVISE_KEY, on ? "yes" : "no");
    if (on && !this.creds) return void this.signIn();
    await this.syncSupervision(false);
    void vscode.window.showInformationMessage(
      on ? "ArgusOps is watching Claude Code. Reload the window once if a Claude panel is already open." : "ArgusOps stopped watching Claude Code. Reload the window if a Claude panel is open."
    );
  }

  async stopSupervisor(): Promise<void> {
    await this.supervisor?.stop();
  }

  /** Once, right after install: say the extension is running and offer to sign in (so it can't go unnoticed). */
  private welcome() {
    const state = this.context.globalState;
    if (!state || this.signedIn || state.get<boolean>("argusops.welcomed")) return;
    void state.update("argusops.welcomed", true);
    void vscode.window.showInformationMessage("ArgusOps is installed. Sign in to see your coding agents and get told when one is stuck.", "Sign in", "Later").then((c) => {
      if (c === "Sign in") void this.signIn();
    });
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.changed.dispose();
  }

  private schedule() {
    if (this.timer) clearInterval(this.timer);
    const seconds = Math.min(60, Math.max(2, Number(this.config().get("pollIntervalSeconds", 4)) || 4));
    this.timer = setInterval(() => void this.refresh(), seconds * 1000);
  }

  private config() {
    return vscode.workspace.getConfiguration("argusops");
  }

  private serverUrl(): string {
    return normalizeServerUrl(String(this.config().get("serverUrl", DEFAULT_SERVER))) ?? DEFAULT_SERVER;
  }

  /* ----------------------------- credentials ----------------------------- */

  private async loadCredentials() {
    const raw = await this.context.secrets.get(SECRET);
    this.creds = null;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Credentials>;
      // a key is only ever sent to the server it was issued by
      if (typeof parsed.key === "string" && typeof parsed.url === "string" && parsed.url === this.serverUrl()) {
        this.creds = { url: parsed.url, key: parsed.key };
      }
    } catch {
      // unreadable: treat as signed out
    }
  }

  private async saveCredentials(creds: Credentials) {
    await this.context.secrets.store(SECRET, JSON.stringify(creds));
    this.creds = creds;
  }

  private client(): ArgusClient | null {
    return this.creds ? new ArgusClient(this.creds.url, this.creds.key) : null;
  }

  get signedIn(): boolean {
    return this.creds !== null;
  }

  /* ------------------------------- polling ------------------------------- */

  async refresh(): Promise<void> {
    const client = this.client();
    if (!client) {
      this.data = null;
      this.previous = null;
      this.render();
      return;
    }
    try {
      const data = await client.agents();
      this.offline = false;
      this.data = data;
      this.alert(diffForAlerts(this.previous, data.agents), this.previous === null);
      this.previous = data.agents;
      await this.loadExtras(client);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await this.context.secrets.delete(SECRET);
        this.creds = null;
        this.data = null;
        this.previous = null;
        this.extras = { usage: null, notifications: null, unread: 0, at: 0 };
        void this.syncSupervision(false);
        void vscode.window.showWarningMessage("ArgusOps: this key is no longer valid (it may have been revoked). Sign in again.", "Sign in").then((c) => {
          if (c) void vscode.commands.executeCommand("argusops.signIn");
        });
      } else {
        this.offline = true;
      }
    }
    this.render();
  }

  private render() {
    const agents = this.data?.agents ?? [];
    const s = statusBar({ signedIn: this.signedIn, offline: this.offline, summary: summarize(agents) });
    this.bar.text = s.text;
    this.bar.tooltip = s.tooltip;
    this.bar.backgroundColor = s.attention ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    void vscode.commands.executeCommand("setContext", "argusops.signedIn", this.signedIn);
    void vscode.commands.executeCommand("setContext", "argusops.noAgents", this.signedIn && agents.length === 0);
    this.pushPanel();
    if (this.view) this.view.description = this.data?.plan ? `${this.data.plan.name} · ${formatTokens(this.data.plan.tokensRemaining)} tokens left` : undefined;
    this.changed.fire(undefined);
  }

  /* --------------------------- the dashboard panel --------------------------- */

  /** Usage and alerts for the panel. A failure here never affects the agent list: the panel just shows a dash. */
  private async loadExtras(client: ArgusClient) {
    if (Date.now() - this.extras.at < EXTRAS_EVERY_MS) return;
    this.extras.at = Date.now();
    const [usage, notes] = await Promise.allSettled([client.usage("7d"), client.notifications(5)]);
    if (usage.status === "fulfilled") this.extras.usage = usage.value;
    if (notes.status === "fulfilled") {
      this.extras.notifications = notes.value.notifications;
      this.extras.unread = notes.value.unread;
    }
  }

  private panelState(): OverviewState {
    return {
      signedIn: this.signedIn,
      offline: this.offline,
      user: this.data?.user ?? null,
      plan: this.data?.plan ?? null,
      agents: this.data?.agents ?? [],
      usage: this.extras.usage,
      notifications: this.extras.notifications,
      unread: this.data?.unreadNotifications ?? this.extras.unread,
    };
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.panel = view;
    view.webview.options = { enableScripts: true };
    this.panelBody = overviewBody(this.panelState());
    view.webview.html = overviewHtml(this.panelState(), { nonce: randomBytes(16).toString("base64") });
    view.webview.onDidReceiveMessage((m: unknown) => void this.onPanelMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.panelBody = "";
        this.pushPanel();
      }
    });
    view.onDidDispose(() => {
      if (this.panel === view) this.panel = undefined;
    });
  }

  /** Swaps the inside of the open panel when something changed (no page reload, so no flicker or lost scroll). */
  private pushPanel() {
    if (!this.panel) return;
    const body = overviewBody(this.panelState());
    if (body === this.panelBody) return;
    this.panelBody = body;
    void this.panel.webview.postMessage({ type: "render", html: body });
  }

  /** The panel is a view of ours, but its messages are still checked: known action, and agents looked up by id. */
  private async onPanelMessage(m: unknown) {
    if (typeof m !== "object" || m === null) return;
    const { type, id } = m as { type?: unknown; id?: unknown };
    if (typeof type !== "string" || !PANEL_ACTIONS.has(type)) return;
    if (type === "dashboard") return void this.openDashboard();
    if (type === "refresh") return void (await this.refresh());
    if (type === "signin") return void (await this.signIn());

    const agent = typeof id === "string" ? (this.data?.agents ?? []).find((a) => a.id === id) : undefined;
    if (!agent) return;
    if (type === "approve") return void (await this.approveAsIs(agent));
    if (type === "resume") return void (await this.resume(agent));
    if (type === "stop") return void (await this.stop(agent));
  }

  /* ------------------------------- alerts -------------------------------- */

  private alert(a: { paused: AgentView[]; stopped: AgentView[] }, firstLoad: boolean) {
    if (!this.config().get("notifications", true)) return;

    if (a.paused.length > 1 || (firstLoad && a.paused.length === 1)) {
      const n = a.paused.length;
      const text = firstLoad ? `${n} agent${n === 1 ? " is" : "s are"} waiting for you in ArgusOps.` : `${n} agents were paused and need you.`;
      void vscode.window.showWarningMessage(text, "Review").then((c) => {
        if (c) void this.showAgents();
      });
    } else if (a.paused.length === 1) {
      const agent = a.paused[0];
      const why = clip(agent.currentTask ?? "it looked stuck", 140);
      if (agent.suggestion) {
        void vscode.window
          .showWarningMessage(`${agent.name} was paused: ${why}. Suggested next step: "${clip(agent.suggestion.text, 160)}"`, "Approve suggestion", "Edit…", "Stop")
          .then((c) => {
            if (c === "Approve suggestion") void this.approveAsIs(agent);
            else if (c === "Edit…") void this.resume(agent);
            else if (c === "Stop") void this.stop(agent);
          });
      } else {
        void vscode.window.showWarningMessage(`${agent.name} was paused: ${why}.`, "Resume…", "Review", "Stop").then((c) => {
          if (c === "Resume…") void this.resume(agent);
          else if (c === "Review") void this.showAgents();
          else if (c === "Stop") void this.stop(agent);
        });
      }
    }
    for (const s of a.stopped) void vscode.window.showInformationMessage(`${s.name} was stopped.`);
  }

  /* ------------------------------- the tree ------------------------------- */

  getChildren(el?: Node): Node[] {
    if (!this.signedIn) return [];
    if (!el) {
      const agents = [...(this.data?.agents ?? [])].sort((x, y) => ORDER[kindOf(x.status)] - ORDER[kindOf(y.status)]);
      return agents.map((agent) => ({ type: "agent" as const, agent }));
    }
    if (el.type !== "agent") return [];
    const a = el.agent;
    const out: Node[] = [];
    if (kindOf(a.status) === "paused" && a.suggestion) out.push({ type: "suggestion", agent: a });
    if (a.currentTask) out.push({ type: "detail", label: kindOf(a.status) === "paused" ? "Why" : "Doing", description: clip(a.currentTask, 90), icon: "info" });
    out.push({ type: "detail", label: "Tokens used", description: formatTokens(a.tokensUsed), icon: "pulse" });
    out.push({ type: "detail", label: "Last seen", description: timeAgo(a.lastSeen), icon: "clock" });
    return out;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === "detail") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.description = node.description;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.contextValue = "detail";
      return item;
    }
    if (node.type === "suggestion") {
      const s = node.agent.suggestion!;
      const item = new vscode.TreeItem("Suggested instruction", vscode.TreeItemCollapsibleState.None);
      item.description = clip(s.text, 70);
      item.iconPath = new vscode.ThemeIcon("sparkle");
      const tip = new vscode.MarkdownString();
      tip.appendText(s.text);
      tip.appendMarkdown(`\n\n*${s.observed.replace(/\*/g, "")}*`);
      item.tooltip = tip;
      item.contextValue = "suggestion";
      item.command = { command: "argusops.resumeAgent", title: "Review and resume", arguments: [node] };
      return item;
    }
    const a = node.agent;
    const kind = kindOf(a.status);
    const item = new vscode.TreeItem(a.name, kind === "paused" ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    item.description = KIND_LABEL[kind];
    item.iconPath = new vscode.ThemeIcon(ICON[kind].id, new vscode.ThemeColor(ICON[kind].color));
    item.contextValue = `agent.${kind}`;
    const tip = new vscode.MarkdownString();
    tip.appendMarkdown(`**${a.name.replace(/[*_`]/g, "")}**  \n${KIND_LABEL[kind]} · ${formatTokens(a.tokensUsed)} tokens · seen ${timeAgo(a.lastSeen)}`);
    item.tooltip = tip;
    return item;
  }

  /* ------------------------------- commands ------------------------------- */

  private agentFrom(arg: unknown): AgentView | null {
    const maybe = arg as { agent?: AgentView; id?: string; status?: string } | undefined;
    if (maybe?.agent?.id) return maybe.agent;
    if (maybe?.id && maybe.status) return maybe as AgentView;
    return null;
  }

  private async pick(arg: unknown, kinds: Kind[], placeholder: string): Promise<AgentView | null> {
    const given = this.agentFrom(arg);
    if (given) return given;
    const candidates = (this.data?.agents ?? []).filter((a) => kinds.includes(kindOf(a.status)));
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage("No agents to act on right now.");
      return null;
    }
    if (candidates.length === 1) return candidates[0];
    const chosen = await vscode.window.showQuickPick(
      candidates.map((a) => ({ label: a.name, description: KIND_LABEL[kindOf(a.status)], agent: a })),
      { placeHolder: placeholder }
    );
    return chosen?.agent ?? null;
  }

  /** Runs an API call and reports a failure in plain words. */
  private async attempt(action: () => Promise<{ message?: string }>, fallback: string): Promise<boolean> {
    try {
      const r = await action();
      void vscode.window.showInformationMessage(r.message || fallback);
      await this.refresh();
      return true;
    } catch (e) {
      const msg = e instanceof ApiError ? (e.status === 0 ? "Couldn't reach the ArgusOps server." : e.message) : "Something went wrong.";
      void vscode.window.showErrorMessage(`ArgusOps: ${msg}`);
      return false;
    }
  }

  async resume(arg?: unknown) {
    const client = this.client();
    if (!client) return this.signIn();
    const agent = await this.pick(arg, ["paused"], "Which agent do you want to resume?");
    if (!agent) return;

    if (agent.suggestion) {
      const text = await vscode.window.showInputBox({
        title: `Resume ${agent.name}`,
        prompt: "Suggested instruction. Edit it if you like, then press Enter to send it and resume.",
        value: agent.suggestion.text,
        ignoreFocusOut: true,
      });
      if (text === undefined) return;
      await this.attempt(() => client.approveSuggestion(agent.suggestion!.id, text), `${agent.name} will resume.`);
    } else {
      const hint = await vscode.window.showInputBox({
        title: `Resume ${agent.name}`,
        prompt: "Optional: tell the agent something. Leave empty to just resume.",
        ignoreFocusOut: true,
      });
      if (hint === undefined) return;
      await this.attempt(() => client.resume(agent.id, hint), `${agent.name} will resume.`);
    }
  }

  private async approveAsIs(agent: AgentView) {
    const client = this.client();
    if (!client || !agent.suggestion) return;
    await this.attempt(() => client.approveSuggestion(agent.suggestion!.id), `${agent.name} will resume with the suggested instruction.`);
  }

  async stop(arg?: unknown) {
    const client = this.client();
    if (!client) return this.signIn();
    const agent = await this.pick(arg, ["paused", "running"], "Which agent do you want to stop?");
    if (!agent) return;
    const sure = await vscode.window.showWarningMessage(`Stop ${agent.name}? ArgusOps will end its process.`, { modal: true }, "Stop agent");
    if (sure !== "Stop agent") return;
    await this.attempt(() => client.stop(agent.id), `${agent.name} was stopped.`);
  }

  async showAgents() {
    await vscode.commands.executeCommand("argusops.agents.focus");
  }

  openDashboard() {
    return vscode.env.openExternal(vscode.Uri.parse(`${this.serverUrl()}/dashboard/guardrails`));
  }

  async signOut() {
    await this.context.secrets.delete(SECRET);
    this.creds = null;
    this.data = null;
    this.previous = null;
    this.extras = { usage: null, notifications: null, unread: 0, at: 0 };
    await this.syncSupervision(false);
    this.render();
    void vscode.window.showInformationMessage("Signed out of ArgusOps.");
  }

  async signIn() {
    const choice = await vscode.window.showQuickPick(
      [
        { label: "$(globe) Sign in with your browser", description: "Recommended", id: "browser" },
        { label: "$(key) Paste an API key", description: "From Local PC Bridge in the dashboard", id: "key" },
      ],
      { placeHolder: "How do you want to sign in to ArgusOps?" }
    );
    if (!choice) return;
    if (choice.id === "key") await this.signInWithKey();
    else await this.signInWithBrowser();
  }

  private async finishSignIn(creds: Credentials, who?: string) {
    await this.saveCredentials(creds);
    this.previous = null;
    await this.refresh();
    void vscode.window.showInformationMessage(who ? `Signed in to ArgusOps as ${who}.` : "Signed in to ArgusOps.");
    await this.syncSupervision(true);
  }

  private async signInWithKey() {
    const key = await vscode.window.showInputBox({
      title: "ArgusOps API key",
      prompt: "Paste a key that starts with argus_live_",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().startsWith("argus_live_") ? undefined : "ArgusOps keys start with argus_live_"),
    });
    if (!key) return;
    const url = this.serverUrl();
    try {
      const me = await new ArgusClient(url, key.trim()).agents();
      await this.finishSignIn({ url, key: key.trim() }, me.user.email);
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 401 ? "That key isn't valid." : "Couldn't reach the ArgusOps server.";
      void vscode.window.showErrorMessage(`ArgusOps: ${msg}`);
    }
  }

  private async signInWithBrowser() {
    const url = this.serverUrl();
    const client = new ArgusClient(url);
    let dc;
    try {
      dc = await client.deviceCode(`VS Code (${vscode.env.appName})`);
    } catch {
      void vscode.window.showErrorMessage(`ArgusOps: couldn't reach ${url}. Is the server running?`);
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(dc.verification_uri_complete));

    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `ArgusOps: approve the code ${dc.user_code} in your browser`, cancellable: true },
      async (_progress, cancel) => {
        let waitMs = Math.max(0.05, dc.interval) * 1000;
        const deadline = Date.now() + dc.expires_in * 1000;
        while (Date.now() < deadline && !cancel.isCancellationRequested) {
          await new Promise((r) => setTimeout(r, waitMs));
          if (cancel.isCancellationRequested) break;
          try {
            return { token: await client.pollToken(dc.device_code) };
          } catch (e) {
            if (!(e instanceof ApiError)) continue;
            if (e.code === "authorization_pending" || e.code === "network") continue;
            if (e.code === "slow_down") waitMs += 5000;
            else return { error: e.code === "access_denied" ? "The request was denied in the browser." : e.code === "expired_token" ? "The code expired. Try signing in again." : e.message };
          }
        }
        return { error: cancel.isCancellationRequested ? "" : "The code expired. Try signing in again." };
      }
    );

    if ("token" in result && result.token) await this.finishSignIn({ url, key: result.token.access_token }, result.token.user.email);
    else if ("error" in result && result.error) void vscode.window.showErrorMessage(`ArgusOps: ${result.error}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const c = new ArgusController(context);
  const reg = (id: string, fn: (...args: unknown[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg("argusops.signIn", () => c.signIn());
  reg("argusops.signOut", () => c.signOut());
  reg("argusops.refresh", () => c.refresh());
  reg("argusops.resumeAgent", (arg) => c.resume(arg));
  reg("argusops.stopAgent", (arg) => c.stop(arg));
  reg("argusops.openDashboard", () => c.openDashboard());
  reg("argusops.showAgents", () => c.showAgents());
  reg("argusops.superviseClaude", () => c.setSupervision(true));
  reg("argusops.stopSupervising", () => c.setSupervision(false));
  context.subscriptions.push({ dispose: () => void c.stopSupervisor() });
  active = c;
  void c.start();
  return c;
}

let active: ArgusController | null = null;
export function deactivate() {
  // put the Claude Code setting back so it never points at a proxy that is gone
  return active?.stopSupervisor();
}
