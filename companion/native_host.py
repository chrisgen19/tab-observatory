"""Chrome native messaging host. Reads only the launching Chrome process tree."""
import json
import os
import struct
import sys
import time

import psutil

MAX_MESSAGE = 65536
HOST_NAME = "com.tab_observatory.monitor"
# USS is the expensive reading; reuse it for this many seconds per process.
USS_INTERVAL = 15


def read_exact(stream, count):
    data = bytearray()
    while len(data) < count:
        part = stream.read(count - len(data))
        if not part:
            if not data:
                return None
            raise ValueError("Truncated native message")
        data.extend(part)
    return bytes(data)


def read_message(stream):
    header = read_exact(stream, 4)
    if header is None:
        return None
    length = struct.unpack("=I", header)[0]
    if not 0 < length <= MAX_MESSAGE:
        raise ValueError("Invalid native message length")
    body = read_exact(stream, length)
    if body is None:
        raise ValueError("Truncated native message")
    message = json.loads(body)
    if not isinstance(message, dict):
        raise ValueError("Expected a JSON object")
    return message


def write_message(stream, message):
    data = json.dumps(message, separators=(",", ":")).encode("utf-8")
    if len(data) > 1024 * 1024:
        data = b'{"error":"Process sample exceeds native messaging limit"}'
    stream.write(struct.pack("=I", len(data)))
    stream.write(data)
    stream.flush()


def is_chrome(process):
    name = process.name().lower()
    return name in {"chrome", "chrome.exe", "chromium", "chromium-browser", "google chrome"} or name.startswith("google chrome helper")


def find_browser():
    for parent in psutil.Process().parents():
        try:
            if is_chrome(parent) and not any(arg.startswith("--type=") for arg in parent.cmdline()):
                return parent
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    raise RuntimeError("Cannot identify the launching Chrome browser. Launch this companion through the extension.")


class Sampler:
    def __init__(self, browser):
        self.browser = browser
        self.previous = {}
        self.last_sample = None
        self.cached = None
        self.uss = {}

    def read_uss(self, process, key, now):
        cached = self.uss.get(key)
        if cached and now - cached[1] < USS_INTERVAL:
            return cached[0]
        try:
            value = getattr(process.memory_full_info(), "uss", None)
        except (psutil.AccessDenied, psutil.NoSuchProcess, NotImplementedError):
            value = None
        self.uss[key] = (value, now)
        return value

    def snapshot(self):
        now = time.monotonic()
        # Bound expensive USS collection, even if more than one UI requests samples.
        if self.cached and now - self.last_sample < 2:
            return self.cached
        if not self.browser.is_running():
            raise RuntimeError("Launching browser has exited")
        processes, warnings, previous, uss = [], [], {}, {}
        for process in [self.browser, *self.browser.children(recursive=True)]:
            try:
                if not is_chrome(process):
                    continue
                with process.oneshot():
                    pid = process.pid
                    created = process.create_time()
                    memory = process.memory_info()
                    times = process.cpu_times()
                    cpu_time = times.user + times.system
                    command = process.cmdline()
                    kind = next((arg.split("=", 1)[1] for arg in command if arg.startswith("--type=")), "browser")
                    key = (pid, created)
                    old = self.previous.get(key)
                    cpu = max(0, (cpu_time - old[0]) / (now - old[1]) * 100) if old else None
                    previous[key] = (cpu_time, now)
                private = self.read_uss(process, key, now)
                uss[key] = self.uss[key]
                processes.append({
                    "pid": pid, "createdAt": created, "kind": kind,
                    "rssBytes": memory.rss, "privateBytes": private,
                    "cpuPercent": round(cpu, 2) if cpu is not None else None,
                })
            except (psutil.NoSuchProcess, psutil.ZombieProcess):
                continue
            except psutil.AccessDenied:
                warnings.append(f"Process {process.pid} could not be read; totals are partial")
        if any(p["privateBytes"] is None for p in processes):
            warnings.append("Private resident memory is unavailable for some processes")
        self.previous = previous
        self.uss = uss  # drops entries for processes that have gone
        self.last_sample = now
        self.cached = {
            "type": "snapshot", "at": int(time.time() * 1000), "platform": sys.platform,
            "browserPid": self.browser.pid, "processes": processes, "warnings": warnings,
        }
        return self.cached


def serve(input_stream, output_stream, sampler):
    while True:
        try:
            message = read_message(input_stream)
            if message is None:
                return
        except (ValueError, UnicodeError) as error:
            write_message(output_stream, {"error": str(error)})
            return
        if message.get("command") != "snapshot":
            write_message(output_stream, {"error": "Unsupported command"})
            continue
        try:
            write_message(output_stream, sampler.snapshot())
        except (RuntimeError, psutil.Error) as error:
            write_message(output_stream, {"error": str(error)})


def main():
    if sys.platform == "win32":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    try:
        sampler = Sampler(find_browser())
    except (RuntimeError, psutil.Error) as error:
        write_message(sys.stdout.buffer, {"error": str(error)})
        return
    serve(sys.stdin.buffer, sys.stdout.buffer, sampler)


if __name__ == "__main__":
    main()
