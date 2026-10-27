"""Generate disposable root-level browser fixtures. Run from the repository root.
Serve the repo, then open /smoke-level3.html. Does not alter production modules.
"""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
(root / 'smoke-level3-module.js').write_text((root / 'Level3.js').read_text(encoding='utf-8') + '\nexport { lv3, updateLevel3Mission };\n', encoding='utf-8')
(root / 'smoke-level3.html').write_text((root / 'index.html').read_text(encoding='utf-8').replace('src="main.js"', 'src="smoke-level3.mjs"'), encoding='utf-8')
(root / 'smoke-level3.mjs').write_text((root / 'tests/level3-smoke.mjs').read_text(encoding='utf-8'), encoding='utf-8')
print('Open /smoke-level3.html on the local server. Expect ALL CHECKS PASSED.')
