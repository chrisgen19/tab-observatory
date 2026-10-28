"""Verify a packaged host emits valid native messaging instead of console output."""
import json
from pathlib import Path
import struct
import subprocess
import sys

binary = Path(sys.argv[1]).resolve()
result = subprocess.run([str(binary)], input=b"", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
assert len(result.stdout) >= 4, result.stderr.decode(errors="replace")
length = struct.unpack("=I", result.stdout[:4])[0]
assert len(result.stdout) == 4 + length
message = json.loads(result.stdout[4:])
assert "launching Chrome browser" in message.get("error", ""), message
print("Packaged host native-message framing passed.")
