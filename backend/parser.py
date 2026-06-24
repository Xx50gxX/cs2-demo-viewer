"""
CS2 Demo Parser — wraps awpy 2.0 to extract structured data for the minimap viewer.

After awpy Demo.parse():
  - dem.ticks:    Polars DF [tick, steamid, name, side, X, Y, Z, health, place, round_num]
  - dem.rounds:   Polars DF [round_num, start, freeze_end, end, winner, reason, ...]
  - dem.grenades: Polars DF [thrower, grenade_type, tick, X, Y, Z, entity_id, round_num]
  - dem.events:   dict[str, Polars DF] — player_death, player_hurt, smokegrenade_detonate, etc.
"""

from pathlib import Path
from typing import Any

import polars as pl


class DemoParser:
    """
    High-level wrapper around awpy.Demo for minimap visualization needs.

    Usage:
        parser = DemoParser("path/to/demo.dem")
        parser.parse()
        meta = parser.get_metadata()
        round_data = parser.get_round(5)
    """

    def __init__(self, demo_path: str | Path):
        self.demo_path = Path(demo_path)
        self._demo = None       # awpy.Demo instance
        self._parsed = False
        self._map_name = ""
        self._players: list[dict] = []
        self._cache: dict[str, Any] = {}

    # ── Parse ──────────────────────────────────────────────────────────

    def parse(self) -> dict:
        """Parse the demo file and return metadata summary."""
        if self._parsed:
            return self._cache.get("metadata", self.get_metadata())

        from awpy import Demo

        self._demo = Demo(str(self.demo_path))

        # Header gives us map_name
        header = self._demo.parse_header()
        self._map_name = str(header.get("map_name", "unknown"))

        # Full parse — request pitch/yaw for grenade practice feature
        import time
        t0 = time.time()
        self._demo.parse(player_props=["pitch", "yaw"])
        elapsed = time.time() - t0
        print(f"[parser] Parsed {self.demo_path.name} in {elapsed:.1f}s")

        self._parsed = True

        # Collect player info
        if self._demo.ticks is not None:
            players_df = (
                self._demo.ticks
                .unique(subset=["steamid"])
                .select(["steamid", "name", "side"])
                .to_dicts()
            )
            self._players = players_df

        return self.get_metadata()

    # ── Metadata ───────────────────────────────────────────────────────

    def get_metadata(self) -> dict:
        """Return demo metadata: map, teams, players, rounds, tick range."""
        if not self._parsed:
            raise RuntimeError("Call parse() first")

        if "metadata" in self._cache:
            return self._cache["metadata"]

        assert self._demo is not None
        ticks_df = self._demo.ticks
        rounds_df = self._demo.rounds

        # Round info — from dem.rounds (more accurate than deriving from ticks)
        rounds = []
        if rounds_df is not None:
            for row in rounds_df.sort("round_num").to_dicts():
                rounds.append({
                    "round_num": int(row["round_num"]),
                    "tick_start": int(row.get("start", row.get("freeze_end", 0))),
                    "tick_end": int(row.get("end", 0)),
                    "winner": str(row.get("winner", "")),
                    "reason": str(row.get("reason", "")),
                })

        # Total tick range
        total_ticks = 0
        if ticks_df is not None:
            total_ticks = int(ticks_df["tick"].max())

        meta = {
            "map_name": self._map_name,
            "total_ticks": total_ticks,
            "total_rounds": len(rounds),
            "rounds": rounds,
            "players": self._players,
            "teams": self._get_teams(),
        }
        self._cache["metadata"] = meta
        return meta

    # ── Events ─────────────────────────────────────────────────────────

    def get_events(self) -> dict:
        """
        Return all key events as JSON-serializable dicts.

        Returns:
            {
                "kills": [...],
                "damages": [...],
                "grenades": [...],
                "bomb_events": [...],
                "weapon_fires": [...]  # player → weapon tracking
            }
        """
        if not self._parsed:
            raise RuntimeError("Call parse() first")

        if "events" in self._cache:
            return self._cache["events"]

        assert self._demo is not None
        ev = self._demo.events
        gn = self._demo.grenades

        events: dict[str, list[dict]] = {
            "kills": [],
            "damages": [],
            "grenades": [],
            "bomb_events": [],
            "weapon_fires": [],
            "item_pickups": [],
        }

        # Kills — from player_death events
        if "player_death" in ev:
            for row in ev["player_death"].to_dicts():
                events["kills"].append(self._serialize_row({
                    "tick": row.get("tick"),
                    "attacker_name": row.get("attacker_name"),
                    "attacker_steamid": row.get("attacker_steamid"),
                    "attacker_side": row.get("attacker_side"),
                    "victim_name": row.get("user_name"),
                    "victim_steamid": row.get("user_steamid"),
                    "victim_side": row.get("user_side"),
                    "weapon": row.get("weapon"),
                    "headshot": row.get("headshot"),
                    "X": row.get("attacker_X"),
                    "Y": row.get("attacker_Y"),
                    "Z": row.get("attacker_Z"),
                    "victim_X": row.get("user_X"),
                    "victim_Y": row.get("user_Y"),
                    "victim_Z": row.get("user_Z"),
                }))

        # Damages — from player_hurt
        if "player_hurt" in ev:
            for row in ev["player_hurt"].to_dicts():
                events["damages"].append(self._serialize_row({
                    "tick": row.get("tick"),
                    "attacker_name": row.get("attacker_name"),
                    "attacker_side": row.get("attacker_side"),
                    "victim_name": row.get("user_name"),
                    "victim_side": row.get("user_side"),
                    "weapon": row.get("weapon"),
                    "dmg_health": row.get("dmg_health"),
                    "dmg_armor": row.get("dmg_armor"),
                    "hitgroup": row.get("hitgroup"),
                }))

        # Grenade trajectory + origins — sample trajectory points for animated flight paths
        if gn is not None and gn.height > 0:
            # Get throw origin + trajectory samples per entity
            # Sample every 8 ticks for smooth animation without bloat
            TRAJECTORY_STEP = 8

            # Get per-entity trajectory points
            entities = gn.sort(["entity_id", "tick"])
            last_eid = None
            last_tick = None
            for row in entities.to_dicts():
                eid = row.get("entity_id")
                tick = row.get("tick")
                gtype = str(row.get("grenade_type", ""))

                # Always include first tick (throw origin) and then every Nth tick
                is_first = eid != last_eid
                is_sample = is_first or (tick - (last_tick or tick)) >= TRAJECTORY_STEP

                if is_sample or last_eid != eid:
                    last_eid = eid
                    events["grenades"].append(self._serialize_row({
                        "tick": tick,
                        "thrower": row.get("thrower"),
                        "thrower_steamid": row.get("thrower_steamid"),
                        "grenade_type": gtype,
                        "X": row.get("X"),
                        "Y": row.get("Y"),
                        "Z": row.get("Z"),
                        "entity_id": eid,
                        "round_num": row.get("round_num"),
                        "category": _categorize_grenade(gtype),
                        "is_throw_origin": is_first,
                        "is_trajectory": not is_first,
                    }))
                    last_tick = tick

        # Smoke detonation events (more precise positions)
        if "smokegrenade_detonate" in ev:
            for row in ev["smokegrenade_detonate"].to_dicts():
                events["grenades"].append(self._serialize_row({
                    "tick": row.get("tick"),
                    "thrower": row.get("user_name"),
                    "thrower_steamid": row.get("user_steamid"),
                    "grenade_type": "smoke_detonate",
                    "X": row.get("x"),
                    "Y": row.get("y"),
                    "Z": row.get("z"),
                    "entity_id": row.get("entityid"),
                    "category": "smoke",
                    "is_detonation": True,
                }))

        # Flash detonations
        if "flashbang_detonate" in ev:
            for row in ev["flashbang_detonate"].to_dicts():
                events["grenades"].append(self._serialize_row({
                    "tick": row.get("tick"),
                    "thrower": row.get("user_name"),
                    "grenade_type": "flash_detonate",
                    "X": row.get("x"),
                    "Y": row.get("y"),
                    "Z": row.get("z"),
                    "entity_id": row.get("entityid"),
                    "category": "flash",
                    "is_detonation": True,
                }))

        # HE detonations
        if "hegrenade_detonate" in ev:
            for row in ev["hegrenade_detonate"].to_dicts():
                events["grenades"].append(self._serialize_row({
                    "tick": row.get("tick"),
                    "thrower": row.get("user_name"),
                    "grenade_type": "he_detonate",
                    "X": row.get("x"),
                    "Y": row.get("y"),
                    "Z": row.get("z"),
                    "entity_id": row.get("entityid"),
                    "category": "he",
                    "is_detonation": True,
                }))

        # Inferno (molotov/incendiary) start
        if "inferno_startburn" in ev:
            for row in ev["inferno_startburn"].to_dicts():
                events["grenades"].append(self._serialize_row({
                    "tick": row.get("tick"),
                    "thrower": row.get("user_name"),
                    "grenade_type": "inferno",
                    "X": row.get("x"),
                    "Y": row.get("y"),
                    "Z": row.get("z"),
                    "entity_id": row.get("entityid"),
                    "category": "molotov",
                    "is_detonation": True,
                }))

        # Bomb events
        for evt_name in ["bomb_planted", "bomb_defused", "bomb_exploded", "bomb_pickup", "bomb_dropped"]:
            if evt_name in ev:
                for row in ev[evt_name].to_dicts():
                    events["bomb_events"].append(self._serialize_row({
                        "tick": row.get("tick"),
                        "event": evt_name,
                        "player": row.get("user_name"),
                        "side": row.get("user_side"),
                        "X": row.get("user_X"),
                        "Y": row.get("user_Y"),
                        "site": row.get("site"),
                    }))

        # Weapon fires — include all shots for tracer rendering + weapon tracking
        if "weapon_fire" in ev:
            wf = ev["weapon_fire"]
            prev_weapon = {}
            for row in wf.sort(["user_steamid", "tick"]).to_dicts():
                sid = row.get("user_steamid")
                weapon = row.get("weapon", "")
                tick = row.get("tick")
                events["weapon_fires"].append(self._serialize_row({
                    "tick": tick,
                    "player": row.get("user_name"),
                    "steamid": sid,
                    "weapon": weapon,
                    "X": row.get("user_X"),
                    "Y": row.get("user_Y"),
                    "side": row.get("user_side"),
                }))
                # Also track weapon changes for the tooltip
                if sid not in prev_weapon or prev_weapon[sid] != weapon:
                    prev_weapon[sid] = weapon

        # Item pickups — for inventory tracking (weapons, armor, defuser, grenades)
        if "item_pickup" in ev:
            for row in ev["item_pickup"].to_dicts():
                events["item_pickups"].append(self._serialize_row({
                    "tick": row.get("tick"),
                    "player": row.get("user_name"),
                    "steamid": row.get("user_steamid"),
                    "item": row.get("item"),
                    "side": row.get("user_side"),
                }))

        self._cache["events"] = events
        return events

    # ── Round Data ─────────────────────────────────────────────────────

    def get_round(self, round_num: int, tick_step: int = 4) -> dict:
        """
        Return tick-level data and events for a specific round.

        Args:
            round_num: The round number (1-indexed).
            tick_step: Downsampling factor — only include every Nth tick.
                       Default 4 = ~32 fps from 128-tick source.
        """
        if not self._parsed:
            raise RuntimeError("Call parse() first")

        cache_key = f"round_{round_num}_step{tick_step}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        assert self._demo is not None
        ticks_df = self._demo.ticks

        # Filter ticks for this round
        r_ticks = ticks_df.filter(pl.col("round_num") == round_num)
        if r_ticks.height == 0:
            return {"round_num": round_num, "ticks": [], "events": {"kills": [], "grenades": []}}

        # Select rendering columns (pitch/yaw not available by default, skip for now)
        needed_cols = ["tick", "steamid", "name", "side", "X", "Y", "Z", "health", "pitch", "yaw"]
        available = [c for c in needed_cols if c in r_ticks.columns]
        r_ticks = r_ticks.select(available)

        # Downsample: only include every Nth tick for smaller payloads
        # CS2 is 128-tick; step=4 gives ~32 fps which is smooth for 2D minimap
        if tick_step > 1:
            r_ticks = r_ticks.filter(pl.col("tick") % tick_step == 0)

        # Group by tick for efficient frontend rendering
        tick_groups: dict = {}
        for row in r_ticks.to_dicts():
            tick = int(row["tick"])
            if tick not in tick_groups:
                tick_groups[tick] = []
            tick_groups[tick].append(self._serialize_row(row))

        # Sort ticks
        sorted_ticks = [
            {"tick": t, "players": tick_groups[t]}
            for t in sorted(tick_groups)
        ]

        # Filter events for this round
        all_events = self.get_events()
        round_events = {
            "kills": [e for e in all_events["kills"]
                      if (sorted_ticks and sorted_ticks[0]["tick"] <= (e.get("tick") or 0) <= sorted_ticks[-1]["tick"])],
            "grenades": [e for e in all_events["grenades"]
                         if (sorted_ticks and sorted_ticks[0]["tick"] <= (e.get("tick") or 0) <= sorted_ticks[-1]["tick"])],
            "weapon_fires": [e for e in all_events.get("weapon_fires", [])
                             if (sorted_ticks and sorted_ticks[0]["tick"] <= (e.get("tick") or 0) <= sorted_ticks[-1]["tick"])],
            "item_pickups": [e for e in all_events.get("item_pickups", [])
                             if (sorted_ticks and sorted_ticks[0]["tick"] <= (e.get("tick") or 0) <= sorted_ticks[-1]["tick"])],
        }

        # Get round timing from rounds DataFrame (freeze_end → gameplay start)
        round_info = None
        if self._demo.rounds is not None:
            rdf = self._demo.rounds.filter(pl.col("round_num") == round_num)
            if rdf.height > 0:
                ri = rdf.row(0, named=True)
                round_info = {
                    "freeze_end": int(ri.get("freeze_end", 0)),
                    "official_end": int(ri.get("official_end", 0)),
                    "winner": str(ri.get("winner", "")),
                    "reason": str(ri.get("reason", "")),
                    "bomb_site": str(ri.get("bomb_site", "")),
                }

        data = {
            "round_num": round_num,
            "tick_start": sorted_ticks[0]["tick"] if sorted_ticks else 0,
            "tick_end": sorted_ticks[-1]["tick"] if sorted_ticks else 0,
            "tick_step": tick_step,
            "ticks": sorted_ticks,
            "events": round_events,
            "round_info": round_info,
        }
        self._cache[cache_key] = data
        return data

    def get_tick_snapshot(self, tick_num: int) -> dict:
        """Return player positions at a specific tick."""
        if not self._parsed:
            raise RuntimeError("Call parse() first")

        assert self._demo is not None
        r_ticks = self._demo.ticks.filter(pl.col("tick") == tick_num)

        cols = ["tick", "steamid", "name", "side", "X", "Y", "Z", "health", "pitch", "yaw"]
        available = [c for c in cols if c in r_ticks.columns]

        players = [self._serialize_row(r) for r in r_ticks.select(available).to_dicts()]
        return {"tick": tick_num, "players": players}

    # ── Helpers ────────────────────────────────────────────────────────

    def _get_teams(self) -> dict:
        """Extract team info from tick data."""
        assert self._demo is not None
        ticks = self._demo.ticks
        if ticks is None or "side" not in ticks.columns:
            return {}

        teams: dict[str, list[str]] = {}
        for row in ticks.unique(subset=["steamid"]).select(["steamid", "name", "side"]).to_dicts():
            side = str(row.get("side", "unknown"))
            name = str(row.get("name", "unknown"))
            teams.setdefault(side, [])
            if name not in teams[side]:
                teams[side].append(name)
        return teams

    @staticmethod
    def _serialize_row(row: dict) -> dict:
        """Make a row JSON-serializable (handle Polars/NumPy types)."""
        clean = {}
        for k, v in row.items():
            if isinstance(v, (int, float, str, bool, type(None))):
                clean[k] = v
            elif isinstance(v, bytes):
                clean[k] = v.decode("utf-8", errors="replace")
            else:
                clean[k] = str(v)
        return clean


# ── Helpers ──────────────────────────────────────────────────────────────

def _categorize_grenade(gtype: str) -> str:
    """Map awpy grenade_type strings to frontend categories."""
    g = gtype.lower()
    if "smoke" in g:
        return "smoke"
    if "flash" in g:
        return "flash"
    if "hegrenade" in g or "frag" in g:
        return "he"
    if "molotov" in g or "incendiary" in g or "inferno" in g:
        return "molotov"
    if "decoy" in g:
        return "decoy"
    return "other"


# ── Module-level cache ───────────────────────────────────────────────────

_parser_cache: dict[str, DemoParser] = {}


def load_demo(demo_path: str) -> DemoParser:
    """Load and parse a demo, caching the parser instance."""
    path = str(Path(demo_path).resolve())
    if path not in _parser_cache:
        parser = DemoParser(path)
        parser.parse()
        _parser_cache[path] = parser
    return _parser_cache[path]


def get_cached_parser(demo_path: str) -> DemoParser | None:
    """Get a previously loaded parser without re-parsing."""
    path = str(Path(demo_path).resolve())
    return _parser_cache.get(path)
