/** An enemy on the map, as `GET /geo/world` lists it. */
export type GeoSpawn = {
    /** Pass back to `POST /geo/runs` to fight it. */
    id: string;
    enemyId: string;
    /** The app's sprite name. */
    sprite: string;
    latitude: number;
    longitude: number;
    /** ISO time it leaves the map. */
    despawnsAt: string;
};

/**
 * `POST /geo/dev/spawns`, dev servers only: an enemy within reach of this
 * point, straight away. Replies like `GET /geo/world`.
 */
export type GeoDevSpawnRequest = {
    enemyId: string;
    latitude: number;
    longitude: number;
};

/** Water classes the map tiles know, as the app reports them. */
export const GEO_WORLD_WATER_KINDS = ["pond", "lake", "river", "dock", "ocean"] as const;
export type GeoWorldWaterKind = (typeof GEO_WORLD_WATER_KINDS)[number];

/**
 * Kinds of place that draw their own enemies: water creatures by water,
 * golems by mines, spore things by farms and woods, strong foes by POIs.
 */
export const GEO_WORLD_HABITATS = ["water", "mining", "foraging", "farming", "landmark"] as const;
export type GeoWorldHabitat = (typeof GEO_WORLD_HABITATS)[number];

/**
 * The app reports the nearest place of each habitat within this many metres;
 * anything farther can't change spawns.
 */
export const GEO_WORLD_HABITAT_METRES = 250;

/**
 * `GET /geo/world?latitude=…&longitude=…`. Dev servers also take `fill=true`:
 * top up to the most spawns allowed rather than this window's roll.
 *
 * The app also sends the nearest place of each habitat it can see on the map
 * within GEO_WORLD_HABITAT_METRES, if any, as `<habitat>Latitude` and
 * `<habitat>Longitude` (e.g. `miningLatitude`): for water, the nearest edge,
 * with `waterKind` too. Nearby places pull some new spawns toward their own
 * enemies, placed on that side of the player.
 */
export type GeoWorldResponse = {
    spawns: GeoSpawn[];
    /** How close the player must be to start a fight, in metres. */
    reachMetres: number;
    /** How far from the player new spawns appear, in metres. */
    spawnRadiusMetres: number;
};
