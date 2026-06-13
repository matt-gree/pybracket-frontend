"""Browser bridge between the pybracket studio UI and the real pybracket library.

The frontend calls a single `dispatch(action_json)` function with a JSON action and gets back a
JSON envelope: {ok, bracket, query[, signals]} on success, or {ok: false, error} on failure.
Everything that crosses the JS boundary is a JSON string so there are no proxy lifetime concerns.
"""

import json

import pybracket as pb


def _participants(items):
    return [
        pb.Participant(id=i["id"], seed=i["seed"], name=i["name"], stats=dict(i.get("stats", {})))
        for i in items
    ]


def _build(fmt, participants, options):
    ps = _participants(participants)
    if fmt == "single_elim":
        raw_bye_rounds = options.get("bye_rounds")
        bye_rounds = None
        if raw_bye_rounds:
            # JS object keys arrive as strings; the library keys bye_rounds by seed (int).
            bye_rounds = {int(k): int(v) for k, v in raw_bye_rounds.items() if int(v) > 0}
        return pb.generate_single_elim(
            ps,
            third_place_match=bool(options.get("third_place_match", False)),
            protected_seeds=0 if bye_rounds else int(options.get("protected_seeds", 0)),
            bye_rounds=bye_rounds or None,
        )
    if fmt == "double_elim":
        return pb.generate_double_elim(
            ps,
            grand_final_reset=bool(options.get("grand_final_reset", True)),
            protected_seeds=int(options.get("protected_seeds", 0)),
        )
    if fmt == "round_robin":
        return pb.generate_round_robin(ps)
    if fmt == "swiss":
        rounds = options.get("rounds")
        method = pb.PairingMethod(options.get("pairing_method", "dutch"))
        return pb.generate_swiss(
            ps,
            rounds=int(rounds) if rounds is not None else None,
            pairing_method=method,
        )
    if fmt == "gauntlet":
        return pb.generate_gauntlet(
            ps,
            style=options.get("style", "dual"),
            opponent_choice=bool(options.get("opponent_choice", False)),
            choice_scope=options.get("choice_scope", "round"),
        )
    raise ValueError(f"Unknown format: {fmt!r}")


def _participant_dict(p):
    return {"id": p.id, "seed": p.seed, "name": p.name, "stats": dict(p.stats)}


def _standing_dict(s):
    return {
        "participant_id": s.participant_id,
        "rank": s.rank,
        "wins": s.wins,
        "losses": s.losses,
        "tiebreaker_scores": {k: float(v) for k, v in s.tiebreaker_scores.items()},
    }


def _placement_dict(p):
    return {
        "participant_id": p.participant_id,
        "position": p.position,
        "position_label": p.position_label,
        "eliminated_in": p.eliminated_in,
    }


def _query(bracket):
    complete = pb.is_complete(bracket)
    standings = []
    if bracket.format in ("round_robin", "swiss"):
        standings = [_standing_dict(s) for s in pb.get_standings(bracket)]
    placements = [_placement_dict(p) for p in pb.get_placements(bracket)] if complete else []
    winner = pb.get_winner(bracket) if complete else None
    return {
        "ready_match_ids": [m.id for m in pb.get_ready_matches(bracket)],
        "standings": standings,
        "placements": placements,
        "winner": _participant_dict(winner) if winner is not None else None,
        "is_complete": complete,
    }


def _ok(bracket, signals=None):
    payload = {"ok": True, "bracket": pb.bracket_to_dict(bracket), "query": _query(bracket)}
    if signals is not None:
        payload["signals"] = signals
    return json.dumps(payload)


def dispatch(action_json):
    try:
        action = json.loads(action_json)
        op = action.get("op")

        if op == "create":
            bracket = _build(action["format"], action["participants"], action.get("options", {}))
            return _ok(bracket)

        bracket = pb.bracket_from_dict(action["bracket"])

        if op == "report":
            adv = pb.AdvancementType(action.get("advancement_type", "result"))
            bracket = pb.report_result(
                bracket,
                action["match_id"],
                action["winner_id"],
                advancement_type=adv,
                metadata=action.get("metadata"),
            )
            return _ok(bracket)

        if op == "update_match":
            # Direct per-match edits from the detail modal: best-of and stored score live on the
            # match itself (best_of) and its metadata (the library never reads metadata).
            match = pb.get_match(bracket, action["match_id"])
            if match is None:
                raise pb.MatchNotFoundError(f"No match with id {action['match_id']}.")
            if "best_of" in action and action["best_of"] is not None:
                match.best_of = int(action["best_of"])
            if "metadata" in action and action["metadata"] is not None:
                match.metadata = {**match.metadata, **action["metadata"]}
            return _ok(bracket)

        if op == "report_choice":
            bracket = pb.report_choice(bracket, action["match_id"], action["opponent_id"])
            return _ok(bracket)

        if op == "advance_swiss":
            bracket = pb.advance_swiss_round(bracket)
            return _ok(bracket)

        if op == "unwind":
            bracket, signals = pb.unwind_result(bracket, action["match_id"])
            return _ok(
                bracket,
                [{"match_id": s.match_id, "metadata": dict(s.metadata)} for s in signals],
            )

        raise ValueError(f"Unknown op: {op!r}")
    except Exception as exc:  # noqa: BLE001 — surfaced to the UI as an error toast
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
