from pathlib import Path
import sys


config_path = Path(sys.argv[1])
snippet_path = Path(sys.argv[2])
config = config_path.read_text()
snippet = snippet_path.read_text().strip()
marker = "extprocessor yamicuberush_ws {"

if "context /yamicuberush/ {" not in config:
    if marker not in config:
        raise SystemExit(f"marker not found in {config_path}")
    config_path.write_text(config.replace(marker, f"{snippet}\n\n{marker}", 1))
