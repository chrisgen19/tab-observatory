import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from install_host import merged_origins, write_manifest


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.manifest = Path(self.directory.name) / "hosts/monitor.json"
        self.binary = Path(self.directory.name) / "host.exe"

    def test_second_install_and_repeat_preserve_both_profiles(self):
        first, second = 'a' * 32, 'b' * 32
        write_manifest(self.manifest, self.binary, merged_origins(self.manifest, [first]))
        write_manifest(self.manifest, self.binary, merged_origins(self.manifest, [second]))
        actual = merged_origins(self.manifest, [first, second, first])
        expected = [f'chrome-extension://{first}/', f'chrome-extension://{second}/']
        self.assertEqual(actual, expected)
        self.assertEqual(json.loads(self.manifest.read_text())["allowed_origins"], expected)

    def test_multiple_new_ids_and_same_id_in_two_profiles(self):
        self.assertEqual(len(merged_origins(self.manifest, ['a' * 32, 'a' * 32])), 1)
        self.assertEqual(len(merged_origins(self.manifest, ['a' * 32, 'b' * 32])), 2)

    def test_invalid_ids_or_corrupt_manifest_do_not_overwrite_registration(self):
        write_manifest(self.manifest, self.binary, merged_origins(self.manifest, ['a' * 32]))
        before = self.manifest.read_bytes()
        for value in ['*', 'z' * 32, 'a' * 31, 'chrome-extension://' + 'a' * 32 + '/']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                merged_origins(self.manifest, [value])
        self.assertEqual(self.manifest.read_bytes(), before)
        for content in ['{broken', '[]', '{"name":"other","type":"stdio"}', '{"name":"com.tab_observatory.monitor","type":"stdio","allowed_origins":["*"]}']:
            self.manifest.write_text(content)
            with self.subTest(content=content), self.assertRaises(ValueError):
                merged_origins(self.manifest, ['b' * 32])
            self.assertEqual(self.manifest.read_text(), content)


if __name__ == '__main__':
    unittest.main()
