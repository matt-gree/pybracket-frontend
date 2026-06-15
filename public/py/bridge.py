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


def _build_pools(participants, options):
    bracket_format = options.get("bracket_format", "double_elim")
    # Forward the elimination bracket's own options as bracket_kwargs.
    bracket_kwargs = {}
    if bracket_format == "double_elim":
        bracket_kwargs["grand_final_reset"] = bool(options.get("grand_final_reset", True))
    elif bracket_format == "single_elim":
        bracket_kwargs["third_place_match"] = bool(options.get("third_place_match", False))
    return pb.generate_pools(
        _participants(participants),
        num_pools=int(options.get("num_pools", 2)),
        advancement_count=int(options.get("advancement_count", 2)),
        bracket_format=bracket_format,
        snake_shuffle=bool(options.get("snake_shuffle", True)),
        **bracket_kwargs,
    )


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


# --- pools ------------------------------------------------------------------------------------
# A PoolsBracket is not a Bracket: it holds the round-robin pools, the elimination bracket, and
# its own config. Each pool and the elimination are plain Brackets, so the studio plays them with
# the normal report/unwind ops and only needs special ops for drafting/publishing the bracket.


def _pools_to_dict(pools):
    return {
        "pools": [pb.bracket_to_dict(p) for p in pools.pools],
        "elimination": pb.bracket_to_dict(pools.elimination),
        "participants": [_participant_dict(p) for p in pools.participants],
        "config": dict(pools.config),
    }


def _pools_from_dict(data):
    return pb.PoolsBracket(
        pools=[pb.bracket_from_dict(p) for p in data["pools"]],
        elimination=pb.bracket_from_dict(data["elimination"]),
        participants=_participants(data["participants"]),
        config=dict(data.get("config", {})),
    )


def _pools_query(pools):
    return {
        "pools": [_query(p) for p in pools.pools],
        "pools_complete": all(pb.is_complete(p) for p in pools.pools),
        "elimination": _query(pools.elimination),
        "elimination_state": pools.elimination.state.value,
        "advancing_ids": list(pools.config.get("advancing_ids", [])),
    }


def _ok_pools(pools):
    return json.dumps(
        {"ok": True, "pools": _pools_to_dict(pools), "pools_query": _pools_query(pools)}
    )


def dispatch(action_json):
    try:
        action = json.loads(action_json)
        op = action.get("op")

        if op == "create":
            if action["format"] == "pools":
                pools = _build_pools(action["participants"], action.get("options", {}))
                # Return a preliminary bracket from the start so the TO sees where each pool
                # finisher will land; it's rebuilt for real (draft_pools) once pools complete.
                return _ok_pools(pb.preview_pools_bracket(pools))
            bracket = _build(action["format"], action["participants"], action.get("options", {}))
            return _ok(bracket)

        if op == "complete_byes":
            # Live-validate a requested bye partition: the engine fills the minimal extra byes (or
            # raises), so the divider editor can show validity + what it would add without a build.
            n = int(action["count"])
            requested = {
                int(k): int(v) for k, v in (action.get("bye_rounds") or {}).items() if int(v) > 0
            }
            comp = pb.complete_bye_rounds(n, requested)
            return json.dumps(
                {
                    "ok": True,
                    "completed": {str(k): v for k, v in comp.completed.items()},
                    "added": {str(k): v for k, v in comp.added.items()},
                    "rounds": comp.rounds,
                }
            )

        if op == "bye_options":
            # The bye configurations a field of `count` players supports, for the UI to offer.
            options = pb.allowable_bye_options(int(action["count"]))
            return json.dumps(
                {
                    "ok": True,
                    "options": [
                        {
                            "rounds": o.rounds,
                            "doubles": o.doubles,
                            "singles": o.singles,
                            "label": o.label(),
                            "bye_rounds": {str(k): v for k, v in o.to_bye_rounds().items()},
                        }
                        for o in options
                    ],
                }
            )

        # Pool-level lifecycle ops carry the whole PoolsBracket; the individual pools and the
        # elimination bracket are played with the ordinary report/unwind ops below.
        if op in ("draft_pools", "reseed_pools", "publish_bracket", "preview_pools"):
            pools = _pools_from_dict(action["pools_bracket"])
            if op == "publish_bracket":
                pools = pb.publish_bracket(pools)
            elif op == "preview_pools":
                pools = pb.preview_pools_bracket(pools)
            else:
                pools = pb.draft_pools_to_bracket(pools, new_seed_order=action.get("new_seed_order"))
            return _ok_pools(pools)

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
