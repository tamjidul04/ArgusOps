/* eslint-disable @typescript-eslint/no-require-imports -- runs inside the VS Code extension host as plain CommonJS */
// Runs INSIDE a real VS Code: checks the packaged extension loads, activates and registers what it promises.
const vscode = require("vscode");
const fs = require("node:fs");

exports.run = async function run() {
  const results = [];
  const check = (name, ok, extra = "") => results.push({ name, ok: Boolean(ok), extra: String(extra) });

  try {
    const ext = vscode.extensions.getExtension("tamjidul04.argusops");
    check("the extension is found by VS Code", !!ext);
    if (ext) {
      await ext.activate();
      check("it activates without errors", ext.isActive);
    }

    const commands = await vscode.commands.getCommands(true);
    for (const id of ["signIn", "signOut", "refresh", "resumeAgent", "stopAgent", "openDashboard", "showAgents"]) {
      check(`command argusops.${id} is registered`, commands.includes(`argusops.${id}`));
    }
    check("the Agents view is contributed (its focus command exists)", commands.includes("argusops.agents.focus"));
    check("the Overview dashboard view is contributed (its focus command exists)", commands.includes("argusops.overview.focus"));

    const cfg = vscode.workspace.getConfiguration("argusops");
    check("setting serverUrl defaults to the local server", cfg.get("serverUrl") === "http://localhost:3000", cfg.get("serverUrl"));
    check("setting pollIntervalSeconds defaults to 4", cfg.get("pollIntervalSeconds") === 4);
    check("setting notifications defaults to on", cfg.get("notifications") === true);

    let threw = "";
    try {
      await vscode.commands.executeCommand("argusops.refresh"); // signed out: must be a quiet no-op
      await vscode.commands.executeCommand("argusops.agents.focus");
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    check("refreshing and focusing the view while signed out works", threw === "", threw);

    const contributed = ext && ext.packageJSON && ext.packageJSON.contributes;
    check("the activity bar container and view are declared", !!(contributed && contributed.viewsContainers && contributed.views));
    const views = (contributed && contributed.views && contributed.views.argusops) || [];
    const overview = views.find((v) => v.id === "argusops.overview");
    check("the Overview is a webview shown only when signed in", !!overview && overview.type === "webview" && overview.when === "argusops.signedIn", JSON.stringify(overview));
    check("the Overview sits above the Agents list", views.findIndex((v) => v.id === "argusops.overview") === 0 && views.findIndex((v) => v.id === "argusops.agents") === 1);
  } catch (e) {
    check("the suite itself ran", false, e && e.stack ? e.stack : e);
  }

  if (process.env.ARGUS_VSCODE_RESULT) fs.writeFileSync(process.env.ARGUS_VSCODE_RESULT, JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) throw new Error("VS Code extension checks failed");
};
