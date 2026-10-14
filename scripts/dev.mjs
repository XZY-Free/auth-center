/**
 * 本地开发双进程编排：API 服务（:3100）+ Web 门户 dev server（:3101，代理 /api）。
 * 与 nexharness 的 dev 脚本同模式（进程退出联动、信号转发）。
 */
import { spawn } from "node:child_process";

const commands = [["dev:server"], ["dev:web"]];
const children = commands.map((args) =>
  spawn("pnpm", args, {
    cwd: process.cwd(),
    env: { ...process.env, APP_ENV: "development" },
    stdio: "inherit",
  }),
);

let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

await Promise.all(
  children.map(
    (child, index) =>
      new Promise((resolve) => {
        child.once("error", (error) => {
          console.error(`[dev] ${commands[index]?.[0] ?? "child"} 启动失败`, error);
          process.exitCode = 1;
          stop();
          resolve();
        });
        child.once("exit", (code, signal) => {
          if (!stopping) {
            console.error(
              `[dev] ${commands[index]?.[0] ?? "child"} 异常退出 (code=${code}, signal=${signal})`,
            );
            process.exitCode = code && code > 0 ? code : 1;
          }
          stop();
          resolve();
        });
      }),
  ),
);
