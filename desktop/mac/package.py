#!/usr/bin/env python3
"""Package only the compiled, signed companion app, with UTF-8 names."""
from pathlib import Path
import sys
import zipfile

app = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
allowed = {'Contents/Info.plist', 'Contents/MacOS/tranRUOverlay', 'Contents/_CodeSignature/CodeResources'}
files = [p for p in app.rglob('*') if p.is_file() and p.name != '.DS_Store']
assert app.is_dir() and app.suffix == '.app'
assert {p.relative_to(app).as_posix() for p in files} == allowed
assert not any(p.is_symlink() for p in app.rglob('*'))
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(files):
        archive.write(path, Path(app.name) / path.relative_to(app))
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert all(info.flag_bits & 0x800 for info in archive.infolist())
print('UTF-8 app package verified')
