"""
CS2 Map Radar Configuration

Each map entry defines the coordinate transformation parameters
to convert in-game world coordinates (X, Y) to radar image pixel coordinates.

The radar image is typically 1024x1024 pixels.
Conversion formulas:
  pixel_x = (world_y - pos_y) / -scale
  pixel_y = (world_x - pos_x) / -scale

Reference: CS2 overview files (.txt in VPK packages) and awpy built-in map data.
"""

from typing import Dict, TypedDict


class MapConfig(TypedDict):
    name: str
    radar_file: str
    pos_x: float       # World X at left edge of radar image
    pos_y: float       # World Y at top edge of radar image
    scale: float        # World units per pixel (at 1024px reference)
    radar_size: int     # Radar image dimensions (square)
    # For multi-level maps (de_nuke), vertical sections
    vertical_sections: list | None


# Map configurations extracted from CS2 game overview files
# pos_x, pos_y, scale values define world→image coordinate mapping
MAP_CONFIGS: Dict[str, MapConfig] = {
    # Calibrated from actual CS2 demo data (player movement bounds)
    "de_mirage": {
        "name": "Mirage",
        "radar_file": "de_mirage_radar.png",
        "pos_x": -3236.0,
        "pos_y": 3230.0,
        "scale": 5.1,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_inferno": {
        "name": "Inferno",
        "radar_file": "de_inferno_radar.png",
        "pos_x": -2240.0,
        "pos_y": 4168.0,
        "scale": 5.5,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_anubis": {
        "name": "Anubis",
        "radar_file": "de_anubis_radar.png",
        "pos_x": -2800.0,
        "pos_y": 3072.0,
        "scale": 5.2,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    # Estimated (no demo data available yet — calibrate when data is available)
    "de_dust2": {
        "name": "Dust II",
        "radar_file": "de_dust2_radar.png",
        "pos_x": -2556.0,
        "pos_y": 2912.0,
        "scale": 4.6,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_nuke": {
        "name": "Nuke",
        "radar_file": "de_nuke_radar.png",
        "pos_x": -3456.0,
        "pos_y": 2880.0,
        "scale": 5.5,
        "radar_size": 1024,
        "vertical_sections": [
            {"name": "lower", "altitude_min": -10000, "altitude_max": -495},
            {"name": "upper", "altitude_min": -495, "altitude_max": 10000},
        ],
    },
    "de_ancient": {
        "name": "Ancient",
        "radar_file": "de_ancient_radar.png",
        "pos_x": -3000.0,
        "pos_y": 2890.0,
        "scale": 5.2,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_overpass": {
        "name": "Overpass",
        "radar_file": "de_overpass_radar.png",
        "pos_x": -3840.0,
        "pos_y": 3520.0,
        "scale": 6.0,
        "radar_size": 1024,
        "vertical_sections": None,
    },
    "de_vertigo": {
        "name": "Vertigo",
        "radar_file": "de_vertigo_radar.png",
        "pos_x": -2240.0,
        "pos_y": 1600.0,
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

    CS2 overview file convention:
      - pos_x, pos_y = world coords at TOP-LEFT of the radar image
      - scale = world units per pixel
      - Image Y increases downward, world Y increases northward
      → pixel_x = (world_x - pos_x) / scale
      → pixel_y = (pos_y - world_y) / scale

    Args:
        world_x: In-game X coordinate (east/west)
        world_y: In-game Y coordinate (north/south)
        config: Map configuration with pos_x, pos_y, scale

    Returns:
        (pixel_x, pixel_y) tuple — position on the radar image
    """
    pixel_x = (world_x - config["pos_x"]) / config["scale"]
    pixel_y = (config["pos_y"] - world_y) / config["scale"]

    # Clamp to image bounds
    size = config["radar_size"]
    pixel_x = max(0, min(size, pixel_x))
    pixel_y = max(0, min(size, pixel_y))

    return pixel_x, pixel_y


def get_map_config(map_name: str) -> MapConfig | None:
    """Look up map configuration by name (case-insensitive)."""
    map_lower = map_name.lower().replace(" ", "_")
    return MAP_CONFIGS.get(map_lower)
