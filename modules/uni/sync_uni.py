#!/usr/bin/env python3
"""Uni sync: pulls classes and deadlines from Moodle and Sigarra into data/uni.json.

Runs on your own computer (the university sites are not reachable from the cloud).
Standard library only. Passwords are asked at runtime and never written to disk.

    python3 sync_uni.py setup            # one-time: Moodle feed URL, faculty, student number
    python3 sync_uni.py                  # sync everything that is configured
    python3 sync_uni.py --no-sigarra     # skip the Sigarra login (e.g. from a scheduled job)
    python3 sync_uni.py serve            # preview the panel at http://localhost:8765
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import getpass
import http.cookiejar
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python < 3.9
    ZoneInfo = None

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
SCHEDULE_CSV = HERE / "schedule.csv"
DATA_DIR = HERE / "data"
DATA_JSON = DATA_DIR / "uni.json"
DATA_JS = DATA_DIR / "uni.js"

LOCAL_TZ = "Europe/Lisbon"
UA = "personal-dashboard-uni/1.0"

DEFAULT_CONFIG = {
    "moodle_base_url": "https://moodle.up.pt",
    "moodle_ics_url": "",
    "sigarra_faculty": "feup",
    "sigarra_user": "",
    "weeks_ahead": 2,
}


# --------------------------------------------------------------------------- helpers

def tz():
    return ZoneInfo(LOCAL_TZ) if ZoneInfo else dt.timezone.utc


def now():
    return dt.datetime.now(tz())


def iso(d: dt.datetime) -> str:
    if d.tzinfo is None:
        d = d.replace(tzinfo=tz())
    return d.astimezone(tz()).isoformat(timespec="minutes")


def monday_of(d: dt.date) -> dt.date:
    return d - dt.timedelta(days=d.weekday())


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    # Environment variables win, so a scheduled job never needs the file.
    env = {
        "moodle_ics_url": os.environ.get("MOODLE_ICS_URL"),
        "moodle_base_url": os.environ.get("MOODLE_BASE_URL"),
        "sigarra_faculty": os.environ.get("SIGARRA_FACULTY"),
        "sigarra_user": os.environ.get("SIGARRA_USER"),
    }
    cfg.update({k: v for k, v in env.items() if v})
    return cfg


def http_get(url: str, opener=None, timeout=30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with (opener or urllib.request.build_opener()).open(req, timeout=timeout) as r:
        return r.read()


# --------------------------------------------------------------------------- ICS (Moodle calendar export)

def _unfold(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw.startswith((" ", "\t")) and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _unescape(v: str) -> str:
    return (v.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",")
             .replace("\\;", ";").replace("\\\\", "\\"))


def _parse_ics_dt(value: str, params: dict) -> tuple[dt.datetime, bool]:
    """Returns (datetime, all_day)."""
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
        d = dt.datetime.strptime(value[:8], "%Y%m%d").replace(tzinfo=tz())
        return d, True
    utc = value.endswith("Z")
    d = dt.datetime.strptime(value.rstrip("Z")[:15], "%Y%m%dT%H%M%S")
    if utc:
        d = d.replace(tzinfo=dt.timezone.utc)
    elif "TZID" in params and ZoneInfo:
        try:
            d = d.replace(tzinfo=ZoneInfo(params["TZID"]))
        except Exception:
            d = d.replace(tzinfo=tz())
    else:
        d = d.replace(tzinfo=tz())
    return d, False


def parse_ics(text: str) -> list[dict]:
    events, cur = [], None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            cur = {}
            continue
        if line == "END:VEVENT":
            if cur is not None:
                events.append(cur)
            cur = None
            continue
        if cur is None or ":" not in line:
            continue
        head, value = line.split(":", 1)
        name, *pp = head.split(";")
        params = dict(p.split("=", 1) for p in pp if "=" in p)
        name = name.upper()
        if name in ("DTSTART", "DTEND"):
            d, all_day = _parse_ics_dt(value, params)
            cur[name.lower()] = d
            if name == "DTSTART":
                cur["all_day"] = all_day
        elif name in ("SUMMARY", "DESCRIPTION", "CATEGORIES", "UID", "LOCATION", "URL"):
            cur[name.lower()] = _unescape(value)
    return events


# Moodle titles end with these (English and Portuguese site languages).
DUE_PATTERNS = re.compile(
    r"(is due|closes|due date|deadline|termina|fecha|data limite|prazo|encerra|entrega)",
    re.IGNORECASE,
)


def moodle_events_to_items(events: list[dict]) -> tuple[list[dict], list[dict]]:
    """Splits Moodle calendar events into (deadlines, other events)."""
    deadlines, others = [], []
    for e in events:
        if "dtstart" not in e:
            continue
        title = e.get("summary", "(untitled)").strip()
        item = {
            "id": "moodle:" + e.get("uid", title + iso(e["dtstart"])),
            "title": title,
            "course": (e.get("categories") or "").strip() or None,
            "source": "moodle",
        }
        if DUE_PATTERNS.search(title):
            item.update(kind="deadline", due=iso(e["dtstart"]))
            deadlines.append(item)
        else:
            item.update(kind="event", start=iso(e["dtstart"]),
                        end=iso(e.get("dtend") or e["dtstart"]), all_day=e.get("all_day", False))
            others.append(item)
    return deadlines, others


def sync_moodle_ics(cfg: dict) -> dict:
    url = cfg.get("moodle_ics_url")
    if not url:
        raise RuntimeError("no Moodle calendar URL configured (run: python3 sync_uni.py setup)")
    text = http_get(url).decode("utf-8", errors="replace")
    if "BEGIN:VCALENDAR" not in text:
        raise RuntimeError("Moodle did not return a calendar; the export URL may have expired")
    deadlines, events = moodle_events_to_items(parse_ics(text))
    return {"deadlines": deadlines, "events": events}


def sync_moodle_ws(cfg: dict, token: str) -> dict:
    """Optional: Moodle mobile web-service token (Preferences > Security keys).
    Gives upcoming action events with course names and links."""
    base = cfg["moodle_base_url"].rstrip("/") + "/webservice/rest/server.php"
    q = urllib.parse.urlencode({
        "wstoken": token, "moodlewsrestformat": "json",
        "wsfunction": "core_calendar_get_action_events_by_timesort",
        "timesortfrom": int(now().timestamp()) - 86400, "limitnum": 50,
    })
    data = json.loads(http_get(f"{base}?{q}"))
    if isinstance(data, dict) and data.get("exception"):
        raise RuntimeError(f"Moodle web service: {data.get('message')}")
    out = []
    for e in data.get("events", []):
        course = e.get("course") or {}
        out.append({
            "id": f"moodle:{e.get('id')}",
            "title": e.get("activityname") or e.get("name"),
            "course": course.get("shortname") or course.get("fullname"),
            "due": iso(dt.datetime.fromtimestamp(e["timesort"], tz())),
            "url": e.get("url"),
            "kind": "deadline",
            "source": "moodle",
        })
    return {"deadlines": out}


# --------------------------------------------------------------------------- Sigarra

class Sigarra:
    """Talks to Sigarra's mobile JSON endpoints (the ones the U.Porto 'uni' app uses).
    These are unofficial and may change; failures fall back to schedule.csv."""

    def __init__(self, faculty: str):
        self.base = f"https://sigarra.up.pt/{faculty.strip().lower()}/pt/"
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.code = None

    def _get_json(self, path: str, **params):
        url = self.base + path + ("?" + urllib.parse.urlencode(params) if params else "")
        raw = http_get(url, self.opener).decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            raise RuntimeError(f"Sigarra returned non-JSON for {path} (session expired or endpoint changed)")

    def login(self, user: str, password: str):
        body = urllib.parse.urlencode({"pv_login": user, "pv_password": password}).encode()
        req = urllib.request.Request(self.base + "mob_val_geral.autentica", data=body,
                                     headers={"User-Agent": UA})
        with self.opener.open(req, timeout=30) as r:
            res = json.loads(r.read().decode("utf-8", errors="replace"))
        if not res.get("authenticated"):
            raise RuntimeError("Sigarra login failed (check username/password)")
        self.code = str(res.get("codigo") or re.sub(r"\D", "", user))

    def week(self, monday: dt.date) -> list[dict]:
        res = self._get_json(
            "mob_hor_geral.estudante", pv_codigo=self.code,
            pv_semana_ini=monday.strftime("%Y%m%d"),
            pv_semana_fim=(monday + dt.timedelta(days=6)).strftime("%Y%m%d"))
        return [sigarra_lecture_to_class(l, monday) for l in res.get("horario", [])]

    def courses(self) -> list[dict]:
        res = self._get_json("mob_fest_geral.ucurr_inscricoes_corrente", pv_codigo=self.code)
        out = []
        for c in res.get("inscricoes", []):
            out.append({
                "code": c.get("ucurr_codigo") or c.get("ucurr_sigla"),
                "acronym": c.get("ucurr_sigla"),
                "name": c.get("ucurr_nome"),
                "source": "sigarra",
            })
        return out


def _seconds(v) -> int:
    """Sigarra gives start time as seconds since midnight; accept 'HH:MM' too."""
    if isinstance(v, str) and ":" in v:
        h, m = v.split(":")[:2]
        return int(h) * 3600 + int(m) * 60
    return int(float(v))


def sigarra_lecture_to_class(l: dict, monday: dt.date) -> dict:
    # 'dia' uses the Portuguese convention: 2 = Monday (segunda-feira) ... 7 = Saturday, 1 = Sunday.
    dia = int(l["dia"])
    day = monday + dt.timedelta(days=(dia - 2) % 7)
    start = dt.datetime.combine(day, dt.time(), tz()) + dt.timedelta(seconds=_seconds(l["hora_inicio"]))
    hours = float(str(l.get("aula_duracao", 1)).replace(",", "."))
    end = start + dt.timedelta(hours=hours)
    return {
        "id": f"sigarra:{l.get('aula_id') or l.get('ocorrencia_id') or ''}:{iso(start)}",
        "course": l.get("ucurr_sigla"),
        "type": l.get("tipo"),
        "room": l.get("sala_sigla"),
        "teacher": l.get("doc_sigla"),
        "group": l.get("turma_sigla"),
        "start": iso(start),
        "end": iso(end),
        "source": "sigarra",
    }


def sync_sigarra(cfg: dict, password: str) -> dict:
    s = Sigarra(cfg["sigarra_faculty"])
    s.login(cfg["sigarra_user"], password)
    first = monday_of(now().date())
    classes = []
    for w in range(int(cfg.get("weeks_ahead", 2))):
        classes += s.week(first + dt.timedelta(weeks=w))
    out = {"classes": classes}
    try:
        out["courses"] = s.courses()
    except Exception as e:  # courses are nice to have; the schedule is what matters
        out["courses_error"] = str(e)
    return out


# --------------------------------------------------------------------------- manual fallback

DAY_NAMES = {"mon": 0, "seg": 0, "tue": 1, "ter": 1, "wed": 2, "qua": 2,
             "thu": 3, "qui": 3, "fri": 4, "sex": 4, "sat": 5, "sab": 5, "sáb": 5, "sun": 6, "dom": 6}


def manual_classes(path: Path, weeks: int) -> list[dict]:
    """schedule.csv columns: day,start,end,course,type,room,teacher (day = Mon..Sun or 1..7, Mon=1)."""
    out = []
    first = monday_of(now().date())
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            d = (row.get("day") or "").strip().lower()
            wd = DAY_NAMES.get(d[:3]) if not d.isdigit() else int(d) - 1
            if wd is None:
                continue
            for w in range(weeks):
                day = first + dt.timedelta(weeks=w, days=wd)
                sh, sm = map(int, row["start"].split(":"))
                eh, em = map(int, row["end"].split(":"))
                start = dt.datetime.combine(day, dt.time(sh, sm), tz())
                end = dt.datetime.combine(day, dt.time(eh, em), tz())
                out.append({
                    "id": f"manual:{row['course']}:{iso(start)}",
                    "course": row["course"], "type": row.get("type") or None,
                    "room": row.get("room") or None, "teacher": row.get("teacher") or None,
                    "start": iso(start), "end": iso(end), "source": "manual",
                })
    return out


# --------------------------------------------------------------------------- output

def load_previous() -> dict:
    if DATA_JSON.exists():
        try:
            return json.loads(DATA_JSON.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {}


def build(prev: dict, results: dict) -> dict:
    """Merge per-source results; a source that failed keeps its last good data."""
    sources = dict(prev.get("sources", {}))
    by_source = {k: dict(v.get("data", {})) for k, v in sources.items()}
    for name, (ok, payload) in results.items():
        if ok:
            by_source[name] = payload
            sources[name] = {"ok": True, "synced_at": iso(now()), "error": None}
        else:
            last = sources.get(name, {})
            sources[name] = {"ok": False, "synced_at": last.get("synced_at"), "error": payload}
    for name in sources:
        sources[name]["data"] = by_source.get(name, {})

    def collect(key):
        items = [i for v in by_source.values() for i in v.get(key, [])]
        seen, uniq = set(), []
        for i in items:
            if i["id"] not in seen:
                seen.add(i["id"])
                uniq.append(i)
        return uniq

    classes = sorted(collect("classes"), key=lambda c: c["start"])
    deadlines = sorted(collect("deadlines"), key=lambda d: d["due"])
    events = sorted(collect("events"), key=lambda e: e["start"])
    return {
        "schema": "uni/1",
        "generated_at": iso(now()),
        "classes": classes,
        "deadlines": deadlines,
        "events": events,
        "courses": collect("courses"),
        "sources": sources,
    }


def write(data: dict):
    DATA_DIR.mkdir(exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2)
    DATA_JSON.write_text(text, encoding="utf-8")
    # uni.js lets the panel load data from file:// without a server.
    DATA_JS.write_text(f"window.UNI_DATA = {text};\n", encoding="utf-8")


# --------------------------------------------------------------------------- CLI

def cmd_setup():
    cfg = load_config()
    print("Uni setup (nothing here is a password; passwords are only asked when syncing).\n")
    print("Moodle: Calendar > Import or export calendars > Export calendar >")
    print("        'All courses' + 'Recent and next 60 days' > Get calendar URL, then paste it.")
    cfg["moodle_ics_url"] = input(f"Moodle calendar URL [{'keep current' if cfg['moodle_ics_url'] else 'skip'}]: ").strip() or cfg["moodle_ics_url"]
    cfg["moodle_base_url"] = input(f"Moodle site [{cfg['moodle_base_url']}]: ").strip() or cfg["moodle_base_url"]
    cfg["sigarra_faculty"] = input(f"Sigarra faculty code, e.g. feup, fcup, fep [{cfg['sigarra_faculty']}]: ").strip() or cfg["sigarra_faculty"]
    cfg["sigarra_user"] = input(f"Sigarra username, e.g. up202301234 [{cfg['sigarra_user'] or 'skip'}]: ").strip() or cfg["sigarra_user"]
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    try:
        os.chmod(CONFIG_PATH, 0o600)  # the Moodle URL contains a personal token
    except OSError:
        pass
    print(f"\nSaved {CONFIG_PATH.name}. Now run: python3 sync_uni.py")


def cmd_sync(args):
    cfg = load_config()
    results: dict[str, tuple[bool, object]] = {}

    def attempt(name, fn):
        try:
            results[name] = (True, fn())
            print(f"  {name}: ok")
        except Exception as e:
            results[name] = (False, str(e))
            print(f"  {name}: FAILED - {e}", file=sys.stderr)

    print("Syncing uni data...")
    if not args.no_moodle and cfg.get("moodle_ics_url"):
        attempt("moodle", lambda: sync_moodle_ics(cfg))
    token = os.environ.get("MOODLE_TOKEN")
    if not args.no_moodle and (token or args.moodle_token):
        token = token or getpass.getpass("Moodle security key (not saved): ")
        attempt("moodle_ws", lambda: sync_moodle_ws(cfg, token))
    if not args.no_sigarra and cfg.get("sigarra_user"):
        pw = os.environ.get("SIGARRA_PASSWORD") or getpass.getpass(
            f"Sigarra password for {cfg['sigarra_user']} (not saved): ")
        attempt("sigarra", lambda: sync_sigarra(cfg, pw))
        del pw
    if SCHEDULE_CSV.exists():
        attempt("manual", lambda: {"classes": manual_classes(SCHEDULE_CSV, int(cfg.get("weeks_ahead", 2)))})

    if not results:
        print("Nothing configured yet. Run: python3 sync_uni.py setup", file=sys.stderr)
        return 1
    data = build(load_previous(), results)
    write(data)
    print(f"Wrote {len(data['classes'])} classes, {len(data['deadlines'])} deadlines, "
          f"{len(data['events'])} events to {DATA_JSON.relative_to(HERE)}")
    return 0 if all(ok for ok, _ in results.values()) else 2


def cmd_serve(port: int):
    import functools
    import http.server
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(HERE))
    print(f"Uni panel preview at http://localhost:{port}/index.html  (Ctrl+C to stop)")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", nargs="?", default="sync", choices=["sync", "setup", "serve"])
    p.add_argument("--no-sigarra", action="store_true", help="skip Sigarra (no password prompt)")
    p.add_argument("--no-moodle", action="store_true")
    p.add_argument("--moodle-token", action="store_true",
                   help="also ask for a Moodle security key for richer deadline info")
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args(argv)
    if args.command == "setup":
        return cmd_setup()
    if args.command == "serve":
        return cmd_serve(args.port)
    return cmd_sync(args)


if __name__ == "__main__":
    sys.exit(main() or 0)
