import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sync_uni as u

ICS = """BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:101@moodle.up.pt\r
SUMMARY:Projeto 1 is due\r
DESCRIPTION:Submit the report\\, PDF only\r
CATEGORIES:LEIC-ES\r
DTSTART:20261010T225900Z\r
DTEND:20261010T225900Z\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:102@moodle.up.pt\r
SUMMARY:Mini-teste 2 closes\r
CATEGORIES:LEIC-AM\r
DTSTART;TZID=Europe/Lisbon:20261014T180000\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:103@moodle.up.pt\r
SUMMARY:Sessão de esclarecimento sobre o projeto com uma linha muito compr\r
 ida que foi dobrada\r
CATEGORIES:LEIC-ES\r
DTSTART;VALUE=DATE:20261012\r
END:VEVENT\r
END:VCALENDAR\r
"""


class TestMoodle(unittest.TestCase):
    def test_parse_and_split(self):
        events = u.parse_ics(ICS)
        self.assertEqual(len(events), 3)
        self.assertEqual(events[0]["description"], "Submit the report, PDF only")
        self.assertTrue(events[2]["summary"].endswith("comprida que foi dobrada"))
        deadlines, others = u.moodle_events_to_items(events)
        self.assertEqual([d["title"] for d in deadlines], ["Projeto 1 is due", "Mini-teste 2 closes"])
        self.assertEqual(deadlines[0]["due"], "2026-10-10T23:59+01:00")  # UTC -> Lisbon (WEST)
        self.assertEqual(deadlines[1]["due"], "2026-10-14T18:00+01:00")
        self.assertEqual(deadlines[0]["course"], "LEIC-ES")
        self.assertEqual(len(others), 1)
        self.assertTrue(others[0]["all_day"])


class TestSigarra(unittest.TestCase):
    def test_lecture(self):
        monday = dt.date(2026, 10, 5)
        c = u.sigarra_lecture_to_class({
            "dia": 3, "hora_inicio": 30600, "aula_duracao": "1,5", "ucurr_sigla": "ES",
            "tipo": "TP", "sala_sigla": "B208", "doc_sigla": "ABC", "turma_sigla": "3LEIC05",
            "aula_id": 77}, monday)
        self.assertEqual(c["start"], "2026-10-06T08:30+01:00")
        self.assertEqual(c["end"], "2026-10-06T10:00+01:00")
        self.assertEqual(c["room"], "B208")

    def test_sunday_and_hhmm(self):
        c = u.sigarra_lecture_to_class({"dia": 1, "hora_inicio": "14:00", "aula_duracao": 2}, dt.date(2026, 10, 5))
        self.assertTrue(c["start"].startswith("2026-10-11T14:00"))


class TestMerge(unittest.TestCase):
    def test_failed_source_keeps_last_good(self):
        first = u.build({}, {"sigarra": (True, {"classes": [{"id": "a", "start": "2026-10-06T08:30+01:00"}]})})
        second = u.build(first, {"sigarra": (False, "login failed")})
        self.assertEqual(len(second["classes"]), 1)
        self.assertFalse(second["sources"]["sigarra"]["ok"])
        self.assertEqual(second["sources"]["sigarra"]["error"], "login failed")


class TestManual(unittest.TestCase):
    def test_csv(self):
        p = Path(__file__).parent / "_tmp_schedule.csv"
        p.write_text("day,start,end,course,type,room,teacher\nTue,08:30,10:00,ES,TP,B208,ABC\n3,14:00,16:00,AM,T,B001,\n")
        try:
            out = u.manual_classes(p, 2)
        finally:
            p.unlink()
        self.assertEqual(len(out), 4)
        self.assertEqual(dt.datetime.fromisoformat(out[0]["start"]).weekday(), 1)
        self.assertEqual(dt.datetime.fromisoformat(out[2]["start"]).weekday(), 2)


class TestPreview(unittest.TestCase):
    """`sync_uni.py serve`: the panel and its data, but not the settings, and only as localhost."""

    def setUp(self):
        import http.server
        import tempfile
        import threading
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        (d / "index.html").write_text("<p>panel</p>")
        (d / "config.json").write_text('{"moodle_ics_url": "https://moodle.up.pt/calendar/export_execute.php?authtoken=SECRET"}')
        (d / "schedule.csv").write_text("day,start,end,course\n")
        (d / "sync_uni.py").write_text("# code")
        (d / "data").mkdir()
        (d / "data" / "uni.json").write_text('{"schema": "uni/1"}')
        (d / "tests").mkdir()
        (d / "tests" / "x.html").write_text("x")
        handler = u.preview_handler(d)
        handler.log_message = lambda *args: None  # keep the test output quiet
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def get(self, path, host=None):
        import http.client
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            c.request("GET", path, headers={"Host": host} if host else {})
            r = c.getresponse()
            return r.status, r.read().decode("utf-8", "replace")
        finally:
            c.close()

    def test_panel_and_data_are_served(self):
        self.assertEqual(self.get("/index.html")[0], 200)
        self.assertEqual(self.get("/data/uni.json", host=f"localhost:{self.port}")[0], 200)
        self.assertEqual(self.get("/css/tokens.css")[0], 200)

    def test_settings_and_code_are_not(self):
        for path in ("/config.json", "/CONFIG.JSON", "/config.json?x=1", "/./config.json", "/data/../config.json",
                     "/schedule.csv", "/sync_uni.py", "/tests/x.html", "/config.json."):
            status, body = self.get(path)
            self.assertEqual(status, 404, path)
            self.assertNotIn("SECRET", body)

    def test_only_answers_to_its_own_name(self):
        # DNS rebinding: a web page makes the browser call 127.0.0.1 under the page's own name.
        for host in ("evil.example", f"evil.example:{self.port}", "localhost.evil.example"):
            status, body = self.get("/data/uni.json", host=host)
            self.assertEqual(status, 403, host)
            self.assertNotIn("uni/1", body)


if __name__ == "__main__":
    unittest.main()
