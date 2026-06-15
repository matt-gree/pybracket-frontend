"""Generate the studio's test fixtures from the real pybracket library.

Each fixture is the exact dispatch envelope the browser UI consumes (produced by the studio
bridge in ``public/py/bridge.py``), so the TypeScript layout/contract tests run against real
library output rather than hand-written mocks. Run via ``node scripts/gen-fixtures.mjs`` (it
locates the library venv); the JSON files are committed so the tests need no Python at runtime.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "public", "py"))

import bridge  # noqa: E402  (import after sys.path is set up)


def players(n):
    return [{"id": i, "seed": i, "name": f"Seed {i}"} for i in range(1, n + 1)]


def byes(spec):
    # JS sends bye_rounds keyed by string seed; mirror that so the bridge path is exercised.
    return {str(k): v for k, v in spec.items()}


def create(fmt, n, **options):
    return {"op": "create", "format": fmt, "participants": players(n), "options": options}


# Representative matrix: power-of-two, default byes, custom n-level byes (incl. the 24-player
# screenshot case), protected seeds, both gauntlet choice scopes, and the schedule formats.
CASES = {
    "single_elim_8": create("single_elim", 8),
    "single_elim_6_default": create("single_elim", 6),
    "single_elim_7_thirdplace": create("single_elim", 7, third_place_match=True),
    "single_elim_16_top4double": create("single_elim", 16, bye_rounds=byes({1: 2, 2: 2, 3: 2, 4: 2})),
    # The reported screenshot: 24 players, top 13 double-bye + seed 14 single-bye, rest play in.
    "single_elim_24_custom": create(
        "single_elim", 24, bye_rounds=byes({**{s: 2 for s in range(1, 14)}, 14: 1})
    ),
    "double_elim_8": create("double_elim", 8),
    "double_elim_6_protected": create("double_elim", 6, protected_seeds=2),
    "double_elim_8_noreset": create("double_elim", 8, grand_final_reset=False),
    "gauntlet_single_7": create("gauntlet", 7, style="single"),
    "gauntlet_dual_7_round": create(
        "gauntlet", 7, style="dual", opponent_choice=True, choice_scope="round"
    ),
    "gauntlet_dual_8_semifinals": create(
        "gauntlet", 8, style="dual", opponent_choice=True, choice_scope="semifinals"
    ),
    "round_robin_6": create("round_robin", 6),
    "swiss_8": create("swiss", 8),
    "pools_12": create(
        "pools", 12, num_pools=3, advancement_count=2, bracket_format="single_elim"
    ),
}


def main():
    out_dir = os.path.join(ROOT, "tests", "fixtures")
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for name, action in CASES.items():
        res = json.loads(bridge.dispatch(json.dumps(action)))
        if not res.get("ok"):
            raise SystemExit(f"fixture {name} failed: {res.get('error')}")
        payload = {"name": name, "action": action, "result": res}
        with open(os.path.join(out_dir, f"{name}.json"), "w") as f:
            json.dump(payload, f, indent=2, sort_keys=True)
            f.write("\n")
        written.append(name)

    import pybracket as pb  # noqa: E402

    with open(os.path.join(out_dir, "_meta.json"), "w") as f:
        json.dump({"pybracket_version": getattr(pb, "__version__", None)}, f, indent=2)
        f.write("\n")
    print(f"Wrote {len(written)} fixtures to tests/fixtures/: {', '.join(written)}")


if __name__ == "__main__":
    main()
