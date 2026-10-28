import io
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "companion"))
from native_host import read_message, write_message, serve, Sampler


class Chunked(io.BytesIO):
    def read(self, count=-1):
        return super().read(min(count, 2))


class HostTests(unittest.TestCase):
    def test_fragmented_unicode_roundtrip(self):
        output = io.BytesIO()
        write_message(output, {"message": "Hello 🌎"})
        self.assertEqual(read_message(Chunked(output.getvalue())), {"message": "Hello 🌎"})

    def test_invalid_and_truncated_messages(self):
        for data in [struct.pack("=I", 0), struct.pack("=I", 1000000), b"\x05", struct.pack("=I", 8) + b"{}", struct.pack("=I", 2) + b"[]"]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                read_message(io.BytesIO(data))

    def test_unknown_command_cannot_invoke_sampler(self):
        incoming, outgoing = io.BytesIO(), io.BytesIO()
        write_message(incoming, {"command": "run", "pid": 1})
        incoming.seek(0)
        sampler = Mock()
        serve(incoming, outgoing, sampler)
        sampler.snapshot.assert_not_called()
        outgoing.seek(0)
        self.assertIn("error", read_message(outgoing))

    def test_cpu_first_sample_and_pid_reuse(self):
        browser = Mock(pid=42)
        browser.is_running.return_value = True
        browser.children.return_value = []
        browser.name.return_value = "chrome.exe"
        browser.cmdline.return_value = []
        browser.create_time.return_value = 1
        browser.oneshot.return_value.__enter__ = Mock()
        browser.oneshot.return_value.__exit__ = Mock(return_value=False)
        browser.memory_info.return_value = Mock(rss=100)
        browser.memory_full_info.return_value = Mock(uss=80)
        browser.cpu_times.return_value = Mock(user=1, system=1)
        sampler = Sampler(browser)
        with patch('native_host.time.monotonic', side_effect=[10, 13, 16]):
            self.assertIsNone(sampler.snapshot()["processes"][0]["cpuPercent"])
            browser.cpu_times.return_value = Mock(user=2, system=1)
            self.assertAlmostEqual(sampler.snapshot()["processes"][0]["cpuPercent"], 33.33)
            browser.create_time.return_value = 2
            self.assertIsNone(sampler.snapshot()["processes"][0]["cpuPercent"])


if __name__ == "__main__":
    unittest.main()
