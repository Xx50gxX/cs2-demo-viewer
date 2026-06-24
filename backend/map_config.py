"""
CS2 Map Radar Configuration

Coordinate values from awpy official map-data.json (extracted from CS2 game files).
These are verified to produce correct player positioning on the map images.
"""

from typing import TypedDict


class MapConfig(TypedDict):
    name: str
    radar_file: str      # awpy map image filename (1024x1024 PNG)
    pos_x: float
    pos_y: float
    scale: float
    radar_size: int
    vertical_sections: list | None


# Verified values from awpy map-data.json (CS2 game overview files)
MAP_CONFIGS = {
    "de_mirage": {
        "name": "Mirage",
        "radar_file": "de_mirage.png",
        "pos_x": -3230.0,
        "pos_y": 1713.0,
        "scale": 5.0,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_inferno": {
        "name": "Inferno",
        "radar_file": "de_inferno.png",
        "pos_x": -2087.0,
        "pos_y": 3870.0,
        "scale": 4.9,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_dust2": {
        "name": "Dust II",
        "radar_file": "de_dust2.png",
        "pos_x": -2476.0,
        "pos_y": 3239.0,
        "scale": 4.4,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_nuke": {
        "name": "Nuke",
        "radar_file": "de_nuke.png",
        "pos_x": -3453.0,
        "pos_y": 2887.0,
        "scale": 7.0,
        "radar_size": 1024,
        "vertical_sections": [
            {"name": "lower", "altitude_min": -10000, "altitude_max": -495},
            {"name": "upper", "altitude_min": -495, "altitude_max": 10000},
        ],
    },
    "de_ancient": {
        "name": "Ancient",
        "radar_file": "de_ancient.png",
        "pos_x": -2953.0,
        "pos_y": 2164.0,
        "scale": 5.0,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_anubis": {
        "name": "Anubis",
        "radar_file": "de_anubis.png",
        "pos_x": -2796.0,
        "pos_y": 3328.0,
        "scale": 5.22,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_overpass": {
        "name": "Overpass",
        "radar_file": "de_overpass.png",
        "pos_x": -4831.0,
        "pos_y": 1781.0,
        "scale": 5.2,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_vertigo": {
        "name": "Vertigo",
        "radar_file": "de_vertigo.png",
        "pos_x": -3168.0,
        "pos_y": 1762.0,
        "scale": 4.0,
        "radar_size": 1024,
        "vertical_sections": [
            {"name": "lower", "altitude_min": -10000, "altitude_max": 11720},
            {"name": "upper", "altitude_min": 11720, "altitude_max": 30000},
        ],
    },
}


def world_to_pixel(world_x: float, world_y: float, config: MapConfig) -> tuple[float, float]:
    """
    Convert CS2 world coordinates to radar image pixel coordinates.
    Uses the same formula as awpy.plot.utils.game_to_pixel_axis().

    Args:
        world_x: In-game X coordinate
        world_y: In-game Y coordinate
        config: Map configuration

    Returns:
        (pixel_x, pixel_y) — position on the 1024x1024 radar image
    """
    pixel_x = (world_x - config["pos_x"]) / config["scale"]
    pixel_y = (config["pos_y"] - world_y) / config["scale"]

    size = config["radar_size"]
    pixel_x = max(0, min(size, pixel_x))
    pixel_y = max(0, min(size, pixel_y))
    return pixel_x, pixel_y


def get_map_config(map_name: str) -> MapConfig | None:
    """Look up map configuration by name (case-insensitive)."""
    map_lower = map_name.lower().replace(" ", "_")
    return MAP_CONFIGS.get(map_lower)
