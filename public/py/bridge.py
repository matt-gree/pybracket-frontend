"""Browser bridge between the pybracket studio UI and the real pybracket library.

The frontend calls a single ``dispatch(action_json)`` with a JSON action and gets back a JSON
envelope: ``{ok, tournament, query[, signals]}`` on success, or ``{ok: false, error}`` on failure.
Everything that crosses the JS boundary is a JSON string so there are no proxy lifetime concerns.

The studio always works with a :class:`Tournament` — even a lone single-elim is a one-phase
tournament. The whole tournament rides on every action; a match op names ``(phase_id, group,
match_id)`` and the bridge pulls out that sub-:class:`Bracket`, runs the ordinary engine op, writes
it back, and returns the whole tournament plus a precomputed query (the "fat query" pattern so the
UI never re-derives the library's view).
"""

import json

import pybracket as pb
from pybracket.seeding.pool_seeding import snake_pool_assignment

_STANDINGS_FORMATS = ("round_robin", "swiss", "league")
DRAFT = pb.BracketState.DRAFT


# --- participants / bracket construction ------------------------------------------------------


def _participants(items):
    return [
        pb.Participant(id=i["id"], seed=i["seed"], name=i["name"], stats=dict(i.get("stats", {})))
        for i in items
    ]


def _bye_rounds(options):
    raw = options.get("bye_rounds")
    if not raw:
        return None
    # JS object keys arrive as strings; the library keys bye_rounds by seed (int).
    coerced = {int(k): int(v) for k, v in raw.items() if int(v) > 0}
    return coerced or None


def _build(fmt, participants, options):
    """Build one bracket with the full-featured generator (honours byes / protected seeds /
    pairing method — things the tournament phase builder drops). Used for the field phase."""
    ps = sorted(participants, key=lambda p: p.seed)
    if fmt == "single_elim":
        bye_rounds = _bye_rounds(options)
        survivors = options.get("survivors")
        return pb.generate_single_elim(
            ps,
            third_place_match=bool(options.get("third_place_match", False)),
            protected_seeds=0 if bye_rounds else int(options.get("protected_seeds", 0)),
            bye_rounds=bye_rounds,
            survivors=int(survivors) if survivors else None,
        )
    if fmt == "double_elim":
        bye_rounds = _bye_rounds(options)
        return pb.generate_double_elim(
            ps,
            grand_final_reset=bool(options.get("grand_final_reset", True)),
            protected_seeds=0 if bye_rounds else int(options.get("protected_seeds", 0)),
            bye_rounds=bye_rounds,
        )
    if fmt == "round_robin":
        return pb.generate_round_robin(ps)
    if fmt == "swiss":
        rounds = options.get("rounds")
        return pb.generate_swiss(
            ps,
            rounds=int(rounds) if rounds is not None else None,
            pairing_method=pb.PairingMethod(options.get("pairing_method", "dutch")),
        )
    if fmt == "gauntlet":
        return pb.generate_gauntlet(
            ps,
            style=options.get("style", "dual"),
            opponent_choice=bool(options.get("opponent_choice", False)),
            choice_scope=options.get("choice_scope", "round"),
        )
    if fmt == "league":
        return _build_league(ps, options, divisions=max(1, int(options.get("groups", 1))))
    raise ValueError(f"Unknown format: {fmt!r}")


def _build_league(participants, options, *, divisions):
    ps = options.get("points_system")
    cd = options.get("cross_division")
    return pb.generate_league(
        participants,
        divisions=divisions,
        double=bool(options.get("double", False)),
        best_of=int(options.get("best_of", 1)),
        points=pb.PointsSystem.from_spec(ps) if ps else None,
        cross_division=pb.CrossDivision.from_spec(cd) if cd else None,
    )


def _build_phase0(fmt, participants, options, groups):
    """The field phase's bracket(s): one per group, or a single bracket for groups==1.

    Leagues own their divisions internally (one bracket), so ``groups`` there is a division
    count, not a request for parallel sub-brackets.
    """
    if fmt == "league":
        return [_build_league(sorted(participants, key=lambda p: p.seed), options, divisions=max(1, groups))]
    if groups <= 1:
        return [_build(fmt, participants, options)]
    assignment = snake_pool_assignment(sorted(participants, key=lambda p: p.seed), groups)
    out = []
    for i, group in enumerate(assignment):
        if fmt == "round_robin":
            out.append(pb.generate_round_robin(group, pool_index=i))
        else:
            out.append(_build(fmt, group, options))
    return out


def _slot_ref(d):
    return pb.SlotRef(phase=d["phase"], place=int(d.get("place", 0)), group=d.get("group"))


def _qualification(d):
    return pb.Qualification(
        sources=[_slot_ref(s) for s in d["sources"]],
        seeding=d.get("seeding", "snake"),
    )


