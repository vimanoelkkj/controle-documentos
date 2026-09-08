import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const CHECK_ONLY = process.argv.includes("--check-only");

function cancel(message, detail = "") {
  console.error(`\n${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    cancel(`Não foi possível executar ${command}.`, result.error.message);
  }

  return result;
}

function gitOutput(args) {
  const result = run("git", args, { capture: true });
  return {
    status: result.status,
    output: String(result.stdout || "").trimEnd(),
  };
}

function assertCleanTree() {
  const status = gitOutput(["status", "--porcelain", "--untracked-files=all"]);
  if (status.status !== 0) {
    cancel("Deploy cancelado: não foi possível verificar o working tree.");
  }

  if (status.output) {
    cancel(
      "Deploy cancelado: existem alterações locais não commitadas.",
      status.output,
    );
  }
}

const branch = gitOutput(["symbolic-ref", "--quiet", "--short", "HEAD"]);
if (branch.status !== 0 || !branch.output) {
  cancel("Deploy cancelado: o Git está em detached HEAD.");
}
if (branch.output !== "main") {
  cancel(
    "Deploy cancelado: você não está na branch main.",
    `Branch atual: ${branch.output}`,
  );
}

assertCleanTree();

console.log("Branch main confirmada. Executando testes...");
const tests = run("npm", ["test"]);
if (tests.status !== 0) cancel("Deploy cancelado: os testes falharam.");

console.log("Executando lint...");
const lint = run("npm", ["run", "lint"]);
if (lint.status !== 0) cancel("Deploy cancelado: o lint falhou.");

console.log("Gerando build de produção...");
const build = run("npm", ["run", "build"]);
if (build.status !== 0) cancel("Deploy cancelado: o build falhou.");

// Garante que testes/build não modificaram arquivos versionados antes da publicação.
assertCleanTree();

if (CHECK_ONLY) {
  console.log(
    "Validação de produção concluída. Nenhum deploy foi executado (--check-only).",
  );
  process.exit(0);
}

const wranglerName = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
const wrangler = path.join(process.cwd(), "node_modules", ".bin", wranglerName);
if (!existsSync(wrangler)) {
  cancel(
    "Deploy cancelado: Wrangler local não encontrado. Execute npm install.",
  );
}

console.log("Testes, lint e build aprovados. Publicando produção...");
const deploy = run(wrangler, ["deploy"]);
if (deploy.status !== 0) cancel("Deploy de produção falhou.");

console.log("Deploy de produção concluído com sucesso.");
