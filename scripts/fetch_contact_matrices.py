"""Bundle the Prem et al. 2021 synthetic contact matrices, aggregated to the three age groups (sim-parameters Part 2, 5.3):

    .venv/Scripts/python.exe -m pip install rdata          # once; a dev-only dependency of this script
    .venv/Scripts/python.exe scripts/fetch_contact_matrices.py [--sample GBR KEN]

Downloads contact_all.rdata (all locations combined; 177 countries, sixteen five-year bands) from the authors' repository, aggregates each
country's matrix with epichat.params.tables.aggregate_contacts and the country's 2024 pyramid (so run scripts/fetch_un_wpp_tables.py
first), and writes epichat/data/contact_matrices.csv - iso3, source, target, contacts (rows source, columns target, as ss.MixingPools
reads them). --sample writes the named countries' raw 16x16 matrices to tests/fixtures/prem_2021_sample.csv for the aggregation test.
Countries without a bundled pyramid are skipped and listed."""
from __future__ import annotations

import argparse
import csv
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from epichat.params import tables  # noqa: E402

URL = ("https://raw.githubusercontent.com/kieshaprem/synthetic-contact-matrices/master/generate_synthetic_matrices/output/"
       "syntheticmatrices/contact_all.rdata")
GROUPS = ("children", "adults", "elderly")


def load_matrices(path: Path) -> dict[str, np.ndarray]:
    import rdata
    converted = rdata.conversion.convert(rdata.parser.parse_file(path))
    matrices = converted["contact_all"]
    return {str(k): np.asarray(v, dtype=float) for k, v in matrices.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", nargs="*", default=[], help="ISO3 codes whose raw matrices go to tests/fixtures/prem_2021_sample.csv")
    args = parser.parse_args()
    tmp = Path(tempfile.gettempdir()) / "prem_2021_contact_all.rdata"
    if not tmp.exists():
        print(f"downloading {URL} ...", file=sys.stderr)
        urllib.request.urlretrieve(URL, tmp)
    matrices = load_matrices(tmp)
    rows, skipped = [], []
    for iso3 in sorted(matrices):
        pop = tables.age_histogram(iso3)
        if pop is None:
            skipped.append(iso3)
            continue
        c = tables.aggregate_contacts(matrices[iso3], pop)
        rows += [(iso3, GROUPS[i], GROUPS[j], round(float(c[i, j]), 4)) for i in range(3) for j in range(3)]
    path = ROOT / "epichat" / "data" / "contact_matrices.csv"
    with open(path, "w", newline="\n", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["iso3", "source", "target", "contacts"])
        w.writerows(rows)
    print(f"wrote {path.relative_to(ROOT)} ({len(rows) // 9} countries; skipped without a pyramid: {skipped or 'none'})")
    if args.sample:
        sample = ROOT / "tests" / "fixtures" / "prem_2021_sample.csv"
        with open(sample, "w", newline="\n", encoding="utf-8") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["iso3", "row", "col", "value"])
            for iso3 in args.sample:
                m = matrices[iso3.upper()]
                w.writerows((iso3.upper(), i, j, round(float(m[i, j]), 6)) for i in range(16) for j in range(16))
        print(f"wrote {sample.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