def _phase_spec(p):
    entrants = p.get("entrants")
    return pb.PhaseSpec(
        id=p["id"],
        format=p["format"],
        groups=int(p.get("groups", 1)),
        entrants=_qualification(entrants) if entrants else None,
        group_assignment=p.get("group_assignment", "snake"),
        config=dict(p.get("options", {})),
    )


def _apply_phase_scoring(t):
    """Inject points/tiebreakers from a phase's config into its standings bracket(s).

    ``get_standings`` reads ``config['points_system']`` / ``config['tiebreakers']``, so this lets a
    configured points system or tiebreaker chain take effect without any library change — including
    for round-robin / Swiss phases, whose tournament builder otherwise ignores that config.
    """
    default_tb = t.config.get("tiebreakers")  # tournament-level default, inherited by phases
    for phase in t.phases:
        for b in phase.brackets:
            if b.format not in _STANDINGS_FORMATS:
                continue
            tb = phase.config.get("tiebreakers") or default_tb
            if tb and "tiebreakers" not in b.config:
                b.config["tiebreakers"] = tb
            ps = phase.config.get("points_system")
            if ps and "points_system" not in b.config:
                b.config["points_system"] = ps


def _build_tournament(participants, phases):
    parts = _participants(participants)
    specs = [_phase_spec(p) for p in phases]
    # generate_tournament validates ids/refs and builds the downstream skeleton; we rebuild the
    # field phase's bracket(s) with the full generators so byes / pairing method are preserved.
    t = pb.generate_tournament(parts, specs)
    p0 = t.phases[0]
    p0.brackets = _build_phase0(p0.format, parts, dict(phases[0].get("options", {})), p0.groups)
    # The field phase starts in DRAFT: the organizer tweaks config freely and presses "Start"
    # (publish_phase) before any result can be reported. Downstream phases are already DRAFT/empty.
    p0.state = DRAFT
    for b in p0.brackets:
        b.state = DRAFT
    _apply_phase_scoring(t)
    return t


# --- serialization helpers --------------------------------------------------------------------


def _participant_dict(p):
    return {"id": p.id, "seed": p.seed, "name": p.name, "stats": dict(p.stats)}


def _standing_dict(s):
    return {
        "participant_id": s.participant_id,
        "rank": s.rank,
        "wins": s.wins,
        "losses": s.losses,
        "draws": s.draws,
        "points": s.points,
        "tiebreaker_scores": {k: float(v) for k, v in s.tiebreaker_scores.items()},
    }


def _placement_dict(p):
    return {
        "participant_id": p.participant_id,
        "position": p.position,
        "position_label": p.position_label,
        "eliminated_in": p.eliminated_in,
    }


def _ranked_dict(r):
    return {"participant_id": r.participant_id, "rank": r.rank, "group": r.group}


def _query(bracket):
    """Per-bracket read model the UI renders directly."""
    complete = pb.is_complete(bracket)
    standings = []
    if bracket.format in _STANDINGS_FORMATS:
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


def _league_extras(bracket):
    divisions = [list(r) for r in pb.league_divisions(bracket)]
    extras = {
        "divisions": divisions,
        "division_standings": [
            [_standing_dict(s) for s in pb.division_standings(bracket, d)]
            for d in range(len(divisions))
        ],
        "schedule": [
            {
                "number": w.number,
                "fixtures": [
                    {"match_id": f.match_id, "home_id": f.home_id, "away_id": f.away_id,
                     "division": f.division}
                    for f in w.fixtures
                ],
            }
            for w in pb.league_schedule(bracket)
        ],
    }
    ps = bracket.config.get("points_system")
    if ps is not None:
        extras["points_system"] = ps.to_spec() if hasattr(ps, "to_spec") else ps
    return extras


def _group_results(bracket, group_index):
    """Best-available ranking of one group (standings always exist; placements need completion)."""
    if bracket.format in _STANDINGS_FORMATS:
        return [
            {"participant_id": s.participant_id, "rank": s.rank, "group": group_index}
            for s in pb.get_standings(bracket)
        ]
    placements = sorted(pb.get_placements(bracket), key=lambda pl: pl.position)
    return [
        {"participant_id": pl.participant_id, "rank": pl.position, "group": group_index}
        for pl in placements
    ]


def _phase_query(t, phase):
    brackets = phase.brackets
    out = {
        "id": phase.id,
        "format": phase.format,
        "state": phase.state.value,
        "groups": len(brackets) if brackets else phase.groups,
        "has_brackets": bool(brackets),
        "is_complete": pb.phase_is_complete(phase),
        "is_draftable": pb.is_phase_draftable(t, phase.id),
        "is_preview": any(b.config.get("preview") for b in brackets),
        "brackets": [_query(b) for b in brackets],
        "group_results": [_group_results(b, i) for i, b in enumerate(brackets)],
    }
    if phase.format == "league" and brackets:
        out["league"] = _league_extras(brackets[0])
    return out


def _tournament_query(t):
    return {"phases": [_phase_query(t, p) for p in t.phases]}


