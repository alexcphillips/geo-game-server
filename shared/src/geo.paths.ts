/**
 * Every geo-game HTTP path, declared once; all live under `/geo`.
 */
export const GEO_API_PATHS = {
    health: "/geo/health",
    content: "/geo/content",
    world: "/geo/world",
    auth: {
        /** A geo-game account's email and password. */
        login: "/geo/auth/login",
        /** Makes a geo-game account and signs it in. */
        register: "/geo/auth/register",
        refresh: "/geo/auth/refresh",
        logout: "/geo/auth/logout",
    },
    me: {
        root: "/geo/me",
        equipmentSlot: "/geo/me/equipment/:slot",
        /** PUT adds that talisman to the bag; DELETE takes it out. */
        talismanBagEntry: "/geo/me/talisman-bag/:inventoryId",
        hand: "/geo/me/hands/:skill",
        savedHands: "/geo/me/saved-hands",
        savedHand: "/geo/me/saved-hands/:savedHandId",
        /** POST: makes a saved hand the skill's current hand. */
        loadSavedHand: "/geo/me/saved-hands/:savedHandId/load",
        /** PUT { itemId, quantity } packs food into the slot; DELETE unpacks it. */
        lunchboxSlot: "/geo/me/lunchbox/:slot",
        /** POST: eats one food from the slot between fights, for its healing. Anywhere. */
        eatLunchbox: "/geo/me/lunchbox/:slot/eat",
        /** PUT { itemId, quantity } packs bait into the slot; DELETE unpacks it. */
        baitSlot: "/geo/me/bait/:slot",
        /** PUT { position } sets camp (once every GEO_CAMP_MOVE_DAYS); DELETE forgets it. */
        camp: "/geo/me/camp",
        /** POST { amount, position }: purse → bank. At camp only, not mid-Run. */
        bankDeposit: "/geo/me/bank/deposit",
        /** POST { amount, position }: bank → purse. At camp only, not mid-Run. */
        bankWithdraw: "/geo/me/bank/withdraw",
        /** PUT { name, save } saves what's worn into the loadout (or renames it); DELETE clears it. */
        loadout: "/geo/me/wardrobe/:slot",
        /** POST: wears the loadout. Not mid-Run. */
        wearLoadout: "/geo/me/wardrobe/:slot/wear",
        /** PUT { autoFor }: tags the loadout for auto-swap. */
        loadoutAuto: "/geo/me/wardrobe/:slot/auto",
        /** POST: buys one more loadout slot. */
        buyLoadoutSlot: "/geo/me/wardrobe/buy-slot",
        /** PUT { inventoryId }: the active pet (null puts it away). */
        activePet: "/geo/me/pet",
        /** PUT { inventoryId } gives the pet a held item; DELETE takes it off, for coins. */
        petItem: "/geo/me/pets/:inventoryId/item",
    },
    quests: {
        /** GET: the player's quests (GeoQuestsResponse). */
        root: "/geo/quests",
        /** PUT: follow this quest in the tracker; only one at a time. */
        track: "/geo/quests/:questId/track",
        /** POST: turn in a ready quest, from anywhere, for its reward. */
        claim: "/geo/quests/:questId/claim",
    },
    /** Dev servers only: testing tools. Production answers 404. */
    dev: {
        /** POST: puts an enemy within reach of the player now. */
        spawn: "/geo/dev/spawns",
        /** POST: the player dies now, as if they'd lost a fight. */
        kill: "/geo/dev/kill",
    },
    farm: {
        /** GET: the player's farm, from anywhere. */
        root: "/geo/farm",
        /** POST a GeoFarmAction. */
        actions: "/geo/farm/actions",
        /** POST `GeoResearchRequest`: turn a mutation in at the Research Lab, from anywhere. */
        lab: "/geo/farm/lab",
    },
    vendors: {
        list: "/geo/vendors",
        /** POST { itemId, quantity }: the player buys from the vendor. */
        buy: "/geo/vendors/:vendorId/buy",
        /** POST { inventoryId, quantity }: the player sells to the vendor. */
        sell: "/geo/vendors/:vendorId/sell",
        /** POST { inventoryId }: pays the vendor to reroll a weapon or armor copy's reforge. */
        reforge: "/geo/vendors/:vendorId/reforge",
        /** POST { inventoryId }: leaves a pet with Kat to raise its rarity. */
        petUpgrade: "/geo/vendors/:vendorId/pet-upgrade",
        /** POST: takes the pet back from Kat, once it's ready. */
        collectPetUpgrade: "/geo/vendors/:vendorId/pet-upgrade/collect",
    },
    crafting: {
        /** POST { quantity }: crafts a recipe that many times. */
        craft: "/geo/crafting/:recipeId",
    },
    market: {
        /** GET: every live listing and stack, for browsing. */
        root: "/geo/market",
        /** GET: the player's own listings, live and sold-but-uncollected. */
        mine: "/geo/market/mine",
        /** POST: list an item. */
        listings: "/geo/market/listings",
        listing: "/geo/market/listings/:listingId",
        buy: "/geo/market/listings/:listingId/buy",
        bids: "/geo/market/listings/:listingId/bids",
        cancel: "/geo/market/listings/:listingId/cancel",
        collect: "/geo/market/listings/:listingId/collect",
        /** POST: collect every sold listing's coins at once. */
        collectAll: "/geo/market/collect",
        /** POST { quantity, expectedTotal }: buy units of a stackable, cheapest first. */
        buyStack: "/geo/market/stacks/:itemId/buy",
    },
    mayor: {
        /** GET: the mayor in office, their perks, and the election running now. */
        root: "/geo/mayor",
        /** POST { candidateId }: one vote per player per election, final. */
        vote: "/geo/elections/:electionId/votes",
    },
    /** Game admins only. */
    admin: {
        players: "/geo/admin/players",
        player: "/geo/admin/players/:playerId",
        playerRole: "/geo/admin/players/:playerId/role",
        playerBan: "/geo/admin/players/:playerId/ban",
        playerCoins: "/geo/admin/players/:playerId/coins",
        playerItems: "/geo/admin/players/:playerId/items",
        economy: "/geo/admin/economy",
        audit: "/geo/admin/audit",
        /** POST: ends the running election now; its winner takes office. */
        endElection: "/geo/admin/elections/end",
        /** PUT { endsAt }: moves the running election's end. */
        electionEndsAt: "/geo/admin/elections/ends-at",
        /** GET / PUT { always }: the calling admin's switch making every bite a sea creature. */
        seaCreatures: "/geo/admin/fishing/sea-creatures",
        /** POST: playtesting; the calling admin's farm takes its next cycle now. Returns GeoFarmView. */
        farmNextCycle: "/geo/admin/farm/next-cycle",
        /** POST: takes a listing down and hands everything back. */
        removeListing: "/geo/admin/market/listings/:listingId/remove",
        /** GET ?status=: location suggestions to review. */
        suggestions: "/geo/admin/suggestions",
        /** PUT { status, reviewNote }: reject or reopen one (accepting = creating its place). PATCH: move its pin or change its kind. */
        suggestion: "/geo/admin/suggestions/:suggestionId",
        /** GET: every hand-made place; POST: make one. */
        places: "/geo/admin/places",
        /** PATCH: edit, move or (de)activate one; DELETE: remove it for good. */
        place: "/geo/admin/places/:placeId",
        /** GET ?status=: players' feedback, with the replies sent. */
        feedback: "/geo/admin/feedback",
        /** PATCH { status }: move feedback along. */
        feedbackItem: "/geo/admin/feedback/:feedbackId",
        /** POST { body }: reply; it lands in the player's inbox. */
        feedbackReplies: "/geo/admin/feedback/:feedbackId/replies",
        /** GET: every announcement; POST: send one to every player's inbox. */
        announcements: "/geo/admin/announcements",
        /** DELETE: take an announcement out of every inbox. */
        announcement: "/geo/admin/announcements/:announcementId",
    },
    /** GET ?latitude&longitude: active hand-made places around a point. */
    places: "/geo/places",
    /** POST: a player suggests a place should be a hub or point of interest. */
    suggestions: "/geo/suggestions",
    runs: {
        start: "/geo/runs",
        active: "/geo/runs/active",
        turns: "/geo/runs/:runId/turns",
        flee: "/geo/runs/:runId/flee",
    },
    dungeons: {
        /** GET: dungeons, open lobbies, and the player's own lobby. */
        root: "/geo/dungeons",
        /** POST GeoCreateDungeonLobbyRequest: open a lobby and host it. */
        lobbies: "/geo/dungeons/lobbies",
        /** POST GeoJoinDungeonLobbyRequest. */
        join: "/geo/dungeons/lobbies/:lobbyId/join",
        /** POST: leave; the host leaving an open lobby closes it. */
        leave: "/geo/dungeons/lobbies/:lobbyId/leave",
        /** POST, host only: take everyone in (GeoStartDungeonLobbyResponse). */
        start: "/geo/dungeons/lobbies/:lobbyId/start",
    },
    dungeonRuns: {
        /** GET: the dungeon run in progress (GeoDungeonRunResponse), or null. */
        active: "/geo/dungeon-runs/active",
        /** GET: one of the player's dungeon runs, finished or not (GeoDungeonRunResponse): how it ended. */
        one: "/geo/dungeon-runs/:dungeonRunId",
        /** POST GeoDungeonMoveRequest. */
        move: "/geo/dungeon-runs/:dungeonRunId/move",
        /** POST GeoDungeonPuzzleRequest. */
        puzzle: "/geo/dungeon-runs/:dungeonRunId/puzzle",
        /** POST: leave the dungeon. It counts as failing it. */
        leave: "/geo/dungeon-runs/:dungeonRunId/leave",
    },
    fishing: {
        /** POST { tier }: open a fishing Run at a spot, or resume the open one. */
        start: "/geo/fishing",
        /** POST GeoFishingAction: cast, wait, strike, play a card… */
        actions: "/geo/fishing/:runId/actions",
        /** POST: leave the spot, ending the Run. */
        leave: "/geo/fishing/:runId/leave",
    },
    inbox: {
        /** GET: the player's messages and announcements. */
        root: "/geo/inbox",
        /** POST: everything in the inbox now counts as read. */
        read: "/geo/inbox/read",
    },
    /** GET: the player's own feedback; POST: send a bug, suggestion or other. */
    feedback: "/geo/feedback",
    /** POST GeoPresenceRequest: what the player is doing now, when it changes (204). */
    presence: "/geo/presence",
    friends: {
        /** GET: friends with their status, and requests both ways. */
        root: "/geo/friends",
        /** DELETE: no longer friends, for both players. */
        friend: "/geo/friends/:playerId",
        /** POST { username }: send a request, or accept theirs if they asked first. */
        requests: "/geo/friends/requests",
        /** DELETE: decline an incoming request or cancel your own. */
        request: "/geo/friends/requests/:requestId",
        /** POST: accept an incoming request. */
        accept: "/geo/friends/requests/:requestId/accept",
    },
    chests: {
        /** GET: pending chest selections, then history. */
        root: "/geo/chests",
        /** POST { index }: opens one chest of a pending selection. */
        open: "/geo/chests/:selectionId/open",
    },
} as const;
