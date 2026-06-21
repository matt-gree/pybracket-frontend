"""Generate the studio's test fixtures from the real pybracket library.

Each fixture is the exact dispatch envelope the browser UI consumes (a tournament + query,
produced by the studio bridge in ``public/py/bridge.py``), so the TypeScript layout/contract
tests run against real library output rather than hand-written mocks. Run via
``node scripts/gen-fixtures.mjs`` (it locates the library venv); the JSON files are committed so
the tests need no Python at runtime.
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


def phase(pid, fmt, *, groups=1, options=None, entrants=None):
    return {"id": pid, "format": fmt, "groups": groups, "options": options or {}, "entrants": entrants}


def tournament(n, phases, config=None):
    return {"op": "create", "participants": players(n), "phases": phases, "config": config or {}}


def single(fmt, n, *, groups=1, **options):
    return tournament(n, [phase("main", fmt, groups=groups, options=options)])


def each_group(source, advance):
    return {"sources": [{"phase": source, "place": k, "group": -1} for k in range(1, advance + 1)], "seeding": "snake"}


def top_overall(source, n):
    return {"sources": [{"phase": source, "place": k, "group": None} for k in range(1, n + 1)], "seeding": "snake"}


# Representative matrix: power-of-two, default byes, custom n-level byes (incl. the 24-player
# screenshot case), protected seeds, both gauntlet choice scopes, schedule formats, a divisioned
# league with points, a pools->bracket chain (kept at the preview stage), and a best-of series.
CASES = {
    "single_elim_8": single("single_elim", 8),
    "single_elim_6_default": single("single_elim", 6),
    "single_elim_7_thirdplace": single("single_elim", 7, third_place_match=True),
    "single_elim_16_top4double": single("single_elim", 16, bye_rounds=byes({1: 2, 2: 2, 3: 2, 4: 2})),
    "single_elim_24_custom": single("single_elim", 24, bye_rounds=byes({**{s: 2 for s in range(1, 14)}, 14: 1})),
    "double_elim_8": single("double_elim", 8),
    "double_elim_6_protected": single("double_elim", 6, protected_seeds=2),
    "double_elim_8_noreset": single("double_elim", 8, grand_final_reset=False),
    "double_elim_12_top6double": single("double_elim", 12, bye_rounds=byes({**{s: 2 for s in range(1, 7)}, 7: 1, 8: 1})),
    "double_elim_11_7double": single("double_elim", 11, bye_rounds=byes({s: 2 for s in range(1, 8)})),
    "double_elim_14_custom": single("double_elim", 14, bye_rounds=byes({1: 2, 2: 2, 3: 2, **{s: 1 for s in range(4, 13)}})),
    "double_elim_14_custom_complete": single("double_elim", 14, bye_rounds=byes({1: 2, 2: 2, 3: 2, **{s: 1 for s in range(4, 13)}})),
    "single_elim_8_draft": single("single_elim", 8),
    "gauntlet_single_7": single("gauntlet", 7, style="single"),
    "gauntlet_dual_7_round": single("gauntlet", 7, style="dual", opponent_choice=True, choice_scope="round"),
    "gauntlet_dual_8_semifinals": single("gauntlet", 8, style="dual", opponent_choice=True, choice_scope="semifinals"),
    "round_robin_6": single("round_robin", 6),
    "swiss_8": single("swiss", 8),
    "league_8_2div": single(
        "league", 8, groups=2,
        points_system={"win": 3, "draw": 1, "loss": 0, "draws_allowed": True}, double=True,
    ),
    "pools_12": tournament(12, [
        phase("pools", "round_robin", groups=3),
        phase("cut", "single_elim", entrants=each_group("pools", 2)),
    ]),
    "league_playoffs_8": tournament(8, [
        phase("season", "league", groups=2, options={"points_system": {"win": 3, "draw": 1, "loss": 0, "draws_allowed": True}}),
        phase("playoffs", "single_elim", entrants=top_overall("season", 4)),
    ]),
    "series_8": single("single_elim", 8),
}

# The field phase of these stays in its freshly-created DRAFT state; everything else is published.
DRAFT_ONLY = {"single_elim_8_draft"}
# Two-phase: publish phase 0 and build a placeholder PREVIEW of phase 1 (the pools-preview layout case).
PREVIEW_DOWNSTREAM = {"pools_12": ("pools", "cut"), "league_playoffs_8": ("season", "playoffs")}
# Play the field phase to completion (so a test can compare rendered shape before vs. after).
PLAY_TO_COMPLETION = {"double_elim_14_custom_complete"}
# Report a best-of-3 series game-by-game so a fixture carries a Game log + stats.
SERIES = {"series_8"}


def d(action):
    res = json.loads(bridge.dispatch(json.dumps(action)))
    if not res.get("ok"):
        raise SystemExit(f"dispatch failed ({action.get('op')}): {res.get('error')}")
    return res


def play_phase(res, phase_id, phase_index):
    """Report every ready match (lower seed wins) in a phase until it is complete."""
    for _ in range(4000):
        pq = res["query"]["phases"][phase_index]
        ready = [(g, q["ready_match_ids"][0]) for g, q in enumerate(pq["brackets"]) if q["ready_match_ids"]]
        if not ready:
            break
        g, mid = ready[0]
        bracket = res["tournament"]["phases"][phase_index]["brackets"][g]
        m = next(x for x in bracket["matches"] if x["id"] == mid)
        winner = min(p for p in (m["participant1_id"], m["participant2_id"]) if p is not None)
        res = d({"op": "report", "tournament": res["tournament"], "phase_id": phase_id, "group": g, "match_id": mid, "winner_id": winner})
    return res


def main():
    out_dir = os.path.join(ROOT, "tests", "fixtures")
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for name, action in CASES.items():
        res = d(action)
        if name in DRAFT_ONLY:
            pass  # keep the field phase in DRAFT
        elif name in PREVIEW_DOWNSTREAM:
            field, downstream = PREVIEW_DOWNSTREAM[name]
            res = d({"op": "publish_phase", "tournament": res["tournament"], "phase_id": field})
            res = d({"op": "preview_phase", "tournament": res["tournament"], "phase_id": downstream})
        else:
            res = d({"op": "publish_phase", "tournament": res["tournament"], "phase_id": "main"})
            if name in PLAY_TO_COMPLETION:
                res = play_phase(res, "main", 0)
            elif name in SERIES:
                mid = res["query"]["phases"][0]["brackets"][0]["ready_match_ids"][0]
                m = next(x for x in res["tournament"]["phases"][0]["brackets"][0]["matches"] if x["id"] == mid)
                p1, p2 = m["participant1_id"], m["participant2_id"]
                res = d({"op": "update_match", "tournament": res["tournament"], "phase_id": "main", "group": 0, "match_id": mid, "best_of": 3})
                res = d({"op": "report_game", "tournament": res["tournament"], "phase_id": "main", "group": 0, "match_id": mid, "winner_id": p1, "stats": {"runs": [7, 3]}})
                res = d({"op": "report_game", "tournament": res["tournament"], "phase_id": "main", "group": 0, "match_id": mid, "winner_id": p1})

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