def _ok(t, signals=None):
    payload = {"ok": True, "tournament": pb.tournament_to_dict(t), "query": _tournament_query(t)}
    if signals is not None:
        payload["signals"] = signals
    return json.dumps(payload)


# --- phase / match lookups --------------------------------------------------------------------


def _phase(t, phase_id):
    for p in t.phases:
        if p.id == phase_id:
            return p
    raise ValueError(f"No phase with id {phase_id!r}.")


def _sub_bracket(t, action):
    phase = _phase(t, action["phase_id"])
    group = int(action.get("group", 0))
    if group >= len(phase.brackets):
        raise ValueError(f"Phase {phase.id!r} has no group {group}.")
    return phase, group, phase.brackets[group]


# --- dispatch ---------------------------------------------------------------------------------


def dispatch(action_json):
    try:
        action = json.loads(action_json)
        op = action.get("op")

        if op == "create":
            t = _build_tournament(action["participants"], action["phases"])
            return _ok(t)

        # --- stateless helpers (no tournament) ------------------------------------------------
        if op == "complete_byes":
            n = int(action["count"])
            requested = {
                int(k): int(v) for k, v in (action.get("bye_rounds") or {}).items() if int(v) > 0
            }
            comp = pb.complete_bye_rounds(n, requested)
            return json.dumps({
                "ok": True,
                "completed": {str(k): v for k, v in comp.completed.items()},
                "added": {str(k): v for k, v in comp.added.items()},
                "rounds": comp.rounds,
            })

        if op == "bye_options":
            max_level = action.get("max_bye_level")
            kwargs = {"max_bye_level": int(max_level)} if max_level is not None else {}
            options = pb.allowable_bye_options(int(action["count"]), **kwargs)
            return json.dumps({
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
            })

        # Everything below carries the whole tournament.
        t = pb.tournament_from_dict(action["tournament"])

        # --- phase lifecycle ------------------------------------------------------------------
        if op == "draft_phase":
            t = pb.draft_phase(t, action["phase_id"], new_seed_order=action.get("new_seed_order"))
            _apply_phase_scoring(t)
            return _ok(t)

        if op == "preview_phase":
            t = pb.preview_phase(t, action["phase_id"])
            _apply_phase_scoring(t)
            return _ok(t)

        if op == "publish_phase":
            t = pb.publish_phase(t, action["phase_id"])
            return _ok(t)

        if op == "revert_phase":
            t = pb.revert_phase(t, action["phase_id"])
            return _ok(t)

        if op == "advance_phase":
            t = pb.advance_phase(t, action["phase_id"], new_seed_order=action.get("new_seed_order"))
            _apply_phase_scoring(t)
            return _ok(t)

        # --- in-phase match ops (operate on one sub-bracket) ----------------------------------
        if op == "unwind":
            # The cross-phase gate refuses an unwind that would strand a live downstream phase.
            t, signals = pb.unwind_phase_result(
                t, action["phase_id"], action["match_id"], group=int(action.get("group", 0))
            )
            return _ok(t, [{"match_id": s.match_id, "metadata": dict(s.metadata)} for s in signals])

        phase, group, bracket = _sub_bracket(t, action)

        if op == "report":
            adv = pb.AdvancementType(action.get("advancement_type", "result"))
            bracket = pb.report_result(
                bracket, action["match_id"], action["winner_id"],
                advancement_type=adv, metadata=action.get("metadata"), stats=action.get("stats"),
            )
        elif op == "report_game":
            # Each game has a winner; a match draw emerges from an even best-of ending level, or
            # via report_draw for a BO1 standings match.
            bracket = pb.report_game(
                bracket, action["match_id"], action["winner_id"],
                stats=action.get("stats"), metadata=action.get("metadata"),
            )
        elif op == "report_draw":
            bracket = pb.report_draw(bracket, action["match_id"], stats=action.get("stats"))
        elif op == "report_choice":
            bracket = pb.report_choice(bracket, action["match_id"], action["opponent_id"])
        elif op == "unwind_game":
            bracket = pb.unwind_game(bracket, action["match_id"])
        elif op == "advance_swiss":
            bracket = pb.advance_swiss_round(bracket)
        elif op == "update_match":
            if bracket.state is DRAFT:
                raise pb.BracketStateError("Start the phase before editing matches.")
            match = pb.get_match(bracket, action["match_id"])
            if match is None:
                raise pb.MatchNotFoundError(f"No match with id {action['match_id']}.")
            if action.get("best_of") is not None:
                match.best_of = int(action["best_of"])
            if action.get("metadata") is not None:
                match.metadata = {**match.metadata, **action["metadata"]}
        else:
            raise ValueError(f"Unknown op: {op!r}")

        phase.brackets[group] = bracket
        return _ok(t)
    except Exception as exc:  # noqa: BLE001 — surfaced to the UI as an error toast
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
