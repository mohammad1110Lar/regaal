/*
 * اجرای سرور با پروکسی سیستم
 *
 * fetch در Node به‌طور پیش‌فرض از پروکسی رد نمی‌شود. داخل ایران پینترست و i.pinimg.com فقط از راه فیلترشکن باز می‌شوند؛
 * پس اگر HTTPS_PROXY / HTTP_PROXY تنظیم شده باشد، یا در ویندوز «پروکسی سیستم» روشن باشد (مثل v2rayN روی 127.0.0.1:10809)،
 * سرور با NODE_USE_ENV_PROXY=1 و همان پروکسی اجرا می‌شود (localhost از پروکسی رد نمی‌شود). بدون پروکسی، همان server.mjs.
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.mjs");
const env = { ...process.env };

// پروکسی سیستم ویندوز (Internet Settings کاربر)
function windowsProxy() {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], { encoding: "utf8" });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(out)) return null;
    const m = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
    if (!m) return null;
    let v = m[1];
    const per = v.match(/https=([^;]+)/) || v.match(/http=([^;]+)/); // «http=…;https=…» یا فقط «host:port»
    if (per) v = per[1];
    else if (v.includes("=")) return null; // فقط socks؛ fetch پشتیبانی نمی‌کند
    return "http://" + v.replace(/^https?:\/\//, "");
  } catch {
    return null;
  }
}

let proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
if (!proxy && (proxy = windowsProxy())) {
  env.HTTPS_PROXY = env.HTTP_PROXY = proxy;
  env.NO_PROXY = env.NO_PROXY || "localhost,127.0.0.1,::1";
}
if (proxy) {
  env.NODE_USE_ENV_PROXY = env.NODE_USE_ENV_PROXY || "1";
  console.log("پروکسی سیستم برای درخواست‌های بیرونی: " + proxy);
}

const child = spawn(process.execPath, [server, ...process.argv.slice(2)], { stdio: "inherit", env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
