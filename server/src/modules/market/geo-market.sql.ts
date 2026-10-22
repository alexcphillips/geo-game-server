/** Every listing column, plus the seller's and leading bidder's names. */
const LISTING_SELECT = `
  SELECT l.id, l.seller_id, s.display_name AS seller_name, l.type, l.status, l.item_id,
         l.source_inventory_id, l.charges_left, l.reforge, l.pet, l.obtained_at, l.quantity_listed, l.quantity_left,
         l.unit_price, l.starting_bid, l.current_bid, l.leading_bidder_id,
         b.display_name AS leading_bidder_name, l.bid_count, l.ends_at, l.fee_paid,
         l.proceeds, l.proceeds_collected, l.created_at
  FROM geo.market_listings l
  JOIN geo.players s ON s.id = l.seller_id
  LEFT JOIN geo.players b ON b.id = l.leading_bidder_id
`;

/** Live single items: everything but stackable buy-it-now listings. */
export const FIND_ACTIVE_SINGLES = `
  ${LISTING_SELECT}
  WHERE l.status = 'active' AND NOT (l.item_id = ANY($1::text[]))
  ORDER BY l.created_at DESC
  LIMIT 500;
`;

/** Live stack offers from everyone but the viewer, pooled per item and price. */
export const FIND_STACK_OFFERS = `
  SELECT item_id, unit_price, SUM(quantity_left) AS quantity
  FROM geo.market_listings
  WHERE status = 'active' AND type = 'bin' AND item_id = ANY($1::text[]) AND seller_id <> $2
  GROUP BY item_id, unit_price
  ORDER BY item_id, unit_price;
`;

/** The seller's live listings, and ended ones with coins still to collect. */
export const FIND_OWN_LISTINGS = `
  ${LISTING_SELECT}
  WHERE l.seller_id = $1 AND (l.status = 'active' OR l.proceeds > l.proceeds_collected)
  ORDER BY l.created_at DESC;
`;

export const FIND_LISTING = `${LISTING_SELECT} WHERE l.id = $1;`;

/** Locks the listing row alone (no joins, which FOR UPDATE would lock too). */
export const LOCK_LISTING = `SELECT id FROM geo.market_listings WHERE id = $1 FOR UPDATE;`;

export const COUNT_ACTIVE_FOR_SELLER = `
  SELECT COUNT(*) AS count FROM geo.market_listings WHERE seller_id = $1 AND status = 'active';
`;

/** Locks the seller's player row, so two listings at once can't pass the limit together. */
export const LOCK_SELLER = `SELECT id FROM geo.players WHERE id = $1 FOR UPDATE;`;

export const INSERT_LISTING = `
  INSERT INTO geo.market_listings
    (seller_id, type, item_id, source_inventory_id, charges_left, obtained_at,
     quantity_listed, quantity_left, unit_price, starting_bid, ends_at, fee_paid, reforge, pet)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13)
  RETURNING id;
`;

export const FIND_BIDS = `
  SELECT g.listing_id, p.display_name AS bidder_name, g.amount, g.created_at
  FROM geo.market_bids g JOIN geo.players p ON p.id = g.bidder_id
  WHERE g.listing_id = ANY($1::uuid[])
  ORDER BY g.created_at, g.id;
`;

export const FIND_SALES = `
  SELECT s.listing_id, p.display_name AS buyer_name, s.quantity, s.paid, s.created_at
  FROM geo.market_sales s LEFT JOIN geo.players p ON p.id = s.buyer_id
  WHERE s.listing_id = ANY($1::uuid[])
  ORDER BY s.created_at, s.id;
`;

export const SUM_HELD_FOR_BIDDER = `
  SELECT COALESCE(SUM(amount), 0) AS held FROM geo.market_bids WHERE bidder_id = $1 AND status = 'held';
`;

export const INSERT_BID = `
  INSERT INTO geo.market_bids (listing_id, bidder_id, amount) VALUES ($1, $2, $3);
`;

/** The held bid on a listing, marked returned or won. Returns who held it and how much. */
export const SETTLE_HELD_BID = `
  UPDATE geo.market_bids SET status = $2 WHERE listing_id = $1 AND status = 'held'
  RETURNING bidder_id, amount;
`;

export const SET_LEADING_BID = `
  UPDATE geo.market_listings
  SET current_bid = $2, leading_bidder_id = $3, bid_count = bid_count + 1, ends_at = $4
  WHERE id = $1;
`;

export const INSERT_SALE = `
  INSERT INTO geo.market_sales (listing_id, buyer_id, quantity, paid) VALUES ($1, $2, $3, $4);
`;

/** Takes units out of escrow for a buyer; the listing is sold once none are left. */
export const RECORD_SALE = `
  UPDATE geo.market_listings
  SET quantity_left = quantity_left - $2,
      proceeds = proceeds + $3,
      status = CASE WHEN quantity_left - $2 = 0 THEN 'sold' ELSE status END,
      ended_at = CASE WHEN quantity_left - $2 = 0 THEN now() ELSE ended_at END
  WHERE id = $1;
`;

/** Ends a listing without a sale; whatever is left in escrow has been handed back. */
export const END_LISTING = `
  UPDATE geo.market_listings SET status = $2, quantity_left = 0, ended_at = now() WHERE id = $1;
`;

export const MARK_COLLECTED = `
  UPDATE geo.market_listings SET proceeds_collected = proceeds WHERE id = $1;
`;

export const FIND_UNCOLLECTED_IDS = `
  SELECT id FROM geo.market_listings WHERE seller_id = $1 AND proceeds > proceeds_collected;
`;

/**
 * The cheapest live offers of an item from other sellers, as many as it
 * takes to reach $3 units, cheapest (then oldest) first.
 */
export const FIND_CHEAPEST_STACK_LISTINGS = `
  SELECT id FROM (
    SELECT id, SUM(quantity_left) OVER (ORDER BY unit_price, created_at, id) - quantity_left AS before
    FROM geo.market_listings
    WHERE status = 'active' AND type = 'bin' AND item_id = $1 AND seller_id <> $2
  ) ranked
  WHERE before < $3;
`;

/** Locks those listings, in price order; ones taken since drop out. */
export const LOCK_STACK_LISTINGS = `
  SELECT id, seller_id, unit_price, quantity_left
  FROM geo.market_listings
  WHERE id = ANY($1::uuid[]) AND status = 'active'
  ORDER BY unit_price, created_at, id
  FOR UPDATE;
`;

/** Auctions whose time is up, oldest first. Each is locked on its own to settle. */
export const FIND_ENDED_AUCTION_IDS = `
  SELECT id FROM geo.market_listings
  WHERE status = 'active' AND type = 'auction' AND ends_at <= now()
  ORDER BY ends_at
  LIMIT 200;
`;

/**
 * Locks one auction if it's still waiting to be settled; nothing back if it
 * isn't, or if another settler holds it (skipped, not waited on).
 */
export const LOCK_ENDED_AUCTION = `
  SELECT id FROM geo.market_listings
  WHERE id = $1 AND status = 'active' AND type = 'auction' AND ends_at <= now()
  FOR UPDATE SKIP LOCKED;
`;

export const SUM_HELD_ALL = `SELECT COALESCE(SUM(amount), 0) AS total FROM geo.market_bids WHERE status = 'held';`;

export const SUM_UNCOLLECTED_ALL = `
  SELECT COALESCE(SUM(proceeds - proceeds_collected), 0) AS total FROM geo.market_listings;
`;
