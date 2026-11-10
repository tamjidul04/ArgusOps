/** A scriptable stand-in for the parts of the `vscode` API the extension uses (tests only). */

type Level = "info" | "warn" | "error";
export interface Shown {
  level: Level;
  text: string;
  items: string[];
  modal: boolean;
}

export const mock = {
  shown: [] as Shown[],
  /** answers show*Message: return the button label to "click", or undefined to dismiss */
  respond: ((_text: string, _items: string[]) => undefined) as (text: string, items: string[]) => string | undefined,
  inputs: [] as Array<string | undefined>,
  inputOptions: [] as Array<Record<string, unknown>>,
  quickPick: ((items: unknown[]) => items[0]) as (items: unknown[]) => unknown,
  quickPickItems: [] as unknown[][],
  opened: [] as string[],
  contexts: {} as Record<string, unknown>,
  executed: [] as string[],
  config: {} as Record<string, unknown>,
  statusBars: [] as Array<Record<string, unknown>>,
  treeViews: [] as Array<Record<string, unknown>>,
  webviewProviders: new Map<string, { resolveWebviewView(view: unknown): void }>(),
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  progressTitles: [] as string[],
  cancelProgress: false,
};

export function resetMock() {
  mock.shown = [];
  mock.respond = () => undefined;
  mock.inputs = [];
  mock.inputOptions = [];
  mock.quickPick = (items) => items[0];
  mock.quickPickItems = [];
  mock.opened = [];
  mock.contexts = {};
  mock.executed = [];
  mock.config = {};
  mock.statusBars = [];
  mock.treeViews = [];
  mock.webviewProviders = new Map();
  mock.commands = new Map();
  mock.progressTitles = [];
  mock.cancelProgress = false;
}

export class EventEmitter<T> {
  private listeners: Array<(v: T) => void> = [];
  event = (l: (v: T) => void) => {
    this.listeners.push(l);
    return { dispose: () => (this.listeners = this.listeners.filter((x) => x !== l)) };
  };
  fire(v: T) {
    for (const l of this.listeners) l(v);
  }
  dispose() {
    this.listeners = [];
  }
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;
export class TreeItem {
  description?: string;
  iconPath?: unknown;
  tooltip?: unknown;
  contextValue?: string;
  command?: unknown;
  constructor(
    public label: string,
    public collapsibleState: number = 0
  ) {}
}
export class ThemeIcon {
  constructor(
    public id: string,
    public color?: unknown
  ) {}
}
export class ThemeColor {
  constructor(public id: string) {}
}
export class MarkdownString {
  value = "";
  appendText(t: string) {
    this.value += t;
    return this;
  }
  appendMarkdown(t: string) {
    this.value += t;
    return this;
  }
}
export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const ProgressLocation = { Notification: 15 } as const;
export const Uri = { parse: (s: string) => ({ toString: () => s }) };

function show(level: Level) {
  return (text: string, ...rest: unknown[]) => {
    const modal = typeof rest[0] === "object" && rest[0] !== null && (rest[0] as { modal?: boolean }).modal === true;
    const items = rest.filter((r): r is string => typeof r === "string");
    mock.shown.push({ level, text, items, modal });
    return Promise.resolve(mock.respond(text, items));
  };
}

const disposable = { dispose() {} };

export const window = {
  createStatusBarItem: () => {
    const item: Record<string, unknown> = { text: "", tooltip: "", command: undefined, backgroundColor: undefined, show() {}, hide() {}, dispose() {} };
    mock.statusBars.push(item);
    return item;
  },
  createTreeView: (_id: string, _opts: unknown) => {
    const v: Record<string, unknown> = { description: undefined, dispose() {} };
    mock.treeViews.push(v);
    return v;
  },
  registerWebviewViewProvider: (id: string, provider: { resolveWebviewView(view: unknown): void }, _opts?: unknown) => {
    mock.webviewProviders.set(id, provider);
    return { dispose: () => mock.webviewProviders.delete(id) };
  },
  showInformationMessage: show("info"),
  showWarningMessage: show("warn"),
  showErrorMessage: show("error"),
  showInputBox: (opts: Record<string, unknown>) => {
    mock.inputOptions.push(opts);
    return Promise.resolve(mock.inputs.shift());
  },
  showQuickPick: (items: unknown[]) => {
    mock.quickPickItems.push(items);
    return Promise.resolve(mock.quickPick(items));
  },
  withProgress: (opts: { title?: string }, task: (p: unknown, token: unknown) => Promise<unknown>) => {
    mock.progressTitles.push(opts.title ?? "");
    const token = { get isCancellationRequested() { return mock.cancelProgress; } };
    return task({ report() {} }, token);
  },
  onDidChangeWindowState: () => disposable,
};

export const commands = {
  registerCommand: (id: string, fn: (...args: unknown[]) => unknown) => {
    mock.commands.set(id, fn);
    return { dispose: () => mock.commands.delete(id) };
  },
  executeCommand: (id: string, ...args: unknown[]) => {
    mock.executed.push(id);
    if (id === "setContext") mock.contexts[String(args[0])] = args[1];
    const fn = mock.commands.get(id);
    return Promise.resolve(fn ? fn(...args) : undefined);
  },
};

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, def?: T): T => (key in mock.config ? (mock.config[key] as T) : (def as T)),
  }),
  onDidChangeConfiguration: () => disposable,
};

export const env = {
  appName: "Visual Studio Code",
  openExternal: (uri: { toString(): string }) => {
    mock.opened.push(uri.toString());
    return Promise.resolve(true);
  },
};
