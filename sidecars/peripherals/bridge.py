"""Headless Halo Battery for the island: peripheral battery levels as JSON lines.

Runs Halo Battery's own providers (the `HaloBattery` submodule, unmodified) without
its tray, and prints one JSON object per line on stdout, in the same shape as Halo
Battery's `status.json` ("Status file for other apps"):

    {"app": "Halo Battery", "version": "...", "running": true, "updated_unix": 0,
     "devices": [{"key", "name", "level", "charging", "charging_known", "online",
                  "kind", "approx", "low_alert_at", "seconds_left", "text"}]}

stdin takes commands, one per line:
    poll    poll now (the island opened the tab)
EOF on stdin means the island is gone: the bridge exits, so it never outlives it.

Settings, log and battery history live in %APPDATA%\\HaloBattery; the island points
APPDATA at its own data folder, so this never touches a real Halo Battery install.
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HALO_DIR = os.path.join(HERE, "HaloBattery")

# How often devices are polled when nothing asks for it (Halo Battery's default is
# its "interval" setting, 60 s). A `poll` command polls at once.
MIN_GAP_S = 5.0


def load_halo():
    """Halo Battery's main module. The frozen build ships it as `halo_app`
    (a copy of halo_battery.pyw, see build.ps1); from source it's the submodule."""
    try:
        import halo_app  # type: ignore[import-not-found]
        return halo_app
    except ImportError:
        pass
    sys.path.insert(0, HALO_DIR)
    path = os.path.join(HALO_DIR, "halo_battery.pyw")
    loader = importlib.machinery.SourceFileLoader("halo_app", path)
    spec = importlib.util.spec_from_loader("halo_app", loader)
    module = importlib.util.module_from_spec(spec)
    sys.modules["halo_app"] = module
    loader.exec_module(module)
    return module


class Bridge:
    def __init__(self, halo):
        self.halo = halo
        app = halo.App.__new__(halo.App)  # no tray, as Halo Battery's own --probe does
        app.cfg = halo.load_config()
        app.history = halo.history.History(halo.HISTORY_PATH)
        app.history.load()
        app.providers = halo.make_providers()
        app.bt = halo.BluetoothProvider()
        self.app = app
        self.out_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.wake = threading.Event()
        self.hid_results = []
        self.bt_cache = []
        self.bt_dup_logged = set()
        self.last_poll = 0.0

    # ---------------------------------------------------------------- polling
    def poll_hid(self):
        halo, app = self.halo, self.app
        disabled = app.disabled_providers()
        results = []
        for p in app.providers:
            if p.name in disabled:
                continue
            if isinstance(p, halo.PlayStationProvider):
                p.switch_bluetooth = bool(app.cfg.get("playstation_full_mode", False))
            try:
                results += p.poll()
            except Exception:
                halo.log.exception("provider %s", p.name)
        return results

    def merged(self):
        """Halo Battery's `merge_bluetooth`: one entry per device, not per transport."""
        with self.state_lock:
            results, bt = list(self.hid_results), list(self.bt_cache)
        if self.app.cfg["bluetooth"]:
            results = self.halo.dedupe_controllers(results, bt) + bt
            results = self.halo.drop_bluetooth_duplicates(results, self.bt_dup_logged)
        return results

    def emit(self):
        results = self.merged()
        now = time.time()
        hidden = self.app._settings_map("hidden")
        for st in results:
            if st.key not in hidden:
                self.app.history.record(st.key, st.level, st.charging,
                                        st.online and st.charging_known, now,
                                        coarse=bool(st.approx))
        self.app.history.save()
        data = self.app.status_data(results)
        with self.out_lock:
            sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
            sys.stdout.flush()

    # ---------------------------------------------------------------- threads
    def bluetooth_loop(self):
        """Halo Battery's `bt_loop`: a long-lived watcher on Windows, else a poll a minute."""
        halo, app = self.halo, self.app
        if not app.cfg["bluetooth"]:
            return

        def on_update(res):
            with self.state_lock:
                self.bt_cache = res
            self.emit()

        if sys.platform == "win32":
            watcher = halo.BluetoothWatcher(app.bt, on_update).start()
            while not watcher.failed:
                time.sleep(2)
            halo.log.info("bluetooth watcher failed: polling once a minute")
        while True:
            try:
                on_update(app.bt.poll())
            except Exception:
                halo.log.exception("bluetooth")
            time.sleep(60)

    def stdin_loop(self):
        for line in sys.stdin:
            if line.strip() == "poll":
                self.wake.set()
        os._exit(0)  # the island closed our stdin: it quit or restarted

    def run(self):
        threading.Thread(target=self.stdin_loop, daemon=True).start()
        threading.Thread(target=self.bluetooth_loop, daemon=True).start()
        interval = max(float(self.app.cfg.get("interval", 60)), MIN_GAP_S)
        while True:
            results = self.poll_hid()
            with self.state_lock:
                self.hid_results = results
            self.last_poll = time.monotonic()
            self.emit()
            self.wake.wait(interval)
            self.wake.clear()
            # Several `poll`s in a row (tab opened and closed quickly): one poll.
            gap = MIN_GAP_S - (time.monotonic() - self.last_poll)
            if gap > 0:
                time.sleep(gap)


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    Bridge(load_halo()).run()


if __name__ == "__main__":
    main()
