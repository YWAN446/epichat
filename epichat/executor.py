from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


class SimExecutor:
    TIMEOUT_SECONDS = 90

    def run(self, code: str, output_dir: Path) -> dict:
        """
        Write Python code to a temp file, execute it as a subprocess,
        capture stdout/stderr, and return a results dict.

        Returns:
            {
                'plot_path': str,
                'stats': dict,
                'error': str | None,
            }
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, encoding="utf-8"
        ) as f:
            f.write(code)
            tmp_path = f.name

        try:
            result = subprocess.run(
                [sys.executable, tmp_path],
                capture_output=True,
                text=True,
                timeout=self.TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            return {
                "plot_path": None,
                "stats": {},
                "error": f"Simulation timed out after {self.TIMEOUT_SECONDS} seconds.",
            }
        finally:
            Path(tmp_path).unlink(missing_ok=True)

        if result.returncode != 0:
            return {
                "plot_path": None,
                "stats": {},
                "error": result.stderr.strip() or "Unknown execution error.",
            }

        # Parse JSON stats from the last non-empty stdout line
        stdout_lines = [l for l in result.stdout.strip().splitlines() if l.strip()]
        stats = {}
        if stdout_lines:
            try:
                stats = json.loads(stdout_lines[-1])
            except json.JSONDecodeError:
                pass  # stats unavailable, but simulation may have succeeded

        # Find the plot file written to output_dir (most recent .png)
        plots = sorted(output_dir.glob("*.png"), key=lambda p: p.stat().st_mtime)
        plot_path = str(plots[-1]) if plots else None

        return {"plot_path": plot_path, "stats": stats, "error": None}
